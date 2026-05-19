import Link from "next/link";

import { MyListingsBoard } from "@/components/p2p/MyListingsBoard";

/**
 * /me/p2p — your open p2p listings + reclaim affordance.
 */
export default function MyP2pPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/p2p" className="hover:text-zinc-300">
          ← all p2p listings
        </Link>
        <Link href="/p2p/new" className="hover:text-zinc-300">
          make offer →
        </Link>
      </nav>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">your p2p listings</h1>
        <p className="text-sm text-zinc-400">
          open offers you posted. reclaim any time to pull the NFT + bounty back.
        </p>
      </header>
      <MyListingsBoard />
    </main>
  );
}
