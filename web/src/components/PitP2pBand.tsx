"use client";

import Link from "next/link";

import { ErrorView } from "@/components/ErrorView";
import { useCurated } from "@/lib/api/hooks";
import type { CuratedCollection } from "@/types/api";

/**
 * Subordinate "other ways to offload your s#!t" band below the marketplace
 * strips. Two mode cards — the Pit (random in-collection swap) and P2P
 * (direct swap) — each showing curated-collection chips. Pit/P2P require
 * on-chain configs, so this is driven by {@code /api/curated}, not the
 * marketplace whitelist; empty until collections are curated.
 */
export function PitP2pBand() {
  const { data, isLoading, error } = useCurated();
  const collections = data ?? [];

  return (
    <section className="space-y-4 border-t border-zinc-900 pt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-lg font-semibold uppercase tracking-wide text-zinc-200">
          other ways to offload your s#!t
        </h2>
        <span className="hidden font-mono text-[11px] uppercase tracking-widest text-zinc-600 sm:inline">
          same collections · different mechanics
        </span>
      </div>

      {error ? (
        <ErrorView error={error} context={{ subject: "pits" }} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard
            title="the pit"
            tint="#fb923c"
            kicker="Drop an NFT in, take whatever random one surfaces. For when you don't care what you get — you just want a different worthless thing."
            collections={collections}
            loading={isLoading}
            chipHref={(c) => `/pit/${c.slug}`}
            cta={
              collections[0]
                ? { label: "enter a pit →", href: `/pit/${collections[0].slug}` }
                : null
            }
            emptyLabel="no pits curated on this network yet."
          />
          <ModeCard
            title="p2p swaps"
            tint="#34d399"
            kicker="Trade direct — name the exact s#!t you want, list the s#!t you don't. No pit, no randomness, just a straight swap with another holder."
            collections={collections}
            loading={isLoading}
            chipHref={() => "/p2p"}
            cta={{ label: "browse swaps →", href: "/p2p" }}
            emptyLabel="no open swaps yet — be the first."
          />
        </div>
      )}
    </section>
  );
}

function ModeCard({
  title,
  tint,
  kicker,
  collections,
  loading,
  chipHref,
  cta,
  emptyLabel,
}: {
  title: string;
  tint: string;
  kicker: string;
  collections: CuratedCollection[];
  loading: boolean;
  chipHref: (c: CuratedCollection) => string;
  cta: { label: string; href: string } | null;
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h3 className="flex items-center gap-2.5 font-mono text-base font-semibold uppercase tracking-wide text-zinc-100">
        <span
          className="h-2.5 w-2.5 flex-none rounded-full"
          style={{ background: tint, boxShadow: `0 0 0 3px ${tint}22` }}
        />
        {title}
      </h3>
      <p className="max-w-prose text-sm text-zinc-400">{kicker}</p>

      {loading ? (
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-28 animate-pulse rounded-lg border border-zinc-900 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <p className="text-xs text-zinc-600">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {collections.map((c) => (
            <Link
              key={c.slug}
              href={chipHref(c)}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 hover:border-zinc-600"
            >
              <span
                className="h-4 w-4 flex-none rounded"
                style={{ background: c.theme?.accent_color ?? tint }}
              />
              <span className="font-mono text-xs text-zinc-200">
                {c.display_name}
              </span>
            </Link>
          ))}
        </div>
      )}

      {cta ? (
        <Link
          href={cta.href}
          className="mt-auto self-start font-mono text-xs uppercase tracking-widest text-sky-400 hover:text-sky-300"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
