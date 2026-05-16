"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import { useMyListings, type MyListingRow } from "@/lib/me/useMyListings";
import type { ListingsResponse } from "@/types/api";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import {
  submitCancel,
  submitCancelAllForCollection,
  submitCancelAndRelist,
} from "@/lib/tx/cancel";
import { DEFAULT_LISTING_LOVELACE } from "@/lib/tx/list";
import { makeClient } from "@/lib/tx/evolutionClient";
import { fetchUtxoByOutRef } from "@/lib/tx/swap";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * /me — every listing the connected wallet owns, across all curated
 * collections. Each row supports:
 *
 * <ul>
 *   <li><b>Cancel + relist</b>: claim the accrued ADA but keep the NFT
 *       in the pit. Two-tx sequence (cancel first; relist after the
 *       cancel confirms). Net effect: lister pockets the accrued, NFT
 *       continues participating.</li>
 *   <li><b>Cancel only</b>: pull the NFT (+ all its accrued ADA + the
 *       min-UTxO) out of the pit and back to the wallet.</li>
 * </ul>
 *
 * <p>SPEC §5.5: the on-chain Cancel handler requires only a signature
 * from the listing's {@code lister_pkh}. The validator does not check
 * the output destination — change flows back to the wallet via the
 * standard tx-balance path.
 */
type BulkState =
  | { kind: "idle" }
  | { kind: "running"; current: number; total: number; label: string }
  | { kind: "error"; message: string };

