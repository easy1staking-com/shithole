import Link from "next/link";

import rarity from "@/lib/data/hosky-rarity.json";

export const metadata = {
  title: "HOSKY CashGrab — trait rarity",
  description:
    "Per-trait rarity for the HOSKY CashGrab NFT collection — 420,420 dogs, every trait counted.",
};

/**
 * /hosky/rarity — static trait-rarity browser for HOSKY CashGrab.
 *
 * <p>Reads the pre-aggregated `hosky-rarity.json` (built from
 * `.local/hosky-traits/reverse_index.json`). Server component; the JSON is
 * imported and bundled at compile time so the page is pure HTML at runtime.
 *
 * <p>Each category section is independently scrollable so the page itself
 * stays a reasonable height — a single trait like Fur has 115 unique values.
 * Values within a section are sorted by rarity ascending (rarest first).
 */
export default function HoskyRarityPage() {
  const { totalCount, categories } = rarity as RarityData;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← home
        </Link>
        <span className="hidden sm:inline">HOSKY CashGrab</span>
      </nav>

      <header className="space-y-3">
        <h1 className="text-3xl font-semibold text-zinc-100 sm:text-4xl">
          HOSKY CashGrab — trait rarity
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          {totalCount.toLocaleString()} NFTs scanned across{" "}
          {categories.length} trait categories. Within each category the
          rarest values come first; percentages are rounded to four decimal
          places so single-of-{totalCount.toLocaleString()} traits still
          register as non-zero.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {categories.map((cat) => (
          <TraitCategoryCard key={cat.name} category={cat} />
        ))}
      </div>

      <footer className="border-t border-zinc-900 pt-6 text-xs text-zinc-600">
        Source data:{" "}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
          .local/hosky-traits/reverse_index.json
        </code>{" "}
        — rebuild via the generator script if the upstream changes.
      </footer>
    </main>
  );
}

function TraitCategoryCard({ category }: { category: RarityCategory }) {
  return (
    <section className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950">
      <header className="flex items-baseline justify-between border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-400">
          {category.name}
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
          {category.values.length} unique
        </span>
      </header>
      <ul className="max-h-[28rem] divide-y divide-zinc-900 overflow-y-auto">
        {category.values.map((v) => (
          <li
            key={v.value}
            className="flex items-baseline gap-3 px-4 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-zinc-200">
              {v.value}
            </span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
              {v.count.toLocaleString()}
            </span>
            <span className="w-20 shrink-0 text-right font-mono text-xs text-sky-400 tabular-nums">
              {formatPct(v.pct)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatPct(pct: number): string {
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(4)}%`;
}

type RarityData = {
  totalCount: number;
  categories: RarityCategory[];
};

type RarityCategory = {
  name: string;
  values: RarityValue[];
};

type RarityValue = {
  value: string;
  count: number;
  pct: number;
};
