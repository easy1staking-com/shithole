import { notFound } from "next/navigation";

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
 */
export default function MarketPage() {
  if (!isMarketplaceEnabled()) {
    notFound();
  }
  return <MarketBrowse />;
}
