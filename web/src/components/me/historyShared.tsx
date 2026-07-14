"use client";

import { useMemo } from "react";

import { Notice } from "@/components/Notice";
import {
  useListingsByPkh,
  useMarketListingsByPkh,
  useP2pListingsByPkh,
} from "@/lib/api/hooks";
import {
  mergeChronological,
  synthesizeMarketEvents,
  synthesizeP2pEvents,
  synthesizePitEvents,
  type WalletHistoryEvent,
} from "@/lib/me/historyEvents";
import { formatAbsolute, formatRelative } from "@/lib/util/formatDate";
import { getNetworkName } from "@/lib/wallet/network";

/* ------------------------------------------------------------------ */
/* Types + filter helpers                                              */
/* ------------------------------------------------------------------ */

export type HistoryFilter = "all" | "pit" | "p2p" | "market";

export function parseHistoryFilter(raw: string | null): HistoryFilter {
  if (raw === "pit" || raw === "p2p" || raw === "market") return raw;
  return "all";
}

/* ------------------------------------------------------------------ */
/* Data hook — both pages + drawer share this                          */
/* ------------------------------------------------------------------ */

export type HistoryFeed = {
  events: WalletHistoryEvent[];
  loading: boolean;
  errored: boolean;
};

/**
 * Fetch pit + p2p + marketplace activity for a wallet, synthesise +
 * merge into a single chronological feed. {@code null} pkh → empty feed.
 */
export function useHistoryFeed(pkhHex: string | null): HistoryFeed {
  const pit = useListingsByPkh(pkhHex);
  const p2p = useP2pListingsByPkh(pkhHex);
  const market = useMarketListingsByPkh(pkhHex);

  const events = useMemo<WalletHistoryEvent[]>(() => {
    if (!pkhHex) return [];
    const pitEvents = pit.data ? synthesizePitEvents(pit.data, pkhHex) : [];
    const p2pEvents = p2p.data ? synthesizeP2pEvents(p2p.data, pkhHex) : [];
    const marketEvents = market.data
      ? synthesizeMarketEvents(market.data, pkhHex)
      : [];
    return mergeChronological(pitEvents, p2pEvents, marketEvents);
  }, [pkhHex, pit.data, p2p.data, market.data]);

  return {
    events,
    loading: pit.isPending || p2p.isPending || market.isPending,
    errored: pit.isError || p2p.isError || market.isError,
  };
}

/* ------------------------------------------------------------------ */
/* Visual building blocks                                              */
/* ------------------------------------------------------------------ */

