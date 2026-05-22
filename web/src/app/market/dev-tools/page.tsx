import { notFound } from "next/navigation";

import { DevTools } from "@/components/market/DevTools";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "marketplace dev tools — shithole",
};

export default function DevToolsPage() {
  if (!isMarketplaceEnabled()) notFound();
  return <DevTools />;
}
