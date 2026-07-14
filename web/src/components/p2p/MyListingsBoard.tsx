"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmationChip } from "@/components/ConfirmationChip";
import { ErrorView } from "@/components/ErrorView";
import { Notice } from "@/components/Notice";
import { describeError } from "@/lib/errors";
import { useP2pListingsByBuyer } from "@/lib/api/hooks";
import { useRefreshHistory } from "@/lib/me/useRefreshHistory";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitReclaimAllForCollection } from "@/lib/tx/reclaimP2p";
import { fetchUtxoByOutRef } from "@/lib/tx/swap";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { P2pListing } from "@/types/api";

/**
 * /me/p2p — listings YOU created with multi-select + bulk reclaim.
 *
 * <p>Selected rows get grouped by {@code config_nft_policy} so we can spend
 * each collection's listings in a single Reclaim tx (the wanted-listing
 * validator is parameterised per-collection, so listings from different
 * collections need different attached validators). For typical users — one
 * Hosky listing-cluster at a time — this collapses to one tx.
 *
 * <p>Mirrors the pit's bulk-withdraw pattern from {@code /me/page.tsx}:
 * track selection via Set&lt;listingKey&gt;, prune entries that disappear
 * from the result set, sticky action bar at the bottom, optimistic cache
 * strip + awaitTxConfirmation so the rows vanish immediately on success.
 */
type BulkState =
  | { kind: "idle" }
  | { kind: "submitting"; current: number; total: number; label: string }
  | { kind: "confirming"; current: number; total: number; label: string }
  | { kind: "confirmed"; count: number }
  | { kind: "error"; error: unknown };

function listingKey(l: P2pListing): string {
  return `${l.tx_hash}#${l.output_index}`;
}

