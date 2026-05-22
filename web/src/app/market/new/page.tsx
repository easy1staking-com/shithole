import { notFound } from "next/navigation";

import { ListForm } from "@/components/market/ListForm";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "list on marketplace — shithole",
};

export default function MarketNewPage() {
  if (!isMarketplaceEnabled()) notFound();
  return <ListForm />;
}
