"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useP2pListings } from "@/lib/api/hooks";
import type { CuratedCollection } from "@/types/api";

/**
 * Landing-page card for a p2p-enabled collection. Visually distinguished
 * from the v2 pit cards via:
 * <ul>
 *   <li>3:2 → 2:1 aspect (wider, less tall) so the two sections feel
 *       like different modes rather than parallel columns</li>
 *   <li>A "P2P" chip overlaid in the top-right corner</li>
 *   <li>A live "N open · paying X ADA" stats strip — surfaces the
 *       transactional nature of p2p vs the swap-pool nature of pits</li>
 * </ul>
 *
 * <p>Reuses the collection's existing background + mascot + accent
 * so users still recognize "this is Hosky" without confusing it for
 * the pit entry.
 *
 * <p>Click → {@code /p2p?config=<config_nft_policy>} — the browse page
 * already supports the {@code config} filter, so we get a collection-
 * scoped listings view for free.
 */
export function P2pCard({ collection }: { collection: CuratedCollection }) {
  const accent = collection.theme?.accent_color ?? "#b87333";
  const bgUrl = collection.theme?.background_url ?? "/pit/default-pit.webp";
  const mascot = collection.theme?.mascot_image_url ?? null;

  // Live stats — drives the strip at the bottom. Cap query to 50; if the
  // count hits 50+ we'll just say "50+". Empty array → "no open listings"
  // copy on the card.
  const { data: listings } = useP2pListings({
    config: collection.config_nft_policy,
    size: 50,
  });
  const stats = useMemo(() => {
    if (!listings) return null;
    if (listings.length === 0) {
      return { count: 0, avgAda: null as number | null };
    }
    const total = listings.reduce((s, l) => s + Number(l.lovelace), 0);
    const avgAda = total / listings.length / 1_000_000;
    return { count: listings.length, avgAda };
  }, [listings]);

  return (
    <Link
      href={`/p2p?config=${encodeURIComponent(collection.config_nft_policy)}`}
      className="group relative block aspect-[2/1] overflow-hidden rounded-xl border transition-colors hover:border-zinc-400"
      style={{ borderColor: `${accent}55` }}
      title={`Browse ${collection.display_name} p2p listings`}
    >
      {/* Background image — same per-collection bg as the pit card */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        loading="lazy"
        draggable={false}
      />

      {/* Dark overlay — slightly stronger than the pit card so the
       *  p2p chip + stats read clearly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.25) 100%)",
        }}
        aria-hidden
      />

      {/* P2P chip — top-right corner. The single visual marker that
       *  says "this is the trade-direct flow, not the pit". */}
      <span
        className="absolute right-3 top-3 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest backdrop-blur"
        style={{ color: accent, border: `1px solid ${accent}aa` }}
      >
        p2p
      </span>

      {/* Caption strip — title + mascot + stats. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
        <div className="flex items-center gap-3">
          {mascot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mascot}
              alt=""
              className="h-12 w-12 flex-none rounded-full bg-zinc-950/60 object-cover ring-2"
              style={{ boxShadow: `0 0 0 2px ${accent}` }}
              loading="lazy"
              aria-hidden
            />
          ) : (
            <span
              className="h-3 w-3 flex-none rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold text-zinc-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              {collection.display_name}
            </h3>
            <p className="font-mono text-[11px] text-zinc-300/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
              direct trade — find a delegator with matching traits
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-300/80">
          {!stats ? (
            <span className="text-zinc-400/70">…</span>
          ) : stats.count === 0 ? (
            <span className="text-zinc-400/70">no open listings — be the first</span>
          ) : (
            <>
              <span>
                <span className="font-mono text-zinc-100">{stats.count}</span>{" "}
                open
              </span>
              {stats.avgAda !== null && (
                <span>
                  · avg bounty{" "}
                  <span className="font-mono text-zinc-100">
                    {stats.avgAda.toFixed(2)} ADA
                  </span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
