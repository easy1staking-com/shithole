"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ConfirmationChip,
  type ChainConfirmation,
} from "@/components/ConfirmationChip";
import { useNftMetadata } from "@/lib/api/hooks";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { listPools, matchesPool } from "@/lib/market/poolTraits";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import {
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import { isSupportedCollection } from "@/lib/market/supportedCollections";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { makeClient } from "@/lib/tx/evolutionClient";
import {
  submitMarketBulkCancel,
  submitMarketCancel,
} from "@/lib/tx/marketCancel";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

function listingKey(l: DecodedListing): string {
  return `${l.utxo.txHash}:${l.utxo.outputIndex}`;
}

/**
 * Standalone "your marketplace listings" panel — shows the connected
 * wallet's open listings with image, name, price, pool chips, and a
 * one-click Cancel per row. Rendered on its own page at
 * {@code /market/me} (previously inlined under the create-listing
 * drawer; lifted out so it has room to breathe + a dedicated nav
 * destination).
 *
 * <p>Mirror of the browse-side {@code ListingCard} visual vocabulary
 * (image + name + pool chips + price) but in a horizontal row format
 * to accommodate the per-row Cancel action.
 */
export function MyListings() {
  const { data: manifest, loading: manifestLoading } =
    useDerivedMarketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);

  const [all, setAll] = useState<DecodedListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ChainConfirmation>(null);

  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  const refresh = useCallback(async () => {
    if (!marketplaceAddress || !walletApi) return;
    setLoading(true);
    setErr(null);
    try {
      const client = await makeClient(walletApi);
      const list = await fetchMarketListings(client, marketplaceAddress);
      setAll(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [marketplaceAddress, walletApi]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mine = useMemo(
    () =>
      walletPkh
        ? all.filter(
            (l) =>
              l.datum.sellerPkhHex.toLowerCase() === walletPkh.toLowerCase() &&
              isSupportedCollection(l.listedUnits[0] ?? ""),
          )
        : [],
    [all, walletPkh],
  );

  // Drop selections whose listing has disappeared (refresh, sweep, etc.)
  // so the "select all" + count stay honest after the underlying set
  // shifts. Derived from the live `mine` list rather than a separate
  // useEffect to avoid the setState-in-effect lint trap.
  const liveKeys = useMemo(() => new Set(mine.map(listingKey)), [mine]);
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((k) => liveKeys.has(k))),
    [selected, liveKeys],
  );
  const selectedCount = effectiveSelected.size;
  const allSelected = mine.length > 0 && selectedCount === mine.length;

  const toggle = useCallback((key: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((s) => {
      if (s.size >= mine.length) return new Set();
      return new Set(mine.map(listingKey));
    });
  }, [mine]);

  const priceTokens = supportedPriceTokens();

  const onCancel = async (l: DecodedListing) => {
    if (!manifest || !walletApi) return;
    const k = listingKey(l);
    setBusyKey(k);
    setErr(null);
    setTx(null);
    setConfirmation(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: l.utxo,
        sellerPkhHex: l.datum.sellerPkhHex,
      });
      setTx(res.txHash);
      // Refresh only AFTER the chain has seen the cancel. Refreshing
      // at submit time just reads the same not-yet-spent UTxOs and
      // leaves the cancelled listing stuck in the panel.
      setConfirmation("confirming");
      awaitTxConfirmation(client, res.txHash)
        .then(() => {
          setConfirmation("confirmed");
          refresh();
        })
        .catch((chainErr) => {
          console.warn("cancel tx not confirmed:", chainErr);
          setConfirmation("rejected");
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const onBulkCancel = async () => {
    if (!manifest || !walletApi || selectedCount === 0) return;
    const targets = mine.filter((l) => effectiveSelected.has(listingKey(l)));
    if (targets.length === 0) return;
    setBulkBusy(true);
    setErr(null);
    setTx(null);
    setConfirmation(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketBulkCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: targets.map((l) => l.utxo),
        // All targets share the same seller (walletPkh); pull it from the
        // first datum for symmetry with the single-cancel call shape.
        sellerPkhHex: targets[0].datum.sellerPkhHex,
      });
      setTx(res.txHash);
      setSelected(new Set());
      setConfirmation("confirming");
      awaitTxConfirmation(client, res.txHash)
        .then(() => {
          setConfirmation("confirmed");
          refresh();
        })
        .catch((chainErr) => {
          console.warn("bulk cancel tx not confirmed:", chainErr);
          setConfirmation("rejected");
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const anyBusy = bulkBusy || busyKey !== null;

  if (!walletPkh) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-center">
        <p className="text-sm text-zinc-400">
          connect your wallet to see your marketplace listings.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-zinc-100">
          your marketplace listings
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || anyBusy}
          className="rounded border border-zinc-800 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-300 disabled:opacity-50"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </header>

      {mine.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {loading || manifestLoading
            ? "scanning the marketplace…"
            : "you have no active listings."}
        </p>
      ) : (
        <>
          {/* Selection toolbar — only useful once there are listings to
           *  pick from. "select all" doubles as deselect when everything
           *  is already checked. Bulk Cancel sits here so the action stays
           *  visible no matter how far down the list the user has scrolled. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-900 bg-zinc-950 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={allSelected}
                // Indeterminate sits between unchecked and fully-checked when
                // SOME (but not all) rows are selected — surfaces partial
                // state in the header so the user knows the next click will
                // select-all (vs. clear).
                ref={(el) => {
                  if (el) {
                    el.indeterminate = selectedCount > 0 && !allSelected;
                  }
                }}
                onChange={toggleAll}
                disabled={anyBusy}
                className="h-4 w-4 accent-sky-500"
                aria-label="select all"
              />
              <span>
                {selectedCount === 0
                  ? `${mine.length} listing${mine.length === 1 ? "" : "s"}`
                  : `${selectedCount} of ${mine.length} selected`}
              </span>
            </label>
            <button
              type="button"
              onClick={onBulkCancel}
              disabled={selectedCount === 0 || anyBusy}
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {bulkBusy
                ? `cancelling ${selectedCount}…`
                : selectedCount === 0
                  ? "cancel selected"
                  : `cancel ${selectedCount}`}
            </button>
          </div>

          <ul className="space-y-2">
            {mine.map((l) => {
              const key = listingKey(l);
              return (
                <ListingRow
                  key={key}
                  listing={l}
                  priceTokens={priceTokens}
                  selected={effectiveSelected.has(key)}
                  onToggle={() => toggle(key)}
                  busy={busyKey === key}
                  disabled={anyBusy}
                  onCancel={() => onCancel(l)}
                />
              );
            })}
          </ul>
        </>
      )}

      {err ? (
        <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {err}
        </p>
      ) : null}
      {tx ? (
        <div className="space-y-2 rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-[10px] text-emerald-200">
          <p className="break-all">↗ {tx}</p>
          <ConfirmationChip status={confirmation} />
        </div>
      ) : null}
    </section>
  );
}

function ListingRow({
  listing,
  priceTokens,
  selected,
  onToggle,
  busy,
  disabled,
  onCancel,
}: {
  listing: DecodedListing;
  priceTokens: SupportedPriceToken[];
  selected: boolean;
  onToggle: () => void;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  const unit = listing.listedUnits[0] ?? "";
  const meta = useNftMetadata(unit);
  const name =
    meta.data?.name ?? prettyAssetName(unit) ?? truncate(unit, 22);
  const imageUrl = meta.data?.image_url ?? null;

  const priceLabel = resolvePriceLabel(listing, priceTokens);
  const displayPrice = formatPriceQty(listing.datum.priceQty, priceLabel.decimals);

  const matchingPools = useMemo(() => {
    const traits = meta.data?.traits ?? [];
    if (traits.length === 0) return [];
    return listPools()
      .filter((p) => matchesPool(traits, p).length > 0)
      .map((p) => p.ticker);
  }, [meta.data]);

  return (
    <li
      className={`flex items-center gap-3 rounded border bg-zinc-950 p-3 transition-colors ${
        selected
          ? "border-sky-700/60 bg-sky-950/10"
          : "border-zinc-900 hover:border-zinc-800"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="h-4 w-4 shrink-0 accent-sky-500"
        aria-label={`select ${name}`}
      />
      <Thumbnail url={imageUrl} alt={name} seed={unit} />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-sm font-semibold text-zinc-100">{name}</h3>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-base text-sky-400">
            {displayPrice}
            <span className="ml-1 text-xs text-sky-300/80">{priceLabel.label}</span>
          </span>
          {matchingPools.length > 0 ? (
            <PoolChips tickers={matchingPools} />
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-zinc-700">
              no pool match
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="shrink-0 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {busy ? "signing…" : "cancel"}
      </button>
    </li>
  );
}

function Thumbnail({
  url,
  alt,
  seed,
}: {
  url: string | null;
  alt: string;
  seed: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    const [h1, h2] = seedToHues(seed);
    return (
      <div
        className="h-16 w-16 shrink-0 rounded bg-zinc-900"
        style={{
          backgroundImage: `linear-gradient(135deg, hsl(${h1} 55% 16%) 0%, hsl(${h2} 55% 28%) 100%)`,
        }}
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setErrored(true)}
      className="h-16 w-16 shrink-0 rounded object-cover"
    />
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

type ResolvedPriceLabel = { label: string; decimals: number };

function resolvePriceLabel(
  listing: DecodedListing,
  registry: SupportedPriceToken[],
): ResolvedPriceLabel {
  const unitHex = (
    listing.datum.pricePolicyHex + listing.datum.priceNameHex
  ).toLowerCase();
  for (const t of registry) {
    if ((t.unit || "").toLowerCase() === unitHex) {
      return { label: t.ticker ?? t.label, decimals: t.decimals };
    }
  }
  try {
    const asciiName = hexToAscii(listing.datum.priceNameHex);
    if (asciiName) return { label: `?${asciiName}`, decimals: 0 };
  } catch {
    /* ignore */
  }
  const head = listing.datum.pricePolicyHex.slice(0, 6);
  return { label: `?${head}…`, decimals: 0 };
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
  if (s.length <= 3) return s;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function prettyAssetName(unit: string): string | null {
  if (unit.length <= 56) return null;
  try {
    const ascii = hexToAscii(unit.slice(56));
    return ascii || null;
  } catch {
    return null;
  }
}

function hexToAscii(hex: string): string {
  if (!hex || hex.length % 2 !== 0) throw new Error("bad hex");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x20 || code > 0x7e) throw new Error("non-printable");
    out += String.fromCharCode(code);
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function seedToHues(seed: string): [number, number] {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return [acc % 360, (acc * 7919) % 360];
}
