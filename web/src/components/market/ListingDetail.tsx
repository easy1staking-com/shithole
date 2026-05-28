"use client";

import { Address } from "@evolution-sdk/evolution";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import {
  splitUnit,
  supportedPriceTokens,
} from "@/lib/market/supportedPriceTokens";
import { decodeAddressData } from "@/lib/tx/decodeAddressData";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitMarketBuy } from "@/lib/tx/marketBuy";
import { submitMarketCancel } from "@/lib/tx/marketCancel";
import { adaptUtxos } from "@/lib/tx/utxo";
import { useNftMetadata } from "@/lib/api/hooks";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

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

  const [listing, setListing] = useState<DecodedListing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);

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
  }, [marketplaceAddress, walletApi, unit]);

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

  const onBuy = async () => {
    if (!manifest || !walletApi || !listing || !walletAddress || !sellerBech32) {
      setErr("missing context to build the buy tx");
      return;
    }
    setBusy(true);
    setErr(null);
    setTx(null);
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
      });
      setTx(res.txHash);
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
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: listing.utxo,
        sellerPkhHex: listing.datum.sellerPkhHex,
      });
      setTx(res.txHash);
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
        <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
          ↗ {tx}
        </p>
      ) : null}
    </main>
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
