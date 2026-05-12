"use client";

import Link from "next/link";

import { useCurated } from "@/lib/api/hooks";

export default function HomePage() {
  const { data, isLoading, error } = useCurated();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="font-mono text-4xl font-semibold tracking-tight">shithole</h1>
        <p className="text-sm text-zinc-400">
          Wormhole carries value across chains. Shithole carries worthlessness in circles
          within one collection. Pick a pit.
        </p>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">stirring the mud…</p>}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          could not load curated pits: {error.message}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-zinc-500">no pits yet. come back when something dies.</p>
      )}

      {data && data.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/pit/${c.slug}`}
                  className="group block rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
                  style={{ borderLeft: `4px solid ${c.theme.accent_color}` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-zinc-100">
                      {c.display_name}
                    </h2>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: c.theme.accent_color }}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500 break-all">
                    /pit/{c.slug}
                  </p>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </main>
  );
}
