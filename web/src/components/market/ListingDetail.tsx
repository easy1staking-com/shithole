"use client";

import { Address } from "@evolution-sdk/evolution";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  ConfirmationChip,
  type ChainConfirmation,
} from "@/components/ConfirmationChip";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { listPools, matchesPool } from "@/lib/market/poolTraits";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import { supportedPriceTokens } from "@/lib/market/supportedPriceTokens";
import {
  probeBabelAvailability,
  type BabelAvailability,
} from "@/lib/fluidtokens/babelDiscovery";
import { isBabelFeeEnabled } from "@/lib/fluidtokens/feature";
import { requiredTokenPayment } from "@/lib/fluidtokens/math";
import { useRefreshHistory } from "@/lib/me/useRefreshHistory";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { decodeAddressData } from "@/lib/tx/decodeAddressData";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitMarketBuy } from "@/lib/tx/marketBuy";
import { submitMarketCancel } from "@/lib/tx/marketCancel";
import { adaptUtxos } from "@/lib/tx/utxo";
import { useNftMetadata } from "@/lib/api/hooks";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Default tank-side parameters for the babel-fee leg.
 *
 * <p>{@code ada_used = 0.68 ADA} — measured on the live mainnet
 * combined marketplace-buy + tank-consume tx, 2026-05-30. Plutus-V3
 * eval on the marketplace + jar + tank + oracle scripts in a single
 * tx + multiple ref-script reads land the protocol fee at ~0.68 ADA;
 * 0.5 ADA leaves the buyer ~0.18 ADA short. Should drift only if
 * Plutus pricing changes or a script grows materially. If it does,
 * bump; medium-term we want iterative fee estimation like
 * FluidTokens' Mesh reference does.
 *
 * <p>{@code paymentMinLovelace = 1.2 ADA} — usual min-utxo for an
 * output carrying (lovelace + 1 token).
 */
const BABEL_ADA_USED_LOVELACE = 680_000n;
const BABEL_PAYMENT_MIN_LOVELACE = 1_200_000n;

/**
 * Detail page for a single marketplace listing. Three roles:
 *   - seller (datum.seller_pkh == connected wallet's pkh) → Cancel.
 *   - anyone else → Buy.
 *   - no wallet → read-only display.
 */
