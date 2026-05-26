/**
 * Whitelist of NFT collections allowed on /market. Mirrors
 * {@link supportedPriceTokens} — one preprod entry, one mainnet entry,
 * picked at runtime via {@code getNetworkName()}.
 *
 * <p>v1 ships HOSKY CashGrab only. The preprod entry is the
 * MintHoskyMimicTool's policy (asset names match mainnet byte-for-byte
 * so the merkle / rarity / pool-trait lookups port across).
 */

import { getNetworkName, type CardanoNetworkName } from "@/lib/wallet/network";

export type SupportedCollection = {
  /** User-facing label. */
  label: string;
  /** 28-byte hex policy id. */
  policyId: string;
};

const PREPROD_COLLECTIONS: SupportedCollection[] = [
  {
    label: "HOSKY CashGrab",
    // MintHoskyMimicTool default policy (preprod). Asset names mirror
    // mainnet so trait lookups carry over.
    policyId: "ca53618b78dc2e22303a53d5601e044818422816fba8be3797257004",
  },
];

const MAINNET_COLLECTIONS: SupportedCollection[] = [
  {
    label: "HOSKY CashGrab",
    policyId: "a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559",
  },
];

const BY_NETWORK: Record<CardanoNetworkName, SupportedCollection[]> = {
  mainnet: MAINNET_COLLECTIONS,
  preprod: PREPROD_COLLECTIONS,
  preview: PREPROD_COLLECTIONS,
};

export function supportedCollections(
  network: CardanoNetworkName = getNetworkName(),
): SupportedCollection[] {
  return BY_NETWORK[network] ?? PREPROD_COLLECTIONS;
}

/** Returns true if the unit's policy id is in the whitelist. */
export function isSupportedCollection(
  unit: string,
  network: CardanoNetworkName = getNetworkName(),
): boolean {
  const policy = unit.slice(0, 56).toLowerCase();
  return supportedCollections(network).some(
    (c) => c.policyId.toLowerCase() === policy,
  );
}
