"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  HistoryEmptyState,
  HistoryRow,
  HistoryTabStrip,
  parseHistoryFilter,
  useHistoryFeed,
  type HistoryFilter,
} from "@/components/me/historyShared";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * /me/history main view. Disconnected → CTA. Connected → unified feed
 * via {@link useHistoryFeed}, tab-filtered, URL-mirrored.
 */
export function HistoryBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFilter = parseHistoryFilter(searchParams.get("type"));
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);

  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const { events, loading, errored } = useHistoryFeed(paymentKeyHashHex);

  // Mirror filter → URL so the back button + share work. Avoid scroll
  // jump on tab clicks.
  useEffect(() => {
    const current = parseHistoryFilter(searchParams.get("type"));
    if (current === filter) return;
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") {
      params.delete("type");
    } else {
      params.set("type", filter);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [filter, pathname, router, searchParams]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.source === filter);
  }, [events, filter]);

  if (!paymentKeyHashHex) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
        connect a wallet to see your history.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HistoryTabStrip filter={filter} setFilter={setFilter} />

      {errored && (
        <div className="rounded-md border border-red-800/60 bg-red-950/30 p-4 text-sm text-red-300">
          couldn&apos;t load some history rows. try again later.
        </div>
      )}

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
