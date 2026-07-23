"use client";

import { Address } from "@evolution-sdk/evolution";
import { useQuery } from "@tanstack/react-query";

import { listPools, type Pool } from "@/lib/market/poolTraits";
import {
  getBlockfrostProjectId,
  getBlockfrostUrl,
  getNetworkName,
} from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Which stake pool is the connected wallet delegating to — and is it
 * one of ours? Drives the gallery's rug-pool levers + zombie greeter.
 *
 * Flow: CIP-30 getRewardAddresses() → hex reward address → bech32 stake
 * address → Blockfrost /accounts/{stake} → pool_id. A 404 simply means
 * the stake key was never registered (fresh wallet).
 */

export type DelegationInfo = {
  /** bech32 stake address (stake1… / stake_test1…). */
  stakeAddress: string;
  /** Raw CIP-30 reward address hex (header byte + 28-byte credential). */
  rewardAddressHex: string;
  /** True once the stake key is registered on chain (deposit paid). */
  registered: boolean;
  /** bech32 pool id currently delegated to, null if none. */
  poolId: string | null;
  /** The rug pool that pool id maps to, if any (dev alias applied). */
  rugPool: Pool | null;
};

/**
 * Dev/preprod escape hatch: the 12 rug pools only exist on mainnet, so
 * NEXT_PUBLIC_DEV_POOL_ALIAS="pool1…:HOSKY" maps a preprod pool to a
 * ticker — delegate a test wallet to it and the zombie thanks you.
 */
export function devPoolAlias(): { poolId: string; ticker: string } | null {
  const raw = process.env.NEXT_PUBLIC_DEV_POOL_ALIAS;
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return {
    poolId: raw.slice(0, idx).toLowerCase(),
    ticker: raw.slice(idx + 1).toUpperCase(),
  };
}

/** Map a delegated pool id to a rug pool (respecting the dev alias). */
export function rugPoolFor(poolId: string | null): Pool | null {
  if (!poolId) return null;
  const id = poolId.toLowerCase();
  // The alias is a preprod testing tool ONLY — on mainnet an
  // accidentally-set env var must not make the zombie thank strangers.
  const alias = getNetworkName() === "mainnet" ? null : devPoolAlias();
  const aliasTicker = alias && alias.poolId === id ? alias.ticker : null;
  return (
    listPools().find(
      (p) => p.poolId.toLowerCase() === id || p.ticker === aliasTicker,
    ) ?? null
  );
}

/**
 * The pool id a lever for {@code ticker} should delegate to on THIS
 * network: the real mainnet pool, or the dev alias off-mainnet so the
 * whole flow is testable on preprod.
 */
export function leverTargetPoolId(ticker: string): string | null {
  const alias = devPoolAlias();
  if (getNetworkName() !== "mainnet" && alias?.ticker === ticker.toUpperCase()) {
    return alias.poolId;
  }
  return listPools().find((p) => p.ticker === ticker)?.poolId ?? null;
}

async function fetchDelegation(
  rewardAddressHex: string,
): Promise<DelegationInfo> {
  const stakeAddress = Address.toBech32(Address.fromHex(rewardAddressHex));
  const projectId = getBlockfrostProjectId();
  if (!projectId) {
    throw new Error("NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not set");
  }
  const res = await fetch(
    `${getBlockfrostUrl(getNetworkName())}/accounts/${stakeAddress}`,
    { headers: { project_id: projectId } },
  );
  if (res.status === 404) {
    // Never seen on chain — unregistered stake key.
    return {
      stakeAddress,
      rewardAddressHex,
      registered: false,
      poolId: null,
      rugPool: null,
    };
  }
  if (!res.ok) {
    throw new Error(`delegation lookup failed (${res.status})`);
  }
  const body = (await res.json()) as {
    active: boolean;
    pool_id: string | null;
  };
  const poolId = body.pool_id ?? null;
  return {
    stakeAddress,
    rewardAddressHex,
    registered: body.active || Boolean(poolId),
    poolId,
    rugPool: rugPoolFor(poolId),
  };
}

export const DELEGATION_QUERY_KEY = "wallet-delegation";

export function useDelegation() {
  const api = useWalletStore((s) => s.api);
  const addressHex = useWalletStore((s) => s.addressHex);

  return useQuery({
    // Keyed on the wallet's address: switching wallets/accounts must not
    // serve the previous wallet's delegation from cache.
    queryKey: [DELEGATION_QUERY_KEY, addressHex ?? "none"],
    enabled: Boolean(api),
    staleTime: 30_000,
    queryFn: async (): Promise<DelegationInfo | null> => {
      const rewards = await api!.getRewardAddresses();
      const rewardAddressHex = rewards[0];
      if (!rewardAddressHex) return null;
      return fetchDelegation(rewardAddressHex);
    },
  });
}
