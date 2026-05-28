import Link from "next/link";
import { notFound } from "next/navigation";

import { MyListings } from "@/components/market/MyListings";
import { isMarketplaceEnabled } from "@/lib/market/config";

export const metadata = {
  title: "your marketplace listings — shithole",
};

export default function MyMarketListingsPage() {
  if (!isMarketplaceEnabled()) notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/market" className="hover:text-zinc-300">
          ← browse
        </Link>
        <Link href="/market/new" className="hover:text-zinc-300">
          list something →
        </Link>
      </nav>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">your marketplace listings</h1>
        <p className="text-sm text-zinc-400">
          everything you have open on the marketplace. cancel any row to
          pull the NFT back into your wallet.
        </p>
      </header>
      <MyListings />
    </main>
  );
}
