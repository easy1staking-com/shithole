/**
 * Internal brand preview — shows each logo variant on dark + light
 * backgrounds at three sizes. Throwaway page; delete once we pick a
 * final lockup.
 */

import Link from "next/link";

type Variant = {
  slug: string;
  name: string;
  vibe: string;
  src: string;
  /** Native aspect ratio — drives the preview tile width. */
  ratio: number;
};

const VARIANTS: Variant[] = [
  {
    slug: "v1-drain-mono",
    name: "Drain Swirl",
    vibe: "Wordmark with the 'o' replaced by a tightening swirl. Mirrors the in-app swap reveal animation. Polished-monospace, balanced.",
    src: "/brand/logo-v1-drain-mono.svg",
    ratio: 320 / 64,
  },
  {
    slug: "v2-mark-only",
    name: "Drain Mark",
    vibe: "Just the swirl on a dark dish. Favicon / app-icon use. The 'small footprint' lockup.",
    src: "/brand/logo-v2-mark-only.svg",
    ratio: 1,
  },
  {
    slug: "v3-serif-crest",
    name: "Serif Crest",
    vibe: "Fancy serif + ornament. The 'this is fine art' joke — treats worthless NFTs like a luxury imprint.",
    src: "/brand/logo-v3-serif-crest.svg",
    ratio: 360 / 96,
  },
  {
    slug: "v4-pixel-mascot",
    name: "Pixel Mascot",
    vibe: "16-bit chunky swirl. Maximally on-brand for the pixel-art collection era (HOSKY CashGrab et al.). Punk angle.",
    src: "/brand/logo-v4-pixel-mascot.svg",
    ratio: 1,
  },
  {
    slug: "v5-stencil-tag",
    name: "Stencil Tag",
    vibe: "Spray-paint warehouse wordmark with a paint-drip on the '!'. Graffiti energy without the retro overhead.",
    src: "/brand/logo-v5-stencil-tag.svg",
    ratio: 320 / 80,
  },
];

const SIZES = [
  { label: "32px (favicon)", height: 32 },
  { label: "64px (header)", height: 64 },
  { label: "128px (hero)", height: 128 },
];

export default function BrandPreviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
        >
          ← back
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Logo variants
        </h1>
        <p className="text-sm text-zinc-400 max-w-2xl">
          5 angles on the wordmark. Each tile shows the SVG at 3 sizes,
          rendered against the app&apos;s dark surface and a neutral light
          surface to gut-check both contrast targets. Pick one (or
          combine — e.g. v2 mark + v1 wordmark in different contexts).
        </p>
      </header>

      <ol className="flex flex-col gap-10">
        {VARIANTS.map((v) => (
          <li key={v.slug} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-xs font-mono text-zinc-500">{v.slug}</span>
              <h2 className="text-xl font-semibold">{v.name}</h2>
            </div>
            <p className="text-sm text-zinc-400 max-w-3xl">{v.vibe}</p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Dark surface (app default) */}
              <div className="space-y-2">
                <p className="text-[0.6rem] uppercase tracking-widest text-zinc-500">
                  on dark
                </p>
                <div className="flex flex-col items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
                  {SIZES.map((s) => (
                    <div key={s.label} className="flex w-full items-center gap-4">
                      <span className="w-32 text-[0.6rem] text-zinc-500">
                        {s.label}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={v.src}
                        alt={`${v.name} at ${s.label}`}
                        style={{ height: s.height, width: s.height * v.ratio }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Light surface */}
              <div className="space-y-2">
                <p className="text-[0.6rem] uppercase tracking-widest text-zinc-500">
                  on light
                </p>
                <div className="flex flex-col items-start gap-4 rounded-lg border border-zinc-300 bg-zinc-100 p-6 text-zinc-900">
                  {SIZES.map((s) => (
                    <div key={s.label} className="flex w-full items-center gap-4">
                      <span className="w-32 text-[0.6rem] text-zinc-500">
                        {s.label}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={v.src}
                        alt={`${v.name} at ${s.label}`}
                        style={{ height: s.height, width: s.height * v.ratio }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
