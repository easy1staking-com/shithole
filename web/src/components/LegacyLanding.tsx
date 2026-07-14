"use client";

/**
 * Pit/P2P-first landing — the home page before the marketplace-first
 * pivot. Kept as the fallback the {@link isMarketplaceEnabled} switch
 * renders when the marketplace feature flag is OFF (a kill-switch: if the
 * marketplace is suspended, home reverts to pits/p2p rather than showing a
 * marketplace-led page with the marketplace hidden from the nav).
 */

import Link from "next/link";

import { ErrorView } from "@/components/ErrorView";
import { P2pCard } from "@/components/p2p/P2pCard";
import { useCurated } from "@/lib/api/hooks";
import type { CuratedCollection } from "@/types/api";

export function LegacyLanding() {
  const { data, isLoading, error } = useCurated();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header>
        <p className="text-sm text-zinc-400">
          Wormhole carries value across chains. S#!thole carries worthlessness
          in circles within one collection. Pick a pit, or trade direct.
        </p>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">stirring the mud…</p>}
      {error && <ErrorView error={error} context={{ subject: "pits" }} />}

      {data && data.length === 0 && (
        <p className="text-sm text-zinc-500">
          no pits yet. come back when something dies.
        </p>
      )}

      {data && data.length > 0 && (
        <>
          <section className="space-y-3">
            <SectionHeader
              title="pits"
              subtitle="drop your s#!t in, take whatever random thing surfaces."
            />
            <PitGrid data={data} />
          </section>
          <section className="space-y-3">
            <SectionHeader
              title="p2p"
              subtitle="trade direct — pick the s#!t you actually want, dump the s#!t you don't."
            />
            <P2pGrid data={data} />
          </section>
        </>
      )}
    </main>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
        {title}
      </h2>
      <p className="text-sm text-zinc-400">{subtitle}</p>
    </div>
  );
}

function P2pGrid({ data }: { data: ReadonlyArray<CuratedCollection> }) {
  return (
    <ul className="grid grid-cols-1 gap-4">
      {data
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map((c) => (
          <li key={c.slug}>
            <P2pCard collection={c} />
          </li>
        ))}
    </ul>
  );
}

function PitGrid({ data }: { data: ReadonlyArray<CuratedCollection> }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {data
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map((c, idx) => {
          const accent = c.theme.accent_color ?? "#b87333";
          const bgUrl = c.theme.background_url ?? "/pit/default-pit.webp";
          const mascot = c.theme.mascot_image_url ?? null;
          return (
            <li key={c.slug}>
              <Link
                href={`/pit/${c.slug}`}
                className="group relative block aspect-[3/2] overflow-hidden rounded-xl border border-zinc-800 transition-colors hover:border-zinc-600"
                style={{ borderColor: `${accent}55` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bgUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  loading={idx < 2 ? "eager" : "lazy"}
                  draggable={false}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0.05) 100%)",
                  }}
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay"
                  style={{
                    background: `radial-gradient(60% 50% at 50% 25%, ${accent}33 0%, transparent 70%)`,
                  }}
                  aria-hidden
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-5">
                  {mascot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mascot}
                      alt=""
                      className="h-14 w-14 flex-none rounded-full bg-zinc-950/60 object-cover ring-2"
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
                    <h2 className="truncate text-2xl font-semibold text-zinc-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                      {c.display_name}
                    </h2>
                    <p className="font-mono text-xs text-zinc-300/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                      /pit/{c.slug}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
    </ul>
  );
}
