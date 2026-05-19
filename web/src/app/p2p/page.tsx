import Link from "next/link";

import { ListingsBoard } from "@/components/p2p/ListingsBoard";

/**
 * /p2p — browse open wanted listings. Bare client component below the
 * page shell; React Query handles loading state internally.
 */
export default function P2pBrowsePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← back to pits
        </Link>
        <Link href="/p2p/new" className="hover:text-zinc-300">
          create listing →
        </Link>
      </nav>
      <ListingsBoard />
    </main>
  );
}