export function ListingDetail({ unit }: { unit: string }) {
  // Manifest fields (jar hash, marketplace address) are re-derived from
  // the current bytecode + admin pkh on every hook call. A contract
  // rebuild therefore updates these without any manifest editing.
  const { data: manifest } = useDerivedMarketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const walletAddress = useWalletStore((s) => s.addressBech32);
  const refreshHistory = useRefreshHistory();

  const [listing, setListing] = useState<DecodedListing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ChainConfirmation>(null);
  // Bumped after a tx confirms on chain to force the listing fetcher
  // below to re-run — the just-bought / just-cancelled UTxO should no
  // longer be in fetchMarketListings's result.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  useEffect(() => {
    if (!marketplaceAddress || !walletApi) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await makeClient(walletApi);
        const all = await fetchMarketListings(client, marketplaceAddress);
        const match = all.find((l) =>
          l.listedUnits.includes(unit.toLowerCase()),
        );
        if (!cancelled) setListing(match ?? null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplaceAddress, walletApi, unit, refreshNonce]);

  // Decode the seller's bech32 from the on-chain Address Constr in the
  // datum once we have a listing. Used by both the buy flow and the
  // "paid to" hint in the read-only view.
  const sellerBech32 = useMemo(() => {
    if (!listing) return null;
    try {
      const network = toEvolutionNetwork(getNetworkName());
      return decodeAddressData(listing.datum.sellerAddressRaw, network);
    } catch (e) {
      console.warn("seller address decode failed", e);
      return null;
    }
  }, [listing]);

  // CIP-25 name + image for the listed asset.
  const meta = useNftMetadata(unit);
  const displayName = meta.data?.name ?? unit.slice(0, 22) + "…";
  const imageUrl = meta.data?.image_url ?? null;

  // Pools this NFT matches — same logic + visual vocabulary as the
  // browse-grid card (ListingCard's PoolChips), surfaced here so the
  // buyer/seller sees the same context at checkout time.
  const matchingPools = useMemo(() => {
    const traits = meta.data?.traits ?? [];
    if (traits.length === 0) return [];
    return listPools()
      .filter((p) => matchesPool(traits, p).length > 0)
      .map((p) => p.ticker);
  }, [meta.data]);

  // Price-token label + decimals (for human-readable display).
  const priceTokens = useMemo(() => supportedPriceTokens(), []);
  const priceLabel = useMemo(() => {
    if (!listing) return null;
    const unitHex = (
      listing.datum.pricePolicyHex + listing.datum.priceNameHex
    ).toLowerCase();
    const m = priceTokens.find((t) => (t.unit || "").toLowerCase() === unitHex);
    return m ?? null;
  }, [listing, priceTokens]);

  const isSeller =
    listing && walletPkh && listing.datum.sellerPkhHex === walletPkh;

  // ---- Babel-fee availability + opt-in toggle ----
  /**
   * Probed availability is stored alongside the price unit it was probed
   * for, so we can ignore stale results when the user clicks through to
   * a different listing while a probe is still in flight.
   */
  const [babelProbe, setBabelProbe] = useState<{
    forUnit: string;
    result: BabelAvailability | null;
  } | null>(null);
  const [babelEnabled, setBabelEnabled] = useState(false);
  const [babelProbeError, setBabelProbeError] = useState<string | null>(null);
  const babelFeatureOn = isBabelFeeEnabled();
  const priceUnit = listing
    ? (listing.datum.pricePolicyHex + listing.datum.priceNameHex).toLowerCase()
    : "";
  const probeEnabled =
    babelFeatureOn && !isSeller && Boolean(walletApi) && Boolean(listing) && Boolean(priceUnit);
  // Only surface results that match the listing the user is currently looking at.
  const babel = babelProbe?.forUnit === priceUnit ? babelProbe.result : null;

  useEffect(() => {
    // Diagnostic — the babel-fee toggle has five render-gate AND six on-chain
    // dependencies; this log makes silent gating visible in DevTools so a user
    // hitting "no checkbox" can self-diagnose without a code change.
    // eslint-disable-next-line no-console
    console.info("[babel-probe] gates", {
      featureFlag: babelFeatureOn,
      isSeller,
      hasWallet: Boolean(walletApi),
      hasListing: Boolean(listing),
      priceUnit,
      probeWillRun: probeEnabled,
    });
    if (!probeEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await makeClient(walletApi!);
        const result = await probeBabelAvailability(client, priceUnit);
        // eslint-disable-next-line no-console
        console.info("[babel-probe] result", {
          ok: Boolean(result),
          priceUnit,
          tankOutRef: result?.tank.utxo.txHash
            ? `${result.tank.utxo.txHash}#${result.tank.utxo.outputIndex}`
            : null,
        });
        if (!cancelled) setBabelProbe({ forUnit: priceUnit, result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-console
        console.error("[babel-probe] threw", msg);
        if (!cancelled) {
          setBabelProbeError(msg);
          setBabelProbe({ forUnit: priceUnit, result: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [probeEnabled, walletApi, priceUnit, babelFeatureOn, isSeller, listing]);

  // Human-readable HOSKY estimate for the opt-in label.
  const babelHoskyEstimate = useMemo(() => {
    if (!babel) return null;
    const payingToken = babel.tank.datum.allowedTokens[0];
    try {
      return requiredTokenPayment({
        adaUsed: BABEL_ADA_USED_LOVELACE,
        priceInLovelaces: babel.oracle.priceInLovelaces,
        denominator: babel.oracle.denominator,
        amount: payingToken.amount,
        divider: payingToken.divider,
      });
    } catch {
      return null;
    }
  }, [babel]);

  const onBuy = async () => {
    if (!manifest || !walletApi || !listing || !walletAddress || !sellerBech32) {
      setErr("missing context to build the buy tx");
      return;
    }
    setBusy(true);
    setErr(null);
    setTx(null);
    setConfirmation(null);
    try {
      const client = await makeClient(walletApi);
      // Pick the first jar UTxO. Sharded jars are future work; the
      // jar address is parameterised on the admin pkh so for a given
      // marketplace there's only one set of jars at one address.
      const jarUtxos = adaptUtxos(
        await client.getUtxos(Address.fromBech32(manifest.jarAddress)),
      );
      if (jarUtxos.length === 0) {
        throw new Error(
          "no jar UTxO at the configured jar address — admin needs to seed one (see /admin/jars)",
        );
      }
      const jarUtxo = jarUtxos[0];
      // Pull the connected wallet's UTxOs — Evolution will balance,
      // picking what it needs to cover the price token + tx fee.
      const walletUtxos = adaptUtxos(
        await client.getUtxos(Address.fromBech32(walletAddress)),
      );
      const res = await submitMarketBuy(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarAddress: manifest.jarAddress,
        jarScriptHashHex: manifest.jarScriptHash,
        adminPkhHex: manifest.adminPkhHex,
        listingUtxo: listing.utxo,
        listing: listing.datum,
        sellerBech32Address: sellerBech32,
        jarUtxo,
        buyerInputs: walletUtxos,
        buyerBech32Address: walletAddress,
        babelFee: babelEnabled && babel ? {
          tank: babel.tank,
          oracle: babel.oracle,
          adaUsedLovelace: BABEL_ADA_USED_LOVELACE,
          paymentMinLovelace: BABEL_PAYMENT_MIN_LOVELACE,
          parameters: babel.parameters,
          oracleDataUtxo: babel.oracleDataUtxo,
          oracleRefScriptUtxo: babel.oracleRefScriptUtxo,
          tankRefScriptUtxo: babel.tankRefScriptUtxo,
        } : undefined,
      });
      setTx(res.txHash);
      setConfirmation("confirming");
      awaitTxConfirmation(client, res.txHash)
        .then(() => {
          setConfirmation("confirmed");
          setRefreshNonce((n) => n + 1);
          refreshHistory();
        })
        .catch((chainErr) => {
          console.warn("buy tx not confirmed:", chainErr);
          setConfirmation("rejected");
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!manifest || !walletApi || !listing) return;
    setBusy(true);
    setErr(null);
    setTx(null);
    setConfirmation(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: listing.utxo,
        sellerPkhHex: listing.datum.sellerPkhHex,
      });
      setTx(res.txHash);
      setConfirmation("confirming");
      awaitTxConfirmation(client, res.txHash)
        .then(() => {
          setConfirmation("confirmed");
          setRefreshNonce((n) => n + 1);
          refreshHistory();
        })
        .catch((chainErr) => {
          console.warn("cancel tx not confirmed:", chainErr);
          setConfirmation("rejected");
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/market" className="hover:text-zinc-300">
          ← back to market
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">{displayName}</h1>
        {matchingPools.length > 0 ? <PoolChips tickers={matchingPools} /> : null}
        <p className="break-all font-mono text-xs text-zinc-500">{unit}</p>
      </header>

      {!manifest ? (
        <p className="text-sm text-amber-300">marketplace not deployed.</p>
      ) : !listing ? (
        err ? (
          <p className="text-sm text-red-300">{err}</p>
        ) : (
          <p className="text-sm text-zinc-500">looking up the listing…</p>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          {imageUrl ? (
            <div className="aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={displayName}
                className="h-full w-full object-cover"
                loading="lazy"
                draggable={false}
              />
            </div>
          ) : null}
          <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
            <Row label="price">
              <span className="font-mono text-base text-sky-400">
                {formatPriceQty(
                  listing.datum.priceQty,
                  priceLabel?.decimals ?? 0,
                )}{" "}
                <span className="text-sky-300/80">
                  {priceLabel?.ticker ?? priceLabel?.label ?? "?"}
                </span>
              </span>
            </Row>
            <Row label="bond">
              {formatPriceQty(listing.datum.accompanyingLovelace, 6)} ADA
            </Row>
            <Row label="seller">
              <span className="break-all">
                {sellerBech32 ?? `pkh: ${listing.datum.sellerPkhHex}`}
              </span>
            </Row>
            <Row label="utxo">
              {listing.utxo.txHash}.{listing.utxo.outputIndex}
            </Row>
            {!isSeller && babelFeatureOn && babel ? (
              <label className="flex flex-col gap-1 rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-100 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={babelEnabled}
                    onChange={(e) => setBabelEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-500"
                  />
                  <span className="font-semibold">babel fees (pay tx fee in HOSKY)</span>
                </span>
                {babelHoskyEstimate ? (
                  <span className="text-[10px] text-amber-200/80">
                    ≈ {babelHoskyEstimate.toLocaleString()} HOSKY extra · tank covers ~
                    {(Number(BABEL_ADA_USED_LOVELACE) / 1_000_000).toFixed(2)} ADA fee
                  </span>
                ) : null}
              </label>
            ) : null}
            {/*
             * One friendly line when the feature flag is on but the toggle
             * isn't available (probe still running, probe returned null, or
             * probe threw). The underlying cause is logged to the console
             * for support — users only see a plain "not available".
             */}
            {babelFeatureOn && !isSeller && !babel ? (
              <p className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[10px] text-zinc-500">
                babel fees not available at the moment.
              </p>
            ) : null}
            <div className="pt-2">
              {isSeller ? (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:bg-zinc-800"
                >
                  {busy ? "signing…" : "cancel listing"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onBuy}
                  disabled={busy || !walletApi || !sellerBech32}
                  className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busy ? "signing…" : "buy"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {err && listing ? (
        <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      ) : null}
      {tx ? (
        <div className="space-y-2 rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
          <p className="break-all">↗ {tx}</p>
          <ConfirmationChip status={confirmation} />
        </div>
      ) : null}
    </main>
  );
}

function PoolChips({ tickers }: { tickers: string[] }) {
  const visible = tickers.slice(0, 3);
  const overflow = tickers.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1" title={`matches: ${tickers.join(", ")}`}>
      {visible.map((t) => (
        <span
          key={t}
          className="rounded bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-300"
        >
          {t}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 sm:w-24">
        {label}
      </span>
      <span className="break-all font-mono text-xs text-zinc-200">{children}</span>
    </div>
  );
}

function formatPriceQty(qty: bigint, decimals: number): string {
  if (decimals === 0) return formatThousands(qty);
  const divisor = 10n ** BigInt(decimals);
  const whole = qty / divisor;
  const frac = qty % divisor;
  if (frac === 0n) return formatThousands(whole);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${formatThousands(whole)}.${fracStr}`;
}

function formatThousands(n: bigint): string {
  const s = n.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
