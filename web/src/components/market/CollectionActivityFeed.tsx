"use client";

import { ErrorView } from "@/components/ErrorView";
import { useCollectionActivity, useNftMetadata } from "@/lib/api/hooks";
import type { MarketActivityEvent } from "@/types/api";

/**
 * Public per-collection marketplace activity feed (listed / sold /
 * cancelled), newest-first. Native price always renders; ADA/USD figures
 * are oracle estimates and carry the "≈" qualifier.
 */
export function CollectionActivityFeed({ policyId }: { policyId: string }) {
  const { data, isLoading, error } = useCollectionActivity(policyId, { size: 50 });

  if (error) {
    return <ErrorView error={error} context={{ subject: "activity" }} />;
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-zinc-900 bg-zinc-900/40"
          />
        ))}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        no marketplace activity for this collection yet — list something.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 bg-zinc-950">
      {data.map((e, i) => (
        <ActivityRow key={`${e.nft_unit}-${e.ts}-${i}`} event={e} />
      ))}
    </ul>
  );
}

const EVENT_STYLE: Record<string, { chip: string; label: string }> = {
  listed: { chip: "bg-sky-950/60 text-sky-300 border-sky-900", label: "listed" },
  sold: { chip: "bg-emerald-950/60 text-emerald-300 border-emerald-900", label: "sold" },
  cancelled: { chip: "bg-amber-950/60 text-amber-300 border-amber-900", label: "cancelled" },
  spent: { chip: "bg-zinc-900 text-zinc-400 border-zinc-800", label: "spent" },
};

function ActivityRow({ event }: { event: MarketActivityEvent }) {
  const meta = useNftMetadata(event.nft_unit);
  const name = meta.data?.name ?? prettyName(event.nft_unit);
  const image = meta.data?.image_url ?? null;
  const style = EVENT_STYLE[event.event] ?? EVENT_STYLE.spent;
  const amount = Number(event.price.native_qty) / 10 ** event.price.decimals;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={`w-20 flex-none rounded border px-2 py-0.5 text-center font-mono text-[10px] uppercase tracking-wider ${style.chip}`}
      >
        {style.label}
      </span>

      <div className="h-9 w-9 flex-none overflow-hidden rounded bg-zinc-900">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-200">{name}</p>
        <p className="font-mono text-[11px] text-zinc-500">
          {shortPkh(event.wallet)} · {timeAgo(event.ts)}
        </p>
      </div>

      <div className="flex-none text-right">
        <p className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
          {compact(amount)}{" "}
          <span className="text-[11px] font-normal text-zinc-500">
            {event.price.token_label}
          </span>
        </p>
        {event.ada_estimate != null ? (
          <p className="font-mono text-[11px] tabular-nums text-zinc-500">
            ≈ {compact(event.ada_estimate)} ₳
            {event.usd_estimate != null ? ` · $${compact(event.usd_estimate)}` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function compact(n: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

function shortPkh(pkh: string): string {
  return pkh.length > 12 ? `${pkh.slice(0, 6)}…${pkh.slice(-4)}` : pkh;
}

/** Decode the asset-name half of a unit to printable ASCII, else truncate hex. */
function prettyName(unit: string): string {
  const nameHex = unit.slice(56);
  try {
    let out = "";
    for (let i = 0; i < nameHex.length; i += 2) {
      const code = parseInt(nameHex.slice(i, i + 2), 16);
      if (Number.isNaN(code) || code < 0x20 || code > 0x7e) throw new Error("bin");
      out += String.fromCharCode(code);
    }
    return out || `${unit.slice(0, 12)}…`;
  } catch {
    return `${unit.slice(0, 12)}…`;
  }
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
