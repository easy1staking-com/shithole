import { notFound } from "next/navigation";

import { ListingDetail } from "@/components/market/ListingDetail";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "listing — shithole marketplace",
};

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ unit: string }>;
}) {
  if (!isMarketplaceEnabled()) notFound();
  const { unit } = await params;
  return <ListingDetail unit={unit} />;
}
