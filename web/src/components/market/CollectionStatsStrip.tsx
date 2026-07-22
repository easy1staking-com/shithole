"use client";

import { useCollectionStats } from "@/lib/api/hooks";

/**
 * Compact stats row for a selected collection on /market — active listings,
 * 24h sales/volume, floor. ADA/USD figures come from the BE price oracle and
 * are estimates, so they render with the "≈" qualifier. Errors degrade to
 * nothing: stats are decoration, never a blocker.
 */
export function CollectionStatsStrip({ policyId }: { policyId: string }) {
  const { data, isLoading, isError } = useCollectionStats(policyId);

  if (isError) return null;
  if (isLoading || !data) {
    return (
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 w-32 animate-pulse rounded-lg border border-zinc-900 bg-zinc-900/40"
          />
        ))}
      </div>
    );
  }

  const floor = data.floor ?? null;
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Stat label="listed" value={String(data.active_listings)} />
      <Stat label="sales · 24h" value={String(data.sales_24h)} />
      <Stat
        label="vol · 24h"
        value={
          data.volume_24h_ada != null
            ? `≈ ${compact(data.volume_24h_ada)} ₳`
            : "—"
        }
        sub={data.volume_24h_usd != null ? `≈ $${compact(data.volume_24h_usd)}` : undefined}
      />
      <Stat
        label="floor"
        value={
          floor
            ? `${compact(Number(floor.native_qty) / 10 ** floor.decimals)} ${floor.token_label}`
            : "—"
        }
        sub={floor?.ada_estimate != null ? `≈ ${compact(floor.ada_estimate)} ₳` : undefined}
      />
      <Stat label="traders · 24h" value={String(data.unique_traders_24h)} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-28 flex-none flex-col justify-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
        {value}
        {sub ? (
          <span className="ml-1.5 text-[11px] font-normal text-zinc-500">{sub}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Compact human number: 1234567 → "1.23M". */
function compact(n: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}