export function HistoryTabStrip({
  filter,
  setFilter,
}: {
  filter: HistoryFilter;
  setFilter: (f: HistoryFilter) => void;
}) {
  const tabs: { id: HistoryFilter; label: string }[] = [
    { id: "all", label: "all" },
    { id: "pit", label: "pit" },
    { id: "p2p", label: "p2p" },
    { id: "market", label: "market" },
  ];
  return (
    <div
      role="tablist"
      aria-label="history filter"
      className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/40 p-0.5"
    >
      {tabs.map((t) => {
        const active = filter === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => setFilter(t.id)}
            className={
              "rounded-sm px-3 py-1 text-xs uppercase tracking-widest transition-colors " +
              (active
                ? "bg-amber-700/80 text-amber-50"
                : "text-zinc-400 hover:text-zinc-200")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Partial-load warning. {@code useHistoryFeed} merges three independent
 * queries (pit / p2p / market); if any one errors we still show the rows
 * that loaded and flag the gap here. Known/operational — a warning
 * Notice, not the red debug box.
 */
export function HistoryLoadError({ className }: { className?: string }) {
  return (
    <Notice severity="warning" className={className}>
      couldn&apos;t load some history rows. try again later.
    </Notice>
  );
}

export function HistoryEmptyState({ filter }: { filter: HistoryFilter }) {
  const what =
    filter === "pit"
      ? "no pit activity yet."
      : filter === "p2p"
        ? "no p2p activity yet."
        : filter === "market"
          ? "no marketplace activity yet."
          : "no chain activity on this wallet yet.";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
      {what} go list, swap, or make an offer — it&apos;ll show up here.
    </div>
  );
}

export function HistoryRow({ event }: { event: WalletHistoryEvent }) {
  const net = getNetworkName();
  const sub = net === "mainnet" ? "" : `${net}.`;
  const explorerUrl = `https://${sub}cardanoscan.io/transaction/${event.txHash}`;
  const assetName = decodeAssetName(event.nftUnit);
  const lovelaceAda = (event.lovelace / 1_000_000).toFixed(2);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SourceBadge source={event.source} />
        <KindChip kind={event.kind} role={event.role} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-zinc-200">{assetName}</p>
          <p className="text-xs text-zinc-500">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300"
            >
              {event.txHash.slice(0, 8)}…{event.txHash.slice(-6)} ↗
            </a>
            <span className="mx-2 text-zinc-700">·</span>
            {lovelaceAda} ADA
          </p>
        </div>
      </div>
      <time
        dateTime={event.at}
        title={formatAbsolute(event.at)}
        className="shrink-0 text-xs tabular-nums text-zinc-500"
      >
        {formatRelative(event.at)}
      </time>
    </li>
  );
}

function SourceBadge({
  source,
}: {
  source: WalletHistoryEvent["source"];
}) {
  const cls =
    source === "pit"
      ? "bg-zinc-800 text-zinc-300"
      : source === "p2p"
        ? "bg-amber-900/40 text-amber-300"
        : "bg-sky-900/40 text-sky-300";
  return (
    <span
      aria-label={`source ${source}`}
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest " +
        cls
      }
    >
      {source}
    </span>
  );
}

function KindChip({
  kind,
  role,
}: {
  kind: WalletHistoryEvent["kind"];
  role: WalletHistoryEvent["role"];
}) {
  const label = chipLabel(kind, role);
  const cls = chipClass(kind);
  return (
    <span
      className={
        "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider " +
        cls
      }
    >
      {label}
    </span>
  );
}

function chipLabel(
  kind: WalletHistoryEvent["kind"],
  role: WalletHistoryEvent["role"],
): string {
  switch (kind) {
    case "listed":
      return "you listed";
    case "swapped":
      return role === "lister" ? "your listing swapped" : "you swapped in";
    case "cancelled":
      return "you cancelled";
    case "recovered":
      return "admin recovered";
    case "spent_unknown_pit":
      return "listing ended";
    case "posted":
      return "you posted";
    case "fulfilled":
      return role === "buyer" ? "your offer filled" : "you fulfilled";
    case "reclaimed":
      return "you reclaimed";
    case "rescued":
      return "admin rescued";
    case "spent_unknown_p2p":
      return "offer ended";
    case "market_listed":
      return "you listed";
    case "market_sold":
      return "your listing sold";
    case "market_cancelled":
      return "you cancelled";
    case "market_bought":
      return "you bought";
    case "spent_unknown_market":
      return "listing ended";
    default:
      return kind;
  }
}

function chipClass(kind: WalletHistoryEvent["kind"]): string {
  switch (kind) {
    case "listed":
    case "posted":
    case "market_listed":
      return "bg-emerald-900/40 text-emerald-300";
    case "swapped":
    case "fulfilled":
    case "market_sold":
    case "market_bought":
      return "bg-sky-900/40 text-sky-300";
    case "cancelled":
    case "reclaimed":
    case "market_cancelled":
      return "bg-zinc-800 text-zinc-300";
    case "recovered":
    case "rescued":
      return "bg-rose-900/40 text-rose-300";
    default:
      return "bg-zinc-800 text-zinc-400";
  }
}

/**
 * Decode the asset_name portion of a unit (policy_id || asset_name) as
 * ASCII when printable, else as a short hex fingerprint.
 */
function decodeAssetName(unitHex: string): string {
  const nameHex = unitHex.slice(56);
  if (!nameHex) return "(no name)";
  try {
    const bytes = new Uint8Array(
      nameHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    let printable = "";
    for (const b of bytes) {
      if (b < 0x20 || b > 0x7e) {
        printable = "";
        break;
      }
      printable += String.fromCharCode(b);
    }
    if (printable) return printable;
  } catch {
    // fall through
  }
  return nameHex.length > 16
    ? `${nameHex.slice(0, 8)}…${nameHex.slice(-6)}`
    : nameHex;
}
