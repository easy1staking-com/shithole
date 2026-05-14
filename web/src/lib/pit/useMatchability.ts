"use client";

import { useMemo } from "react";

import type { Listing } from "@/types/api";
import type { WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";

import {
  computeMatches,
  type Match,
  type PoolListingRef,
  type WalletNftRef,
} from "./bucketMath";

/**
 * Eagerly compute which wallet NFTs have at least one bucket-match in the
 * current pool. Per Giovanni's UX call: the result is consumed silently
 * (no green/red badges on cards) — we only surface "no match" if the user
 * actually tries to drop an unmatchable NFT into the pit.
 *
 * <p>Returns a stable Map keyed by wallet NFT unit hex. Caller asks
 * {@code matches.get(unit)} when the user drops; if present, drop succeeds
 * and the bucket-matched listing is the consumed NA.
 *
 * <p>Recomputes only when the input lists or M change — bucket-math is
 * fast (~ms for 10×10) but consistent memoization avoids re-running on
 * unrelated rerenders (e.g. drag-state ticks).
 */
export function useMatchability(
  walletNfts: WalletCollectionNft[] | undefined,
  pool: Listing[] | undefined,
  collectionPolicyHex: string | undefined,
  m: number | undefined,
): Map<string, Match> {
  return useMemo(() => {
    if (!walletNfts || !pool || !collectionPolicyHex || !m) {
      return new Map();
    }
    const walletRefs: WalletNftRef[] = walletNfts.map((n) => ({
      unit: n.unit,
      policyHex: n.policyId,
      assetNameHex: n.assetNameHex,
    }));
    // Stable pool order so the "pick first match" choice doesn't flicker
    // when Blockfrost / the indexer reshuffles result ordering. Sort by
    // listing tx-hash (then output_index).
    const sortedPool = [...pool].sort((a, b) => {
      const c = a.utxo_ref.tx_id.localeCompare(b.utxo_ref.tx_id);
      return c !== 0 ? c : a.utxo_ref.output_index - b.utxo_ref.output_index;
    });
    const poolRefs: PoolListingRef[] = sortedPool.map((l) => ({
      unit: l.current_nft_unit,
      // Strip the 56-char policy prefix → asset name only.
      assetNameHex: l.current_nft_unit.slice(56),
      txHex: l.utxo_ref.tx_id,
      outputIndex: l.utxo_ref.output_index,
    }));
    return computeMatches(walletRefs, poolRefs, m, collectionPolicyHex);
  }, [walletNfts, pool, collectionPolicyHex, m]);
}
