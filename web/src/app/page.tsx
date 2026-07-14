"use client";

import { LegacyLanding } from "@/components/LegacyLanding";
import { MarketLanding } from "@/components/MarketLanding";
import { isMarketplaceEnabled } from "@/lib/market/config";

/**
 * Home route. Marketplace-first when the marketplace flag is on; otherwise
 * the legacy pit/p2p landing — a kill-switch so suspending the marketplace
 * (env flag) cleanly reverts the home page instead of stranding a
 * marketplace-led page with the marketplace hidden from the nav.
 */
export default function HomePage() {
  return isMarketplaceEnabled() ? <MarketLanding /> : <LegacyLanding />;
}
