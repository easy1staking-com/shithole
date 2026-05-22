/**
 * Build + submit a "list on the marketplace" tx. Pure pay-to-script — no
 * validator attached, no redeemer. For each asset in the input we produce
 * one marketplace UTxO carrying:
 *
 * <ul>
 *   <li>the listed asset(s) (NFT qty 1, or fungible token at any qty),</li>
 *   <li>{@code accompanyingLovelace} (the seller's bond — flows to the
 *       buy-side seller payout when the price is in CNT),</li>
 *   <li>inline {@code MarketDatum} declaring the price + payout address.</li>
 * </ul>
 *
 * <p>v1 returns only the txHash — callers that need the new listing
 * outRef can re-query the marketplace address after the tx confirms.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { buildMarketDatum, type MarketDatumInput } from "./marketDatum";
import { inlineDatum, toAddress, toAssets, txHashHex } from "./txAdapters";

export type MarketListInput = {
  /** Bech32 marketplace-script address (from the deployed manifest). */
  marketplaceAddress: string;
  /** One listing per asset. */
  listings: Array<{
    /** Asset unit hex (policy + name). */
    unit: string;
    /** Quantity to lock. 1 for NFTs; arbitrary positive int for fungibles. */
    qty: bigint;
    /** Datum payload (one per listing). */
    datum: MarketDatumInput;
  }>;
};

export type MarketListResult = { txHash: string };

export async function submitMarketList(
  client: EvolutionClient,
  input: MarketListInput,
): Promise<MarketListResult> {
  if (input.listings.length === 0) {
    throw new Error("at least one listing is required");
  }
  const seen = new Set<string>();
  for (const l of input.listings) {
    const u = l.unit.toLowerCase();
    if (seen.has(u)) throw new Error(`duplicate unit: ${u}`);
    seen.add(u);
    if (l.qty <= 0n) throw new Error(`qty must be > 0 for ${u}`);
  }

  let txBuilder = client.newTx();
  for (const l of input.listings) {
    const unit = l.unit.toLowerCase();
    const datum: Data.Data = buildMarketDatum(l.datum);
    txBuilder = txBuilder.payToAddress({
      address: toAddress(input.marketplaceAddress),
      assets: toAssets({
        lovelace: l.datum.accompanyingLovelace,
        [unit]: l.qty,
      }),
      datum: inlineDatum(datum),
    });
  }

  const built = await txBuilder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
