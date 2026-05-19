"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { MultiSelectPopover } from "@/components/p2p/MultiSelectPopover";
import {
  useAssetPoolMembership,
  useCurated,
  useP2pListings,
  usePools,
} from "@/lib/api/hooks";
import { useWalletCollectionNfts } from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { P2pListing, Pool } from "@/types/api";

/**
 * /p2p browse — surface every active wanted listing the BE indexer
 * knows about. Optional pool filter narrows by accepted_merkle_root.
 *
 * <p>Cards render the offered NFT's asset_name (ASCII or short hex
 * fallback), the bounty in ADA, and pool ribbons for context (which
 * pool's delegators the listing targets). Clicking a card routes to
 * the fulfill page for that listing.
 *
 * <p>For v1 we keep filtering FE-side simple: a pool dropdown that
 * narrows via the BE's {@code root} query param when a single pool is
 * picked. "All pools" sends no filter (returns global active list).
 */
export function ListingsBoard() {
  const { data: pools, isPending: poolsPending } = usePools();
  const [filterTicker, setFilterTicker] = useState<string | null>(null);
  const [onlyFulfillable, setOnlyFulfillable] = useState(false);
  const [excludedTickers, setExcludedTickers] = useState<Set<string>>(
    () => new Set(),
  );

  const filterRoot = useMemo(() => {
    if (!pools || !filterTicker) return null;
    return pools.find((p) => p.ticker === filterTicker)?.merkle_root_hex ?? null;
  }, [pools, filterTicker]);

  const {
    data: listings,
    isPending,
    isError,
    error,
  } = useP2pListings(filterRoot ? { roots: [filterRoot] } : {});

  // ---- "I can fulfill" data plumbing ----
  // For v3 launch p2p is Hosky-only; pick the first curated collection's
  // policy id to scope the wallet-NFT lookup. When p2p expands to more
  // collections we'd union across all of them.
  const { data: curated } = useCurated();
  const collectionPolicyHex = curated?.[0]?.collection_policy_id ?? null;
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const { data: walletNfts } = useWalletCollectionNfts(
    addressBech32,
    collectionPolicyHex,
  );
  const walletAssetNamesHex = useMemo(
    () => (walletNfts ?? []).map((n) => n.assetNameHex),
    [walletNfts],
  );
  const { data: walletMembership } = useAssetPoolMembership(walletAssetNamesHex);
  // myMatchableTickers = union of all pool tickers any of the wallet's NFTs
  // belong to. A listing is matchable iff its target ticker is in this set.
  const myMatchableTickers = useMemo(() => {
    const out = new Set<string>();
    if (!walletMembership) return out;
    for (const tickers of Object.values(walletMembership)) {
      for (const t of tickers) out.add(t);
    }
    return out;
  }, [walletMembership]);
  // root_hex → ticker, used to resolve each listing's target pool
  // ticker on the fly without re-fetching per row.
  const rootToTicker = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of pools ?? []) m[p.merkle_root_hex] = p.ticker;
    return m;
  }, [pools]);

  // Apply client-side filters. The BE-side `pool` filter narrows the
  // initial fetch; these run on top of that result.
  const filteredListings = useMemo(() => {
    if (!listings) return null;
    return listings.filter((l) => {
      const targetTicker = rootToTicker[l.accepted_merkle_root];
      if (!targetTicker) return true; // listing's pool unknown to FE — keep
      if (excludedTickers.has(targetTicker)) return false;
      if (onlyFulfillable && !myMatchableTickers.has(targetTicker)) return false;
      return true;
    });
  }, [listings, rootToTicker, excludedTickers, onlyFulfillable, myMatchableTickers]);

  const toggleExcluded = (ticker: string) => {
    setExcludedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  // "I can fulfill" toggle is only useful with a connected wallet.
  const fulfillableDisabled = !addressBech32 || !walletMembership;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          open listings — idiots looking to swap
        </h1>
        <p className="text-sm text-zinc-400">
          someone locked an NFT + bounty, hoping a delegator with matching
          traits takes it off their hands. that&apos;s you, maybe.
        </p>
      </header>

      {/* Pool filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-zinc-500">
          pool:
        </span>
        <button
          type="button"
          onClick={() => setFilterTicker(null)}
          className={
            "rounded-md border px-2 py-1 text-xs " +
            (filterTicker === null
              ? "border-amber-500 bg-amber-950/40 text-amber-200"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-600")
          }
        >
          all
        </button>
        {poolsPending && (
          <span className="text-xs text-zinc-500">loading pools…</span>
        )}
        {(pools ?? []).map((p) => (
          <button
            key={p.ticker}
            type="button"
            onClick={() => setFilterTicker(p.ticker)}
            className={
              "rounded-md border px-2 py-1 font-mono text-xs " +
              (p.ticker === filterTicker
                ? "border-amber-500 bg-amber-950/40 text-amber-200"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-600")
            }
          >
            {p.ticker}
          </button>
        ))}
      </div>

      {/* Seller-mode filters: explicit, both compose with the pool filter. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-zinc-500">
          filters:
        </span>
        <label
          className={
            "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs " +
            (onlyFulfillable
              ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-600") +
            (fulfillableDisabled ? " cursor-not-allowed opacity-50" : "")
          }
          title={
            fulfillableDisabled
              ? "connect your wallet to enable"
              : "show only listings whose target pool matches one of your NFTs"
          }
        >
          <input
            type="checkbox"
            checked={onlyFulfillable}
            disabled={fulfillableDisabled}
            onChange={(e) => setOnlyFulfillable(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          only listings I can fulfill
        </label>
        <MultiSelectPopover
          label="exclude pools"
          options={(pools ?? []).map((p) => ({ value: p.ticker, label: p.ticker }))}
          selected={excludedTickers}
          onToggle={toggleExcluded}
          onClear={() => setExcludedTickers(new Set())}
        />
      </div>

      {/* Excluded chip strip — appears only when something is excluded. */}
      {excludedTickers.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">
            excluded:
          </span>
          {[...excludedTickers].sort().map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleExcluded(t)}
              className="rounded-sm bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800"
              title={`remove ${t} from excluded`}
            >
              {t} <span className="text-zinc-500">×</span>
            </button>
          ))}
        </div>
      )}

      {isPending && <p className="text-sm text-zinc-500">looking for listings…</p>}
      {isError && (
        <p className="text-sm text-red-400" role="alert">
          couldn&apos;t load listings: {error.message}
        </p>
      )}
      {filteredListings && filteredListings.length === 0 && (
        <EmptyState
          filterTicker={filterTicker}
          onlyFulfillable={onlyFulfillable}
          excludedCount={excludedTickers.size}
          serverEmpty={(listings ?? []).length === 0}
        />
      )}
      {filteredListings && filteredListings.length > 0 && (
        <ListingsList listings={filteredListings} pools={pools ?? []} />
      )}
    </div>
  );
}

