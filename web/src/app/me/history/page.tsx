import { Suspense } from "react";
import Link from "next/link";

import { HistoryBoard } from "@/components/me/HistoryBoard";

/**
 * /me/history — unified wallet timeline across pit + p2p.
 *
 * URL state:
 *   ?type=pit|p2p|all   — tab filter, default 'all'
 *
 * The board is a client component (useSearchParams + wallet hooks). Next 15
 * requires useSearchParams under a Suspense boundary.
 */
export default function MyHistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/me" className="hover:text-zinc-300">
          ← your stash
        </Link>
        <Link href="/me/p2p" className="hover:text-zinc-300">
          your offers →
        </Link>
      </nav>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">your history</h1>
        <p className="text-sm text-zinc-400">
          every pit + p2p event your wallet has touched on-chain, newest first.
        </p>
      </header>
      <Suspense
        fallback={
          <p className="text-sm text-zinc-500">unearthing your past…</p>
        }
      >
        <HistoryBoard />
      </Suspense>
    </main>
  );
}