export function MyListingsBoard() {
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const api = useWalletStore((s) => s.api);
  const queryClient = useQueryClient();
  const refreshHistory = useRefreshHistory();

  const { data, isPending, isError, error, refetch } = useP2pListingsByBuyer(
    paymentKeyHashHex,
    { includeSpent: false },
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<BulkState>({ kind: "idle" });
  // Track which listing keys we've optimistically reclaimed so they're
  // hidden immediately even before the BE indexer catches up.
  const [reclaimedKeys, setReclaimedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  // Drop selection entries whose listing has disappeared (refetched data,
  // optimistic reclaim, etc.) — keeps the count + "select all" toggle
  // honest.
  const liveListings = useMemo(
    () => (data ?? []).filter((l) => !reclaimedKeys.has(listingKey(l))),
    [data, reclaimedKeys],
  );
  const liveKeys = useMemo(
    () => new Set(liveListings.map(listingKey)),
    [liveListings],
  );
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((k) => liveKeys.has(k))),
    [selected, liveKeys],
  );

  const toggle = useCallback((key: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((s) => {
      if (s.size >= liveListings.length) return new Set();
      return new Set(liveListings.map(listingKey));
    });
  }, [liveListings]);

  const isBulkRunning =
    bulkState.kind === "submitting" || bulkState.kind === "confirming";

  const handleBulkReclaim = useCallback(async () => {
    if (!api || !paymentKeyHashHex) {
      setBulkState({ kind: "error", error: "connect a wallet first" });
      return;
    }
    // Group by config_nft_policy — one tx per collection.
    const byPolicy = new Map<string, P2pListing[]>();
    for (const l of liveListings) {
      if (!effectiveSelected.has(listingKey(l))) continue;
      const arr = byPolicy.get(l.config_nft_policy) ?? [];
      arr.push(l);
      byPolicy.set(l.config_nft_policy, arr);
    }
    const groups = [...byPolicy.entries()];
    if (groups.length === 0) return;
    // Sum of listings being reclaimed — used in the "✓ N confirmed"
    // success chip after the loop completes.
    const totalListings = groups.reduce((s, [, l]) => s + l.length, 0);

    try {
      const client = await makeClient(api);
      const network = toEvolutionNetwork(getNetworkName());
      const total = groups.length;
      for (let i = 0; i < groups.length; i++) {
        const [policy, listings] = groups[i];
        const label = `reclaiming ${listings.length} listing${listings.length === 1 ? "" : "s"}`;
        // Phase 1: build + submit the tx (~1-2s).
        if (!mountedRef.current) return;
        setBulkState({ kind: "submitting", current: i + 1, total, label });
        const utxos = await Promise.all(
          listings.map((l) =>
            fetchUtxoByOutRef(client, l.tx_hash, l.output_index),
          ),
        );
        const r = await submitReclaimAllForCollection(client, {
          network,
          configNftPolicyHex: policy,
          listingUtxos: utxos,
          buyerPkhHex: paymentKeyHashHex,
        });
        // Phase 2: wait for chain inclusion (~30-60s on preprod).
        if (!mountedRef.current) return;
        setBulkState({ kind: "confirming", current: i + 1, total, label });
        await awaitTxConfirmation(client, r.txHash);
        // Optimistically hide the reclaimed listings so the user sees the
        // rows disappear before the BE indexer notices.
        const keys = new Set(listings.map(listingKey));
        if (!mountedRef.current) return;
        const currentDataKeys = new Set((data ?? []).map(listingKey));
        setReclaimedKeys((prev) => {
          const next = new Set<string>();
          for (const key of prev) {
            if (currentDataKeys.has(key)) next.add(key);
          }
          for (const key of keys) next.add(key);
          return next;
        });
      }
      // Cross-cutting cache invalidation — the indexer needs a moment.
      queryClient.invalidateQueries({ queryKey: ["p2pListings"] });
      queryClient.invalidateQueries({ queryKey: ["p2pListingsByBuyer"] });
      queryClient.invalidateQueries({ queryKey: ["walletCollection"] });
      refreshHistory();
      if (!mountedRef.current) return;
      setSelected(new Set());
      // Brief "confirmed" chip before sliding back to idle. Lingers ~4s
      // so the user gets visual closure without the bar nagging forever.
      setBulkState({ kind: "confirmed", count: totalListings });
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        if (!mountedRef.current) return;
        setBulkState((s) => (s.kind === "confirmed" ? { kind: "idle" } : s));
      }, 4000);
    } catch (err) {
      console.error("bulk reclaim failed:", describeError(err));
      if (!mountedRef.current) return;
      setBulkState({ kind: "error", error: err });
    }
  }, [
    api,
    paymentKeyHashHex,
    data,
    liveListings,
    effectiveSelected,
    queryClient,
  ]);

  if (!addressBech32) {
    return (
      <p className="text-sm text-zinc-400">
        connect your wallet via the chip in the top-right ↗ to see your open
        p2p listings.
      </p>
    );
  }
  if (isPending) {
    return <p className="text-sm text-zinc-500">looking up your listings…</p>;
  }
  if (isError) {
    return <ErrorView error={error} context={{ subject: "listings" }} />;
  }
  if (liveListings.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        no open p2p listings.{" "}
        <Link
          href="/p2p/new"
          className="text-zinc-300 underline-offset-2 hover:underline"
        >
          create one →
        </Link>
      </p>
    );
  }

  const selectedCount = effectiveSelected.size;
  const allSelected = selectedCount === liveListings.length;

  return (
    <div className="space-y-3 pb-24">
      {/* Reclaim is opt-in, never automatic — call it out once at the top
          of the board so users know to come back if they change their
          mind. T&C covers the full version. */}
      <p className="text-[11px] text-zinc-500">
        nothing expires on its own. these stay open until someone fills
        them or you reclaim.
      </p>
      {/* Header bar with select-all + count */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="inline-flex items-center gap-2 text-zinc-400">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={isBulkRunning}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          {allSelected ? "deselect all" : "select all"}
        </label>
        <span className="text-zinc-500">
          {selectedCount > 0
            ? `${selectedCount} of ${liveListings.length} selected`
            : `${liveListings.length} open`}
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isBulkRunning}
          className="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
          title="re-query the backend"
          aria-label="refresh"
        >
          ↻
        </button>
      </div>

      <ul className="space-y-3">
        {liveListings.map((l) => {
          const key = listingKey(l);
          return (
            <li key={key}>
              <MyListingRow
                listing={l}
                selected={effectiveSelected.has(key)}
                onToggle={() => toggle(key)}
                disabled={isBulkRunning}
              />
            </li>
          );
        })}
      </ul>

      {/* Sticky bulk action bar — appears once anything is selected OR
       *  during the post-loop "confirmed" pulse so the user gets visual
       *  closure even after we clear the selection. */}
      {(selectedCount > 0 || bulkState.kind === "confirmed") && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              {bulkState.kind === "confirmed" ? (
                <ConfirmationChip status="confirmed" />
              ) : (
                <>
                  <span className="font-mono text-amber-300">
                    {selectedCount}
                  </span>{" "}
                  selected
                </>
              )}
              {(bulkState.kind === "submitting" ||
                bulkState.kind === "confirming") && (
                <span className="ml-2 text-zinc-500">
                  · {bulkState.label}
                  {bulkState.total > 1
                    ? ` (collection ${bulkState.current}/${bulkState.total})`
                    : ""}
                </span>
              )}
              {bulkState.kind === "confirming" && (
                <ConfirmationChip status="confirming" />
              )}
            </div>
            {bulkState.kind !== "confirmed" && (
              <button
                type="button"
                onClick={handleBulkReclaim}
                disabled={isBulkRunning}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {bulkState.kind === "submitting"
                  ? "submitting…"
                  : bulkState.kind === "confirming"
                    ? "confirming…"
                    : `reclaim ${selectedCount}`}
              </button>
            )}
          </div>
          {bulkState.kind === "error" && (
            <div className="mx-auto max-w-6xl px-6 pb-3">
              {typeof bulkState.error === "string" ? (
                <Notice severity="info">{bulkState.error}</Notice>
              ) : (
                <ErrorView
                  error={bulkState.error}
                  context={{ action: "reclaimed", subject: "listing" }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MyListingRow({
  listing,
  selected,
  onToggle,
  disabled,
}: {
  listing: P2pListing;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const depositAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);
  const offered = listing.offered_nft_unit.slice(56);
  return (
    <label
      className={
        "flex cursor-pointer items-baseline gap-3 rounded-lg border bg-zinc-950/40 p-3 transition " +
        (selected
          ? "border-amber-700/60 bg-amber-950/10"
          : "border-zinc-800 hover:border-zinc-600") +
        (disabled ? " cursor-not-allowed opacity-60" : "")
      }
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-3.5 w-3.5 flex-none accent-amber-500"
        aria-label={`select listing ${listing.tx_hash.slice(0, 8)}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">{asciiOrShortHex(offered)}</p>
        <p className="text-[10px] text-zinc-500">
          deposit {depositAda} ADA · root{" "}
          <span className="font-mono">
            {listing.accepted_merkle_root.slice(0, 8)}…
          </span>
        </p>
      </div>
    </label>
  );
}

function asciiOrShortHex(hex: string): string {
  if (!hex) return "(no name)";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.every((b) => b >= 0x20 && b <= 0x7e)) {
    return new TextDecoder().decode(bytes);
  }
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
