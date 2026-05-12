/**
 * Lucid Evolution client factory — bound to the CIP-30 wallet that the
 * user connected. Reads network + Blockfrost project id from env.
 */

import { Blockfrost, Lucid, type LucidEvolution } from "@lucid-evolution/lucid";

import type { Cip30Api } from "@/lib/wallet/cip30";
import {
  getBlockfrostProjectId,
  getBlockfrostUrl,
  getNetworkName,
  toEvolutionNetwork,
} from "@/lib/wallet/network";

export async function makeLucid(
  walletApi: Cip30Api,
): Promise<LucidEvolution> {
  const networkName = getNetworkName();
  const network = toEvolutionNetwork(networkName);
  const projectId = getBlockfrostProjectId();
  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not set — cannot build a tx provider",
    );
  }
  const provider = new Blockfrost(getBlockfrostUrl(networkName), projectId);
  const lucid = await Lucid(provider, network);
  // The cip30 `WalletApi` from `window.cardano[name]` is API-compatible
  // with Evolution's WalletApi type — they're both CIP-30.
  lucid.selectWallet.fromAPI(walletApi as unknown as Parameters<typeof lucid.selectWallet.fromAPI>[0]);
  return lucid;
}
