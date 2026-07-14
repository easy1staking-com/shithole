import Link from "next/link";

/**
 * On-voice 404. A missing route is an expected/neutral state, not a crash
 * — no debug box.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-24">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
        404
      </p>
      <h1 className="text-2xl font-semibold text-zinc-100">nothing rotting here</h1>
      <p className="text-sm text-zinc-400">
        This page doesn&apos;t exist — or whatever was here already got swapped
        away. Head back and find something worthless.
      </p>
      <Link
        href="/"
        className="self-start rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-sky-600"
      >
        back to home
      </Link>
    </main>
  );
}
