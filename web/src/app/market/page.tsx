import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MarketBrowse } from "@/components/market/MarketBrowse";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "marketplace — shithole",
  description:
    "List or buy any Cardano native asset for any token. Behind a dev feature flag.",
};

/**
 * /market — browse open marketplace listings. The route is gated by the
 * {@code NEXT_PUBLIC_FEATURE_MARKETPLACE} env flag; in environments
 * where it's off the route returns a 404 so it's both invisible and
 * non-discoverable.
 *
 * <p>Suspense boundary: MarketBrowse reads the {@code ?c=} collection tab
 * via useSearchParams, which Next requires to render inside Suspense.
 */
export default function MarketPage() {
  if (!isMarketplaceEnabled()) {
    notFound();
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
