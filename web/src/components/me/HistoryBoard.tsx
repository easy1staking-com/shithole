"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  HistoryEmptyState,
  HistoryLoadError,
  HistoryRow,
  HistoryTabStrip,
  parseHistoryFilter,
  useHistoryFeed,
  type HistoryFilter,
} from "@/components/me/historyShared";
import { supportedCollections } from "@/lib/market/supportedCollections";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * /me/history main view. Disconnected → CTA. Connected → unified feed
 * via {@link useHistoryFeed}, tab-filtered, URL-mirrored.
 *
 * <p>Collection filter: every event carries {@code nftUnit}, whose first
 * 56 hex chars ARE the collection policy — so one dropdown filters across
 * pit + p2p + market sources uniformly, no per-source mapping needed.
 */
export function HistoryBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFilter = parseHistoryFilter(searchParams.get("type"));
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);

  const collections = useMemo(() => supportedCollections(), []);
  const initialCollection = (() => {
    const c = searchParams.get("collection")?.toLowerCase() ?? "";
    return collections.some((x) => x.policyId.toLowerCase() === c) ? c : "";
  })();
  const [collection, setCollection] = useState<string>(initialCollection);

  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const { events, loading, errored } = useHistoryFeed(paymentKeyHashHex);

  // Mirror filters → URL so the back button + share work. Avoid scroll
  // jump on tab clicks.
  useEffect(() => {
    const currentType = parseHistoryFilter(searchParams.get("type"));
    const currentCollection = searchParams.get("collection")?.toLowerCase() ?? "";
    if (currentType === filter && currentCollection === collection) return;
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") params.delete("type");
    else params.set("type", filter);
    if (!collection) params.delete("collection");
    else params.set("collection", collection);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [filter, collection, pathname, router, searchParams]);

  const filtered = useMemo(() => {
    let xs = events;
    if (filter !== "all") xs = xs.filter((e) => e.source === filter);
    if (collection) {
      xs = xs.filter(
        (e) => (e.nftUnit ?? "").slice(0, 56).toLowerCase() === collection,
      );
    }
    return xs;
  }, [events, filter, collection]);

  if (!paymentKeyHashHex) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
        connect a wallet to see your history.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HistoryTabStrip filter={filter} setFilter={setFilter} />
        {collections.length > 1 ? (
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            collection
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-zinc-200 focus:border-sky-700 focus:outline-none"
            >
              <option value="">all collections</option>
              {collections.map((c) => (
                <option key={c.policyId} value={c.policyId.toLowerCase()}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {errored && <HistoryLoadError />}

      {loading ? (
        <p className="text-sm text-zinc-500">scraping the chain…</p>
      ) : filtered.length === 0 ? (
        <HistoryEmptyState filter={filter} />
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <HistoryRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
