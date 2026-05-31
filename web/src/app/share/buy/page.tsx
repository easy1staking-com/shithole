/**
 * Shareable buy landing page. The url query encodes the purchase details
 * (unit + display metadata + price) so a copy-pasted link can recreate
 * the OG card on demand. Crawlers (Twitter, Discord, Telegram, Slack)
 * read {@code og:image} from this page's metadata and render the card
 * inline.
 *
 * <p>Human visitors landing here see a small "view this on s#!thole"
 * page that links into the marketplace listing it came from.
 *
 * <p>Sibling to {@code /share/swap} (the swap variant). The OG image is
 * painted by {@code /api/og/buy}; {@code metadataBase} in the root
 * layout resolves the relative image path into the absolute https URL
 * that X requires.
 */

import type { Metadata } from "next";
import Link from "next/link";

// Driven entirely by query params (unit/name/price/...). force-dynamic
// keeps Vercel from pre-rendering it at build time with empty
// searchParams — which would generate a broken OG image URL.
export const dynamic = "force-dynamic";

type SearchParams = {
  unit?: string;
  name?: string;
  img?: string;
  price?: string;
  slug?: string;
  accent?: string;
};

function buildOgUrl(sp: SearchParams): string {
  const qs = new URLSearchParams();
  if (sp.unit) qs.set("unit", sp.unit);
  if (sp.name) qs.set("name", sp.name);
  if (sp.img) qs.set("img", sp.img);
  if (sp.price) qs.set("price", sp.price);
  if (sp.slug) qs.set("slug", sp.slug);
  if (sp.accent) qs.set("accent", sp.accent);
  return `/api/og/buy?${qs.toString()}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const title = sp.name
    ? `fished ${sp.name} out of s#!thole`
    : "s#!thole — fresh haul";
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
      site: "@Shithole_App",
      creator: "@Shithole_App",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function ShareBuyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const unit = sp.unit || "";
  const displayName = sp.name || "some worthless s#!t";
  const accent = `#${sp.accent || "ff8c1a"}`;
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
          alt="buy card preview"
          className="block w-full"
          loading="lazy"
        />
      </div>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          freshly fished out of
        </p>
        <p
          className="mt-1 text-3xl font-semibold tracking-tight"
          style={{ color: accent }}
        >
          s#!thole · {displayName}
        </p>
      </div>
      <div className="flex gap-3">
        {unit && (
          <Link
            href={`/market/${unit}`}
            className="rounded-md px-5 py-2 text-sm font-semibold uppercase tracking-wide"
            style={{ backgroundColor: accent, color: "#0a0a0a" }}
          >
            view on the market
          </Link>
        )}
        <Link
          href="/market"
          className="rounded-md border border-zinc-700 px-5 py-2 text-sm uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
        >
          browse the market
        </Link>
      </div>
    </main>
  );
}
