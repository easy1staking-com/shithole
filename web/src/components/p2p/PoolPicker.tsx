"use client";

import { useMemo } from "react";

import { usePools } from "@/lib/api/hooks";
import type { Pool } from "@/types/api";

/**
 * Pool picker for the v3 wanted-listing creation flow. Lists every active
 * curated pool from `GET /api/p2p/pools` as a selectable card. Selection is
 * controlled via {@link onSelect}; the parent (the create-listing form)
 * holds the selected pool to pass into the tx builder.
 *
 * <p>States:
 * <ul>
 *   <li>Loading — shows skeleton cards (no spinner, less jarring).</li>
 *   <li>Empty — the curation hasn't been published yet (BE has 0 active
 *   rows). Renders an explainer; this is the EXPECTED state on dev/preprod
 *   until {@code pools.json} is populated.</li>
 *   <li>Error — network/BE failure. Renders the error + a retry hint.</li>
 *   <li>Populated — pool cards; click selects one.</li>
 * </ul>
 *
 * <p>Pool stats (asset count, optional pool_id) are rendered in muted text
 * — the picker's job is to communicate "which delegators is this listing
 * targeting?", not surface every detail.
 */
export function PoolPicker({
  selectedTicker,
  onSelect,
}: {
  selectedTicker?: string | null;
  onSelect: (pool: Pool) => void;
}) {
  const { data: pools, isPending, isError, error, refetch } = usePools();

  if (isPending) {
    return <SkeletonGrid />;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm">
        <p className="font-medium text-red-200">couldn&apos;t load pools</p>
        <p className="mt-1 text-red-300/70">{error.message}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 text-red-200 underline underline-offset-2 hover:text-red-100"
        >
          retry
        </button>
      </div>
    );
  }

  if (!pools || pools.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="curated pools"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {pools.map((pool) => (
        <PoolCard
          key={pool.merkle_root_hex}
          pool={pool}
          selected={pool.ticker === selectedTicker}
          onSelect={() => onSelect(pool)}
        />
      ))}
    </div>
  );
}

function PoolCard({
  pool,
  selected,
  onSelect,
}: {
  pool: Pool;
  selected: boolean;
  onSelect: () => void;
}) {
  const truncatedRoot = useMemo(
    () => `${pool.merkle_root_hex.slice(0, 8)}…${pool.merkle_root_hex.slice(-6)}`,
    [pool.merkle_root_hex],
  );

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={
        "group relative flex flex-col rounded-lg border p-4 text-left transition " +
        (selected
          ? "border-amber-500 bg-amber-950/30 ring-2 ring-amber-500/40"
          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600")
      }
    >
      <span className="font-mono text-lg font-semibold tracking-tight">
        {pool.ticker}
      </span>
      <span className="mt-1 text-xs text-zinc-400">
        {pool.total_assets.toLocaleString()} NFTs accepted
      </span>
      <span
        className="mt-2 font-mono text-[10px] text-zinc-500"
        title={pool.merkle_root_hex}
      >
        root {truncatedRoot}
      </span>
      {pool.pool_id_hex ? (
        <span
          className="mt-1 font-mono text-[10px] text-zinc-500"
          title={pool.pool_id_hex}
        >
          pool {pool.pool_id_hex.slice(0, 6)}…{pool.pool_id_hex.slice(-4)}
        </span>
      ) : (
        <span className="mt-1 text-[10px] italic text-zinc-600">
          no on-chain pool id
        </span>
      )}
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[120px] animate-pulse rounded-lg border border-zinc-800 bg-zinc-950/40"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-400">
      <p className="font-medium text-zinc-200">no pools curated yet</p>
      <p className="mt-1 text-zinc-500">
        the curation registry is empty — once a stake-pool operator publishes
        their accepted trait set, it&apos;ll show up here. check back later.
      </p>
    </div>
  );
}

/**
 * Tiny convenience for components that want JUST the selected pool's
 * details (e.g. an inline summary chip after the user picks one).
 */
export function PoolSummary({ pool }: { pool: Pool }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">
      <span className="font-mono font-semibold">{pool.ticker}</span>
      <span className="text-zinc-500">·</span>
      <span className="text-zinc-500">
        {pool.total_assets.toLocaleString()} NFTs
      </span>
    </div>
  );
}
