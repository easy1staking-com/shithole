"use client";

import Link from "next/link";

import { useCurated } from "@/lib/api/hooks";

export default function HomePage() {
  const { data, isLoading, error } = useCurated();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-mono text-4xl font-semibold tracking-tight">shithole</h1>
          <Link
            href="/me"
            className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
          >
            your shit →
          </Link>
        </div>
        <p className="text-sm text-zinc-400">
          Wormhole carries value across chains. Shithole carries worthlessness in circles
          within one collection. Pick a pit.
        </p>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">stirring the mud…</p>}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          could not load curated pits: {error.message}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-zinc-500">no pits yet. come back when something dies.</p>
      )}

      {data && data.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((c, idx) => {
              const accent = c.theme.accent_color ?? "#b87333";
              // Fallback to the shared default-pit asset when a collection
              // hasn't supplied its own background — keeps the layout
              // intact for un-themed pits.
              const bgUrl = c.theme.background_url ?? "/pit/default-pit.webp";
              const mascot = c.theme.mascot_image_url ?? null;
              return (
                <li key={c.slug}>
                  <Link
                    href={`/pit/${c.slug}`}
                    className="group relative block aspect-[3/2] overflow-hidden rounded-xl border border-zinc-800 transition-colors hover:border-zinc-600"
                    style={{ borderColor: `${accent}55` }}
                  >
                    {/* Background image — fills the tile, gentle zoom on
                     *  hover for "this is interactive" affordance. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bgUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      loading={idx < 2 ? "eager" : "lazy"}
                      draggable={false}
                    />

                    {/* Dark gradient: rich at bottom for text contrast,
                     *  fading toward the top so the image breathes. */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0.05) 100%)",
                      }}
                      aria-hidden
                    />

                    {/* Accent sheen — picks up the per-collection color
                     *  without overpowering the source image. */}
                    <div
                      className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-60"
                      style={{
                        background: `radial-gradient(60% 50% at 50% 25%, ${accent}33 0%, transparent 70%)`,
                      }}
                      aria-hidden
                    />

                    {/* Caption — title + slug + optional mascot on the
                     *  dark band at the bottom. */}
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
      )}
    </main>
  );
}
