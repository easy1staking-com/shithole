/**
 * Network selection — read from NEXT_PUBLIC_CARDANO_NETWORK and the
 * matching Blockfrost project id from NEXT_PUBLIC_BLOCKFROST_PROJECT_ID.
 *
 * Default: preprod. No runtime UI to switch networks.
 */

import type { Network } from "@/lib/tx/swap";

export type CardanoNetworkName = "mainnet" | "preprod" | "preview";

export function getNetworkName(): CardanoNetworkName {
  const raw = process.env.NEXT_PUBLIC_CARDANO_NETWORK;
  if (raw === "mainnet" || raw === "preprod" || raw === "preview") {
    return raw;
  }
  return "preprod";
}

/**
 * Maps our env-style name to the discriminator the tx-builder code uses
 * for network branching ('Mainnet' | 'Preprod' | 'Preview').
 */
export function toEvolutionNetwork(name: CardanoNetworkName): Network {
  switch (name) {
    case "mainnet":
      return "Mainnet";
    case "preprod":
      return "Preprod";
    case "preview":
      return "Preview";
  }
}

/** Returns 1 for mainnet, 0 for testnets — matches CIP-30 getNetworkId. */
export function expectedNetworkId(name: CardanoNetworkName): 0 | 1 {
  return name === "mainnet" ? 1 : 0;
}

export function getBlockfrostProjectId(): string | null {
  const id = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID;
  return id && id.length > 0 ? id : null;
}

export function getBlockfrostUrl(name: CardanoNetworkName): string {
  switch (name) {
    case "mainnet":
      return "https://cardano-mainnet.blockfrost.io/api/v0";
    case "preprod":
      return "https://cardano-preprod.blockfrost.io/api/v0";
    case "preview":
      return "https://cardano-preview.blockfrost.io/api/v0";
  }
}
