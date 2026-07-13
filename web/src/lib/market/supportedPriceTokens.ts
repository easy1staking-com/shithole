/**
 * Curated price-token registry for the marketplace. The /market/new
 * form picks from this list at runtime (network-keyed) so users see
 * tickers ("ADA", "HOSKY", "USDM") rather than raw policy ids.
 *
 * <p>Mainnet entries are the canonical Cardano Foundation token-registry
 * subjects:
 *   - HOSKY  → policy a0028f35…81c235 + asset name 484f534b59 ("HOSKY")
 *   - USDM   → policy c48cbb3d…2da47ad + CIP-68 user token
 *              0014df105553444d ("USDM")
 *
 * <p>Preprod entries are tokens minted via the
 * {@code preprodMintFungible} gradle task — same ticker (so wallets
 * display the right name), different one-shot policy. Mint deadline on
 * the policy doesn't matter once supply is on chain.
 *
 * <p>Adding a fourth token: append it to BOTH lists (preprod + mainnet)
 * or call out the asymmetry with a comment. The dropdown reads
 * whichever network the FE is configured for.
 */

import { getNetworkName, type CardanoNetworkName } from "@/lib/wallet/network";

export type SupportedPriceToken = {
  /** User-facing label in the dropdown. */
  label: string;
  /** Optional separate ticker (shown next to the number — falls back to label). */
  ticker?: string;
  /**
   * Full asset unit hex = policy_id_hex + asset_name_hex. Empty string for
   * pure-ADA (lovelace) — handled as a special case by the validator's
   * empty-policy / empty-name dialect.
   */
  unit: string;
  /**
   * Smallest-unit scale exponent. ADA = 6 (1 ADA = 10^6 lovelace). HOSKY
   * = 0 (no fractional). USDM = 6 (registry-declared). The /market/new
   * form multiplies the user's typed amount by 10^decimals before sending
   * the on-chain price_qty.
   */
  decimals: number;
};

const PREPROD_PRICE_TOKENS: SupportedPriceToken[] = [
  {
    label: "ADA",
    ticker: "₳",
    unit: "",
    decimals: 6,
  },
  {
    label: "HOSKY",
    ticker: "HOSKY",
    // Minted by preprodMintFungible (tx abb25319…fa2f37fd, 2026-05-25).
    unit: "4956a8205aeed1337e45b51679f7cdca1ea44d02c0e78d800acf2f1e484f534b59",
    decimals: 0,
  },
  {
    label: "USDM",
    ticker: "USDM",
    // Minted by preprodMintFungible (tx dc2deb1f…9c33cf1f, 2026-05-25).
    // Smallest-unit supply 10^15 = 1B at 6 decimals.
    unit: "1ccce842d51112e37ca436f9cedf726507d159a0b0970b6d416634065553444d",
    decimals: 6,
  },
  {
    label: "SNEK",
    ticker: "SNEK",
    // Minted by preprodMintFungible (tx 65657d1f…dee82cfee, 2026-07-13).
    // Snekkies' default pricing token. decimals 0 (matches mainnet SNEK).
    unit: "51c13093b6572b7e4e7ed3e0f6451a82b9d3a5d8dea8b831a0a55424534e454b",
    decimals: 0,
  },
];

const MAINNET_PRICE_TOKENS: SupportedPriceToken[] = [
  {
    label: "ADA",
    ticker: "₳",
    unit: "",
    decimals: 6,
  },
  {
    label: "HOSKY",
    ticker: "HOSKY",
    // Cardano Foundation registry mapping, decimals 0.
    unit: "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59",
    decimals: 0,
  },
  {
    label: "USDM",
    ticker: "USDM",
    // Cardano Foundation registry mapping. CIP-68 user-token asset name
    // 0014df10 + 5553444d ("USDM"). decimals 6.
    unit: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d",
    decimals: 6,
  },
  {
    label: "SNEK",
    ticker: "SNEK",
    // Cardano Foundation registry mapping. policy 279c909f… + 534e454b
    // ("SNEK"), decimals 0.
    unit: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
    decimals: 0,
  },
];

// Preview currently shares the preprod list — keeps the FE useful on
// any non-mainnet network without minting a fresh set.
const TOKENS_BY_NETWORK: Record<CardanoNetworkName, SupportedPriceToken[]> = {
  mainnet: MAINNET_PRICE_TOKENS,
  preprod: PREPROD_PRICE_TOKENS,
  preview: PREPROD_PRICE_TOKENS,
};

export function supportedPriceTokens(
  network: CardanoNetworkName = getNetworkName(),
): SupportedPriceToken[] {
  return TOKENS_BY_NETWORK[network] ?? PREPROD_PRICE_TOKENS;
}

/** Pull the (policy, name) split out of a price token's `unit` field. */
export function splitUnit(unit: string): { policyHex: string; nameHex: string } {
  if (unit.length === 0) return { policyHex: "", nameHex: "" };
  if (unit.length < 56) {
    throw new Error(`unit ${unit} is shorter than a policy id (56 hex)`);
  }
  return { policyHex: unit.slice(0, 56), nameHex: unit.slice(56) };
}
