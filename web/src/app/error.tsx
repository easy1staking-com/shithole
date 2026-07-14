"use client";

/**
 * Route-segment error boundary. A render-time throw is genuinely
 * unexpected, so we reuse the full ErrorNotice debug box (copy-report) —
 * this is exactly the "unknown" treatment, wrapped in on-voice chrome +
 * a reset() retry.
 */

import Link from "next/link";

import { ErrorNotice } from "@/components/ErrorNotice";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-20">
      <header className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          error
        </p>
        <h1 className="text-2xl font-semibold text-zinc-100">the pit collapsed</h1>
        <p className="text-sm text-zinc-400">
          Something broke rendering this page — that&apos;s on us, not you. Try
          again, and if it keeps happening, hit &quot;copy error&quot; below and
          send it over.
        </p>
      </header>
      <ErrorNotice error={error} />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-sky-600"
        >
          try again
        </button>
        <Link
          href="/"
          className="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
        >
          back to home
        </Link>
      </div>
    </main>
  );
}
