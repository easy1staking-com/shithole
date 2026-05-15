"use client";

import Link from "next/link";

import type { CollectionState } from "@/types/api";

/**
 * Pit-page header: back-nav, mascot/accent, display name, stat strip.
 * Pulls accent + mascot from the collection's theme; falls back gracefully
 * if the theme is empty.
 */
export function PitHeader({ collection }: { collection: CollectionState }) {
  const theme = collection.theme;
  const accent = theme?.accent_color ?? "#b87333";
  const mascot = theme?.mascot_image_url ?? null;

  return (
    <header className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← back to all pits
        </Link>
        <span className="font-mono opacity-60">/pit/{collection.slug}</span>
      </div>

      <div className="flex items-center gap-3">
        {mascot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mascot}
            alt=""
            className="h-10 w-10 rounded-full ring-2"
            style={{ borderColor: accent }}
            aria-hidden
          />
        )}
        {!mascot && (
          <span
            className="h-5 w-5 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <h1 className="text-3xl font-semibold tracking-tight">
          {collection.display_name}
        </h1>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-xs text-zinc-400">
        <Stat label="in the pit" value={collection.stats.n_valid_listings} />
        <Stat
          label="protocol fee"
          value={`${ada(collection.config.protocol_fee)} ₳`}
        />
        <Stat
          label="lister fee"
          value={`${ada(collection.config.lister_fee)} ₳`}
        />
      </dl>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function ada(lovelace: number) {
  return (lovelace / 1_000_000).toFixed(2);
}
