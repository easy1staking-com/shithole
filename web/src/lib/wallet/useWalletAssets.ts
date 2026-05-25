"use client";

import { useQuery } from "@tanstack/react-query";

import { getBlockfrostProjectId } from "./network";

/**
 * Every non-ADA asset the connected wallet currently holds at the given
 * bech32 address. Generalised counterpart to {@code useWalletCollectionNfts}
 * — no policy filter, includes both NFTs (qty 1) and fungibles. Used by
 * the /market/new picker so the seller can drop any asset they own into
 * a listing.
 */
export type WalletAsset = {
  unit: string;
  policyId: string;
  assetNameHex: string;
  /** Quantity held — bigint as string for fungibles. */
  quantity: string;
};

export function useWalletAssets(addressBech32: string | null) {
  return useQuery({
    queryKey: ["walletAssets", addressBech32],
    queryFn: async (): Promise<WalletAsset[]> => {
      if (!addressBech32) return [];
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
      if (resp.status === 404) return [];
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(
          `blockfrost ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
        );
      }
      const data = (await resp.json()) as {
        amount?: Array<{ unit: string; quantity: string }>;
      };
      if (!data.amount) return [];
      const out: WalletAsset[] = [];
      for (const a of data.amount) {
        if (!a.unit || a.unit === "lovelace") continue;
        out.push({
          unit: a.unit,
          policyId: a.unit.slice(0, 56),
          assetNameHex: a.unit.slice(56),
          quantity: a.quantity,
        });
      }
      out.sort((x, y) => x.unit.localeCompare(y.unit));
      return out;
    },
    enabled: Boolean(addressBech32),
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
