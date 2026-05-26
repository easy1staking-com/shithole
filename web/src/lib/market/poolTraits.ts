/**
 * Hosky rug-pool → matching-traits map. Each pool curates a set of
 * (category, value) traits its NFTs should carry — the v3 wanted-listing
 * concept exposed as a filter on /market here. Generated from
 * {@code .local/rug-pool-matching-traits-merged.csv} by
 * {@code .local/build-pool-traits.py}.
 */

import raw from "./poolTraits.json";

export type PoolTrait = {
  category: string;
  value: string;
  count: number;
};

export type Pool = {
  ticker: string;
  poolId: string;
  traits: PoolTrait[];
};

type RawDoc = { pools: Pool[] };

export function listPools(): Pool[] {
  return (raw as RawDoc).pools;
}

export function poolByTicker(ticker: string): Pool | null {
  return listPools().find((p) => p.ticker === ticker) ?? null;
}

/**
 * Decide whether an NFT's traits match a pool's curated set. The NFT
 * matches iff it carries AT LEAST ONE (category, value) pair from the
 * pool's traits list. Returns the matched pairs for surfacing in the UI.
 */
export function matchesPool(
  nftTraits: Array<{ category: string; value: string }>,
  pool: Pool,
): PoolTrait[] {
  const matched: PoolTrait[] = [];
  for (const t of pool.traits) {
    if (
      nftTraits.some(
        (nt) => nt.category === t.category && nt.value === t.value,
      )
    ) {
      matched.push(t);
    }
  }
  return matched;
}
