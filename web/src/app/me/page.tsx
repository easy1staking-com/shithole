"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import { useMyListings, type MyListingRow } from "@/lib/me/useMyListings";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { submitCancel, submitCancelAndRelist } from "@/lib/tx/cancel";
import { DEFAULT_LISTING_LOVELACE } from "@/lib/tx/list";
import { makeLucid } from "@/lib/tx/lucidClient";
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
export default function MePage() {
  const { addressBech32, paymentKeyHashHex } = useWalletStore();
  const pkhLower = paymentKeyHashHex?.toLowerCase() ?? null;
  const { rows, isLoading, error, anyCapped } = useMyListings(pkhLower);

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
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <MyListingCard key={listingKey(row)} row={row} />
          ))}
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

function MyListingCard({ row }: { row: MyListingRow }) {
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
    async (label: string, fn: (lucid: Awaited<ReturnType<typeof makeLucid>>) => Promise<void>) => {
      if (!api) {
        setState({ kind: "error", message: "connect a wallet first" });
        return;
      }
      setState({ kind: "running", label });
      try {
        const lucid = await makeLucid(api);
        await fn(lucid);
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
            disabled={state.kind === "running" || accruedAda === 0}
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
            disabled={state.kind === "running"}
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
