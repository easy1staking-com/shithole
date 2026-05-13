"use client";

import { useQuery } from "@tanstack/react-query";

import { getBlockfrostProjectId } from "./network";

/**
 * One NFT held by the wallet under a specific collection policy.
 * The {@code unit} is the policy-id-hex + asset-name-hex concatenation
 * (Cardano's standard "unit" identifier).
 */
export type WalletCollectionNft = {
  unit: string;
  policyId: string;
  assetNameHex: string;
};

/**
 * Enumerate the connected wallet's NFTs that fall under {@code policyHex}.
 *
 * <p>Reads directly from Blockfrost's {@code /addresses/{addr}/extended}
 * endpoint using the public {@code NEXT_PUBLIC_BLOCKFROST_PROJECT_ID}.
 * Bypasses Lucid (no need to bundle the SDK just to enumerate assets) and
 * the BE (no new endpoint required during the BE freeze).
 *
 * <p>React Query handles caching + refetch-on-window-focus. Updates after a
 * swap require an explicit invalidate (the caller does
 * {@code queryClient.invalidateQueries({ queryKey: ['walletCollection', addr, policy] })}
 * after the tx submits).
 */
export function useWalletCollectionNfts(
  addressBech32: string | null,
  policyHex: string | null,
) {
  return useQuery({
    queryKey: ["walletCollection", addressBech32, policyHex],
    queryFn: async (): Promise<WalletCollectionNft[]> => {
      if (!addressBech32 || !policyHex) return [];
      const projectId = getBlockfrostProjectId();
      if (!projectId) {
        throw new Error(
          "NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not set; cannot enumerate wallet assets",
        );
      }
      const network = getBlockfrostNetwork();
      const url = `https://cardano-${network}.blockfrost.io/api/v0/addresses/${addressBech32}/extended`;
      const resp = await fetch(url, {
        headers: { project_id: projectId, accept: "application/json" },
      });
      if (resp.status === 404) {
        // Address never used → no assets.
        return [];
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(
          `blockfrost ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
        );
      }
      const data = (await resp.json()) as { amount?: Array<{ unit: string; quantity: string }> };
      if (!data.amount) return [];
      const lowerPolicy = policyHex.toLowerCase();
      const out: WalletCollectionNft[] = [];
      for (const a of data.amount) {
        if (!a.unit || a.unit === "lovelace") continue;
        if (!a.unit.toLowerCase().startsWith(lowerPolicy)) continue;
        if (a.quantity !== "1") continue;
        out.push({
          unit: a.unit,
          policyId: a.unit.slice(0, 56),
          assetNameHex: a.unit.slice(56),
        });
      }
      // Stable order so the drawer doesn't reshuffle on every render.
      out.sort((x, y) => x.unit.localeCompare(y.unit));
      return out;
    },
    enabled: Boolean(addressBech32 && policyHex),
    staleTime: 15_000,
    retry: 1,
  });
}

function getBlockfrostNetwork(): "mainnet" | "preprod" | "preview" {
  const n = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? "preprod").toLowerCase();
  if (n === "mainnet") return "mainnet";
  if (n === "preview") return "preview";
  return "preprod";
}
