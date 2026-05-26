import { notFound } from "next/navigation";

import { ListDrawer } from "@/components/market/ListDrawer";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "list on marketplace — shithole",
};

export default function MarketNewPage() {
  if (!isMarketplaceEnabled()) notFound();
  return <ListDrawer />;
}
