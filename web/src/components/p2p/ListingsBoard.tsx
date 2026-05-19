"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useAssetPoolMembership, useP2pListings, usePools } from "@/lib/api/hooks";
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

      {isPending && <p className="text-sm text-zinc-500">looking for listings…</p>}
      {isError && (
        <p className="text-sm text-red-400" role="alert">
          couldn&apos;t load listings: {error.message}
        </p>
      )}
      {listings && listings.length === 0 && (
        <EmptyState filterTicker={filterTicker} />
      )}
      {listings && listings.length > 0 && (
        <ListingsList listings={listings} pools={pools ?? []} />
      )}
    </div>
  );
}

function EmptyState({ filterTicker }: { filterTicker: string | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-400">
      <p className="font-medium text-zinc-200">
        {filterTicker
          ? `no open listings targeting ${filterTicker}`
          : "no open listings yet"}
      </p>
      <p className="mt-1 text-zinc-500">
        be the first to{" "}
        <Link href="/" className="text-zinc-300 underline-offset-2 hover:underline">
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