function EmptyState({
  filterTicker,
  onlyFulfillable,
  excludedCount,
  serverEmpty,
}: {
  filterTicker: string | null;
  onlyFulfillable: boolean;
  excludedCount: number;
  /** True when the BE returned 0 listings (vs. filters narrowed to 0). */
  serverEmpty: boolean;
}) {
  // Pick the explanation that best matches WHY the list is empty so the
  // user knows whether to relax filters or create a listing themselves.
  const filtersActive = onlyFulfillable || excludedCount > 0;
  const headline = serverEmpty
    ? filterTicker
      ? `no open listings targeting ${filterTicker}`
      : "no open listings yet"
    : filtersActive
      ? "no listings match your filters"
      : filterTicker
        ? `no open listings targeting ${filterTicker}`
        : "no open listings yet";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-400">
      <p className="font-medium text-zinc-200">{headline}</p>
      <p className="mt-1 text-zinc-500">
        {filtersActive && !serverEmpty
          ? "relax the filters above, or "
          : "be the first to "}
        <Link
          href="/p2p/new"
          className="text-zinc-300 underline-offset-2 hover:underline"
        >
          create one
        </Link>
        .
      </p>
    </div>
  );
}

function ListingsList({
  listings,
  pools,
}: {
  listings: P2pListing[];
  pools: Pool[];
}) {
  // Batch-fetch pool membership for every listing's offered asset, so the
  // card ribbons render in one BE round-trip.
  const assetNamesHex = useMemo(
    () => listings.map((l) => l.offered_nft_unit.slice(56)),
    [listings],
  );
  const { data: membership } = useAssetPoolMembership(assetNamesHex);
  const tickerToRoot = useMemo(
    () =>
      Object.fromEntries(
        pools.map((p) => [p.ticker, p.merkle_root_hex] as const),
      ),
    [pools],
  );
  const rootToTicker = useMemo(
    () =>
      Object.fromEntries(
        pools.map((p) => [p.merkle_root_hex, p.ticker] as const),
      ),
    [pools],
  );

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((l) => (
        <li key={`${l.tx_hash}#${l.output_index}`}>
          <ListingCard
            listing={l}
            tickers={membership?.[l.offered_nft_unit.slice(56).toLowerCase()] ?? []}
            targetTicker={rootToTicker[l.accepted_merkle_root] ?? null}
            tickerToRoot={tickerToRoot}
          />
        </li>
      ))}
    </ul>
  );
}

function ListingCard({
  listing,
  tickers,
  targetTicker,
  tickerToRoot,
}: {
  listing: P2pListing;
  tickers: string[];
  targetTicker: string | null;
  tickerToRoot: Record<string, string>;
}) {
  void tickerToRoot; // reserved for a future "deep link to pool" affordance
  const assetNameAscii = useMemo(
    () => asciiOrShortHex(listing.offered_nft_unit.slice(56)),
    [listing.offered_nft_unit],
  );
  const bountyAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);

  return (
    <Link
      href={`/p2p/${listing.tx_hash}/${listing.output_index}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-sm font-semibold">
          {assetNameAscii}
        </span>
        <span className="shrink-0 font-mono text-xs text-amber-300">
          {bountyAda} ADA
        </span>
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        targeting{" "}
        <span className="font-mono text-zinc-300">
          {targetTicker ?? "unknown pool"}
        </span>
      </p>
      {tickers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tickers.map((t) => {
            const isPrimary = t === targetTicker;
            return (
              <span
                key={t}
                className={
                  "rounded-sm px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide " +
                  (isPrimary
                    ? "bg-amber-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400")
                }
              >
                {t}
              </span>
            );
          })}
        </div>
      )}
    </Link>
  );
}

/**
 * Best-effort ASCII decode of a 0-32-byte CIP-25 asset_name. Falls back to
 * an 8-char hex preview when the bytes contain non-printable characters.
 */
function asciiOrShortHex(assetNameHex: string): string {
  if (!assetNameHex) return "(no name)";
  const bytes = new Uint8Array(assetNameHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(assetNameHex.slice(i * 2, i * 2 + 2), 16);
  }
  // CIP-25 asset names that hold ASCII tend to be printable [0x20..0x7e].
  const allPrintable = bytes.every((b) => b >= 0x20 && b <= 0x7e);
  if (allPrintable) {
    return new TextDecoder().decode(bytes);
  }
  return `${assetNameHex.slice(0, 8)}…${assetNameHex.slice(-4)}`;
}
