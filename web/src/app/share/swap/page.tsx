/**
 * Shareable swap landing page. The url query encodes the swap details
 * (slug + na/nb units + display metadata) so a copy-pasted link can
 * recreate the OG card on demand. Crawlers (Twitter, Discord, Telegram,
 * Slack) read {@code og:image} from this page's metadata and render the
 * card inline.
 *
 * <p>Human visitors landing here see a small "view this swap on
 * s#!thole" page that links into the pit it came from.
 */

import type { Metadata } from "next";
import Link from "next/link";

type SearchParams = {
  slug?: string;
  na?: string;
  nb?: string;
  display_name?: string;
  na_name?: string;
  nb_name?: string;
  accent?: string;
  tx?: string;
};

function buildOgUrl(sp: SearchParams): string {
  const qs = new URLSearchParams();
  if (sp.slug) qs.set("slug", sp.slug);
  if (sp.na) qs.set("na", sp.na);
  if (sp.nb) qs.set("nb", sp.nb);
  if (sp.display_name) qs.set("display_name", sp.display_name);
  if (sp.na_name) qs.set("na_name", sp.na_name);
  if (sp.nb_name) qs.set("nb_name", sp.nb_name);
  if (sp.accent) qs.set("accent", sp.accent);
  return `/api/og/swap?${qs.toString()}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const title = sp.display_name
    ? `swapped on /pit/${sp.slug ?? ""} — s#!thole`
    : "s#!thole — swap";
  const description =
    "Wormhole carries value across chains. S#!thole carries worthlessness in circles within one collection.";
  const ogUrl = buildOgUrl(sp);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function ShareSwapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const slug = sp.slug || "";
  const displayName = sp.display_name || "this pit";
  const accent = `#${sp.accent || "f5c518"}`;
  const ogUrl = buildOgUrl(sp);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-12">
      <div
        className="relative w-full overflow-hidden rounded-2xl border bg-zinc-950"
        style={{ borderColor: `${accent}55` }}
      >
        {/* The same OG image rendered inline so the human visitor sees
         *  what crawlers see. Lazy-loaded so the landing is fast. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ogUrl}
          alt="swap card preview"
          className="block w-full"
          loading="lazy"
        />
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          this swap happened on
        </p>
        <p
          className="mt-1 text-3xl font-semibold tracking-tight"
          style={{ color: accent }}
        >
          s#!thole · {displayName}
        </p>
        {sp.tx && (
          <p className="mt-2 font-mono text-[0.65rem] text-zinc-600 break-all">
            tx: {sp.tx}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        {slug && (
          <Link
            href={`/pit/${slug}`}
            className="rounded-md px-5 py-2 text-sm font-semibold uppercase tracking-wide"
            style={{ backgroundColor: accent, color: "#0a0a0a" }}
          >
            visit /pit/{slug}
          </Link>
        )}
        <Link
          href="/"
          className="rounded-md border border-zinc-700 px-5 py-2 text-sm uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
        >
          browse all pits
        </Link>
      </div>
    </main>
  );
}