export default function MePage() {
  const { addressBech32, paymentKeyHashHex, api } = useWalletStore();
  const pkhLower = paymentKeyHashHex?.toLowerCase() ?? null;
  const { rows, isLoading, error, anyCapped } = useMyListings(pkhLower);
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<BulkState>({ kind: "idle" });

  // Drop any keys no longer in the result set (refresh, cancel etc.)
  const liveKeys = useMemo(() => new Set(rows.map(listingKey)), [rows]);
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((k) => liveKeys.has(k))),
    [selected, liveKeys],
  );

  const allSelected = rows.length > 0 && effectiveSelected.size === rows.length;
  const someSelected = effectiveSelected.size > 0 && !allSelected;

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
      if (s.size === rows.length) return new Set();
      return new Set(rows.map(listingKey));
    });
  }, [rows]);

  const handleBulkWithdraw = useCallback(async () => {
    if (!api) {
      setBulkState({ kind: "error", message: "connect a wallet first" });
      return;
    }
    // Group selected rows by config_nft_policy → one tx per collection.
    const byCollection = new Map<
      string,
      { displayName: string; rows: MyListingRow[] }
    >();
    for (const row of rows) {
      const k = listingKey(row);
      if (!effectiveSelected.has(k)) continue;
      const policy = row.collection.config_nft_policy;
      const entry = byCollection.get(policy) ?? {
        displayName: row.collection.display_name,
        rows: [],
      };
      entry.rows.push(row);
      byCollection.set(policy, entry);
    }
    const groups = Array.from(byCollection.entries());
    if (groups.length === 0) return;

    const total = groups.length;
    try {
      const client = await makeClient(api);
      const network = toEvolutionNetwork(getNetworkName());
      for (let i = 0; i < groups.length; i++) {
        const [policy, { displayName, rows: groupRows }] = groups[i];
        setBulkState({
          kind: "running",
          current: i + 1,
          total,
          label: `withdrawing ${groupRows.length} from ${displayName}`,
        });
        const utxos = await Promise.all(
          groupRows.map((r) =>
            fetchUtxoByOutRef(
              client,
              r.listing.utxo_ref.tx_id,
              r.listing.utxo_ref.output_index,
            ),
          ),
        );
        const result = await submitCancelAllForCollection(client, {
          network,
          configNftPolicyHex: policy,
          consumed: utxos,
        });
        await awaitTxConfirmation(client, result.txHash);

        // Optimistically strip the cancelled listings from the cached
        // ["listings", slug, ...] entries for THIS collection. The BE
        // indexer needs a few seconds to see the spend; refetching too
        // soon just returns the same stale rows. Stripping here makes
        // the rows disappear instantly from /me and the pit page.
        const cancelledKeys = new Set(
          groupRows.map(
            (r) =>
              `${r.listing.utxo_ref.tx_id}#${r.listing.utxo_ref.output_index}`,
          ),
        );
        const slug = groupRows[0].collection.slug;
        queryClient.setQueriesData<ListingsResponse>(
          { queryKey: ["listings", slug] },
          (prev) => {
            if (!prev) return prev;
            const next = prev.data.filter(
              (l) =>
                !cancelledKeys.has(
                  `${l.utxo_ref.tx_id}#${l.utxo_ref.output_index}`,
                ),
            );
            const removed = prev.data.length - next.length;
            return {
              ...prev,
              data: next,
              total: Math.max(0, prev.total - removed),
            };
          },
        );
      }
      // Background refresh — by the time the user does anything else
      // the BE indexer should have caught up and the refetch confirms
      // the optimistic state.
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["walletCollection"] });
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      setSelected(new Set());
      setBulkState({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("bulk withdraw failed:", message);
      setBulkState({ kind: "error", message: message.slice(0, 300) });
    }
  }, [api, rows, effectiveSelected, queryClient]);

  const isBulkRunning = bulkState.kind === "running";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 pt-8 pb-24">
      <header>
        <div className="flex items-start justify-between gap-3">
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
          >
            ← back
          </Link>
          <WalletConnectButton />
        </div>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-100">your s#!t in the pits</h1>
        <p className="mt-1 text-sm text-zinc-400">
          everything you&apos;ve dumped, with what&apos;s accrued from passing swappers.
        </p>
      </header>

      {!addressBech32 && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
          <p>connect a wallet to see your listings.</p>
          <WalletConnectButton />
        </div>
      )}

      {addressBech32 && isLoading && rows.length === 0 && (
        <p className="text-sm text-zinc-500">counting your contributions…</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-300" role="alert">
          couldn&apos;t fetch your listings: {error.message}
        </p>
      )}

      {addressBech32 && !isLoading && rows.length === 0 && !error && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
          you haven&apos;t dumped anything yet. find a pit and start contributing to the mess.
        </p>
      )}

      {rows.length > 0 && (
        <SelectionToolbar
          totalCount={rows.length}
          selectedCount={effectiveSelected.size}
          allSelected={allSelected}
          someSelected={someSelected}
          isBulkRunning={isBulkRunning}
          onToggleAll={toggleAll}
          onBulkWithdraw={handleBulkWithdraw}
        />
      )}

      {bulkState.kind === "running" && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
          {bulkState.label}… ({bulkState.current}/{bulkState.total})
        </p>
      )}

      {bulkState.kind === "error" && (
        <p
          className="rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-3 text-sm text-red-300"
          role="alert"
        >
          bulk withdraw failed: {bulkState.message}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const k = listingKey(row);
            return (
              <MyListingCard
                key={k}
                row={row}
                selected={effectiveSelected.has(k)}
                onToggleSelect={() => toggle(k)}
                disabled={isBulkRunning}
              />
            );
          })}
        </ul>
      )}

      {anyCapped && (
        <p className="text-xs text-zinc-500">
          showing the first 100 listings per pit. if you have more, they&apos;ll
          appear here once we add a paged endpoint.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Selection toolbar                                                          */
/* -------------------------------------------------------------------------- */

function SelectionToolbar({
  totalCount,
  selectedCount,
  allSelected,
  someSelected,
  isBulkRunning,
  onToggleAll,
  onBulkWithdraw,
}: {
  totalCount: number;
  selectedCount: number;
  allSelected: boolean;
  someSelected: boolean;
  isBulkRunning: boolean;
  onToggleAll: () => void;
  onBulkWithdraw: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={onToggleAll}
          disabled={isBulkRunning}
          className="h-4 w-4 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-zinc-100"
          aria-label={allSelected ? "deselect all" : "select all"}
        />
        <span className="uppercase tracking-wide text-zinc-400">
          {selectedCount === 0
            ? `select all (${totalCount})`
            : `${selectedCount} selected`}
        </span>
      </label>
      <button
        type="button"
        onClick={onBulkWithdraw}
        disabled={selectedCount === 0 || isBulkRunning}
        className="rounded-md border border-zinc-700 px-4 py-1.5 text-xs uppercase tracking-wide text-zinc-100 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
        title="cancel every selected listing — one tx per collection"
      >
        withdraw {selectedCount > 0 ? `${selectedCount} selected` : "selected"}
      </button>
    </div>
  );
}

function listingKey(row: MyListingRow): string {
  return `${row.listing.utxo_ref.tx_id}#${row.listing.utxo_ref.output_index}`;
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

type ActionState =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "error"; message: string };

function MyListingCard({
  row,
  selected,
  onToggleSelect,
  disabled,
}: {
  row: MyListingRow;
  selected: boolean;
  onToggleSelect: () => void;
  disabled: boolean;
}) {
  const { collection, listing } = row;
  const meta = useNftMetadata(listing.current_nft_unit);
  const queryClient = useQueryClient();
  const { api } = useWalletStore();
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  const accent = collection.theme?.accent_color ?? "#b87333";
  const name = meta.data?.name ?? listing.current_nft_unit.slice(56);
  const image = meta.data?.image_url ?? null;
  // BE hardcodes accrued_lovelace=0 (CollectionController:152-154 — no
  // per-row min_utxo tracking yet). Derive client-side from the listing's
  // total lovelace minus our FE-enforced floor. Holds as long as every
  // genesis listing was created with DEFAULT_LISTING_LOVELACE (which our
  // list.ts enforces — third-party listers using a different floor would
  // throw off the derivation by their extra padding).
  const accruedLovelaceDerived = Math.max(
    0,
    listing.lovelace - Number(DEFAULT_LISTING_LOVELACE),
  );
  const accruedAda = accruedLovelaceDerived / 1_000_000;
  const totalAda = listing.lovelace / 1_000_000;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["listings", collection.slug] });
    queryClient.invalidateQueries({ queryKey: ["collection", collection.slug] });
    queryClient.invalidateQueries({
      queryKey: ["walletCollection"],
    });
  }, [queryClient, collection.slug]);

  const runWithLucid = useCallback(
    async (label: string, fn: (client: Awaited<ReturnType<typeof makeClient>>) => Promise<void>) => {
      if (!api) {
        setState({ kind: "error", message: "connect a wallet first" });
        return;
      }
      setState({ kind: "running", label });
      try {
        const client = await makeClient(api);
        await fn(client);
        invalidate();
        setState({ kind: "idle" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${label} failed:`, message);
        setState({ kind: "error", message: message.slice(0, 200) });
      }
    },
    [api, invalidate],
  );

  const handleWithdraw = useCallback(() => {
    runWithLucid("withdrawing", async (lucid) => {
      const network = toEvolutionNetwork(getNetworkName());
      const consumed = await fetchUtxoByOutRef(
        lucid,
        listing.utxo_ref.tx_id,
        listing.utxo_ref.output_index,
      );
      const result = await submitCancel(lucid, {
        network,
        configNftPolicyHex: collection.config_nft_policy,
        consumed,
      });
      await awaitTxConfirmation(lucid, result.txHash);
    });
  }, [runWithLucid, listing, collection]);

  const handleClaim = useCallback(() => {
    runWithLucid("claiming", async (lucid) => {
      const network = toEvolutionNetwork(getNetworkName());
      const consumed = await fetchUtxoByOutRef(
        lucid,
        listing.utxo_ref.tx_id,
        listing.utxo_ref.output_index,
      );
      // Single atomic tx: cancel the consumed listing AND replant the
      // NFT in the same tx. Accrued ADA flows back as change. No race
      // window between cancel and relist.
      const result = await submitCancelAndRelist(lucid, {
        network,
        configNftPolicyHex: collection.config_nft_policy,
        consumed,
      });
      await awaitTxConfirmation(lucid, result.txHash);
    });
  }, [runWithLucid, listing, collection]);

  return (
    <li
      className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
      style={{ boxShadow: `0 0 0 1px ${accent}11` }}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-4">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={disabled}
            className="h-4 w-4 flex-none cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-zinc-100 disabled:cursor-not-allowed"
            aria-label={selected ? "deselect listing" : "select listing"}
          />
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              className="h-20 w-20 flex-none rounded-md object-cover"
            />
          ) : (
            <div className="h-20 w-20 flex-none rounded-md bg-zinc-900" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/pit/${collection.slug}`}
                className="text-[0.65rem] uppercase tracking-widest hover:underline"
                style={{ color: accent }}
              >
                {collection.display_name}
              </Link>
            </div>
            <p className="mt-0.5 text-base font-semibold text-zinc-100 truncate">{name}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {accruedAda > 0 ? (
                <>
                  <span className="font-medium text-zinc-300">
                    {accruedAda.toFixed(2)} ADA accrued
                  </span>
                  <span className="ml-2 text-zinc-600">· total in utxo: {totalAda.toFixed(2)} ADA</span>
                </>
              ) : (
                <>no swaps yet · {totalAda.toFixed(2)} ADA locked as min-utxo</>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={handleClaim}
            disabled={state.kind === "running" || disabled || accruedAda === 0}
            title={
              accruedAda === 0
                ? "no ADA has accrued yet — nothing to claim"
                : "take the accrued ADA; NFT stays in the pit"
            }
            className="rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              backgroundColor: accent,
              color: "#0a0a0a",
            }}
          >
            claim
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={state.kind === "running" || disabled}
            className="rounded-md border border-zinc-700 px-4 py-1.5 text-xs uppercase tracking-wide text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            title="pull the NFT and ADA out of the pit; it'll no longer participate in swaps"
          >
            withdraw
          </button>
        </div>
      </div>
      {state.kind === "running" && (
        <div
          className="border-t border-zinc-800/60 px-4 py-2 text-xs"
          style={{ color: accent }}
        >
          {state.label}…
        </div>
      )}
      {state.kind === "error" && (
        <div
          className="border-t border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-300"
          role="alert"
        >
          {state.message}
        </div>
      )}
    </li>
  );
}
