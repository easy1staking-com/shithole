"use client";

import { useMemo } from "react";

import { listPools, matchesPool } from "@/lib/market/poolTraits";

/**
 * Compact strip of pool tickers an NFT's traits match. Caps at
 * {@code maxVisible} chips + a "+N" overflow chip so an NFT matching
 * many pools doesn't blow up the card layout. Returns {@code null}
 * when there are no matches — callers can drop it unconditionally.
 *
 * <p>The (category, value) trait shape comes off the BE metadata
 * (resolved client-side via {@code useNftMetadata}); pass
 * {@code meta.data?.traits} directly.
 */
export function PoolChips({
  traits,
  tickers: tickersOverride,
  maxVisible = 3,
}: {
  /**
   * Raw NFT traits — chip tickers are derived per render via
   * {@code listPools + matchesPool}. Use when metadata is fetched
   * per-card.
   */
  traits?: Array<{ category: string; value: string }>;
  /**
   * Pre-computed ticker list — skips trait matching. Use when the
   * caller has batched pool membership (e.g. {@code useAssetPoolMembership})
   * and already knows the tickers per asset.
   */
  tickers?: string[];
  maxVisible?: number;
}) {
  const tickers = useMemo(() => {
    if (tickersOverride) return tickersOverride;
    if (!traits || traits.length === 0) return [];
    return listPools()
      .filter((p) => matchesPool(traits, p).length > 0)
      .map((p) => p.ticker);
  }, [tickersOverride, traits]);

  if (tickers.length === 0) return null;
  const visible = tickers.slice(0, maxVisible);
  const overflow = tickers.length - visible.length;
  return (
    <div
      className="flex flex-wrap gap-1"
      title={`matches: ${tickers.join(", ")}`}
    >
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
