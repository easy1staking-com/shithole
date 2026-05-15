/**
 * Evolution SDK client factory — bound to the CIP-30 wallet that the
 * user connected. Replaces the lucid-evolution makeLucid helper.
 *
 * <p>Evolution's Client uses staged capability assembly: start with
 * a network constant, add a chain provider, add a wallet. The result
 * is a fully-equipped client that exposes both chain queries
 * ({@code getUtxos}, {@code getUtxosByOutRef}, {@code awaitTx}…) and
 * wallet actions ({@code signTx}, {@code submitTx}, {@code newTx}).
 */

import { Client, mainnet, preprod, preview } from "@evolution-sdk/evolution";

import type { Cip30Api } from "@/lib/wallet/cip30";
import {
  getBlockfrostProjectId,
  getBlockfrostUrl,
  getNetworkName,
  type CardanoNetworkName,
} from "@/lib/wallet/network";

/**
 * The runtime shape of an Evolution Client AFTER provider + wallet are
 * attached. Inferred from the builder chain — Evolution's types are
 * heavy on Effect-TS generics so we capture the post-builder type once
 * here and reuse it across the tx code.
 */
export type EvolutionClient = ReturnType<typeof attachWallet>;

function attachWallet(
  network: typeof preprod | typeof mainnet | typeof preview,
  baseUrl: string,
  projectId: string,
  walletApi: Cip30Api,
) {
  // The cip30 type from window.cardano[name].enable() is API-compatible
  // with Evolution's expected CIP-30 shape — both are the standard
  // CIP-30 surface.
  return Client.make(network)
    .withBlockfrost({ baseUrl, projectId })
    .withCip30(walletApi as unknown as Parameters<
      ReturnType<typeof Client.make>["withCip30"]
    >[0]);
}

function networkOf(name: CardanoNetworkName) {
  switch (name) {
    case "mainnet":
      return mainnet;
    case "preview":
      return preview;
    case "preprod":
    default:
      return preprod;
  }
}

export async function makeClient(walletApi: Cip30Api): Promise<EvolutionClient> {
  const networkName = getNetworkName();
  const projectId = getBlockfrostProjectId();
  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not set — cannot build a tx provider",
    );
  }
  const baseUrl = getBlockfrostUrl(networkName);
  return attachWallet(networkOf(networkName), baseUrl, projectId, walletApi);
}
