/**
 * Whitelist of NFT collections allowed on /market. Mirrors
 * {@link supportedPriceTokens} — network-keyed, picked at runtime via
 * {@code getNetworkName()}.
 *
 * <p>The marketplace is a singleton script, so adding a collection is a
 * data change here (whitelist its NFT policy id) — no on-chain deploy.
 * Each collection carries an optional {@code defaultPriceTokenLabel}: the
 * /market/new form pre-selects that currency when the collection is
 * chosen (the seller can still override per listing).
 *
 * <p>Preprod entries for gnomeskies / snekkies / tenk are the
 * MintFromFixtureTool policies (real mainnet CIP-25 embedded verbatim,
 * minted 2026-07-13; see .local/preprod-mints.json). Mainnet still ships
 * HOSKY CashGrab only — the new collections go live at cutover.
 */

import { getNetworkName, type CardanoNetworkName } from "@/lib/wallet/network";

export type SupportedCollection = {
  /** User-facing label. */
  label: string;
  /** 28-byte hex policy id. */
  policyId: string;
  /**
   * Label of the {@link supportedPriceTokens} entry pre-selected as the
   * default currency for this collection in the list form. Omit for ADA.
   */
  defaultPriceTokenLabel?: string;
  /** Per-collection accent (tabs, strip chips). Matches the BE seed CSV. */
  accentColor?: string;
  /**
   * True for collections whose NFTs carry the Hosky rug-pool trait
   * mapping ({@link poolTraits}). In the 3D gallery these collections
   * open into a pool-door lobby instead of a single room.
   */
  poolDoors?: boolean;
};

const PREPROD_COLLECTIONS: SupportedCollection[] = [
  {
    label: "HOSKY CashGrab",
    // MintHoskyMimicTool default policy (preprod). Asset names mirror
    // mainnet so trait lookups carry over.
    policyId: "ca53618b78dc2e22303a53d5601e044818422816fba8be3797257004",
    defaultPriceTokenLabel: "HOSKY",
    accentColor: "#eab308",
    poolDoors: true,
  },
  {
    label: "Gnomeskies",
    policyId: "a4ad9795d5a07ca9df5ccdb99b011fab5a0f4563ede432c5f9c6347d",
    defaultPriceTokenLabel: "HOSKY",
    accentColor: "#a78bfa",
  },
  {
    label: "Snekkies",
    policyId: "9b7d392af9c2e262b837a5c8cb9e9b89100a4e1dc3ae872d65e798ad",
    defaultPriceTokenLabel: "SNEK",
    accentColor: "#34d399",
  },
  {
    label: "Hosky 10k",
    policyId: "55cd61386250a4a3bf73e8c39408006085614b5a211153fbc080f7ad",
    defaultPriceTokenLabel: "HOSKY",
    accentColor: "#fb923c",
  },
];

const MAINNET_COLLECTIONS: SupportedCollection[] = [
  {
    label: "HOSKY CashGrab",
    policyId: "a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559",
    defaultPriceTokenLabel: "HOSKY",
    accentColor: "#eab308",
    poolDoors: true,
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

/**
 * Returns true iff {@code c} is a whitelisted collection's policy id
 * (case-insensitive). Backs the /market route guard: a missing or
 * non-whitelisted {@code ?c} redirects to the landing instead of
 * rendering an empty/broken browse view. Mirrors the {@code
 * selectedCollection} memo in {@link MarketBrowse}.
 */
export function isValidCollectionParam(
  c: string | null | undefined,
  network: CardanoNetworkName = getNetworkName(),
): boolean {
  if (!c) return false;
  const policy = c.toLowerCase();
  return supportedCollections(network).some(
    (x) => x.policyId.toLowerCase() === policy,
  );
}
