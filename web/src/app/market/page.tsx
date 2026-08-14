import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { MarketBrowse } from "@/components/market/MarketBrowse";
import { isMarketplaceEnabled } from "@/lib/market/config";
import { isValidCollectionParam } from "@/lib/market/supportedCollections";

export const metadata = {
  title: "marketplace — shithole",
  description:
    "List or buy any Cardano native asset for any token. Behind a dev feature flag.",
};

/**
 * /market — browse open marketplace listings. The route is gated by the
 * {@code NEXT_PUBLIC_FEATURE_MARKETPLACE} env flag; in environments
 * where it's off the route returns a 404 so it's both invisible and
 * non-discoverable (checked BEFORE the collection redirect below).
 *
 * <p>/market requires a whitelisted {@code ?c}; a missing or
 * non-whitelisted collection param redirects to the landing instead of
 * rendering an empty/broken browse view.
 *
 * <p>Suspense boundary: MarketBrowse reads the {@code ?c=} collection tab
 * via useSearchParams, which Next requires to render inside Suspense.
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  if (!isMarketplaceEnabled()) {
    notFound();
  }
  const { c } = await searchParams;
  const param = Array.isArray(c) ? c[0] : c;
  if (!isValidCollectionParam(param)) {
    redirect("/");
  }
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-12">
          <p className="text-sm text-zinc-500">scanning the marketplace…</p>
        </main>
      }
    >
      <MarketBrowse />
    </Suspense>
  );
}
