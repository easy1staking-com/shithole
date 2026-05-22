/**
 * FE-side listing query. Calls Blockfrost via Evolution's chain provider
 * to enumerate UTxOs at the marketplace address, then decodes each
 * inline-datum into a {@link DecodedListing}.
 *
 * <p>v1 lives entirely in the FE — no BE indexer. Polling Blockfrost is
 * fine while volume is low; once we ship a BE indexer for marketplace
 * UTxOs this module gets replaced with a {@code useListings} hook hitting
 * {@code GET /api/market/listings}.
 */

import { Address, Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "@/lib/tx/evolutionClient";
import {
  decodeMarketDatum,
  type DecodedMarketDatum,
} from "@/lib/tx/marketDatum";
import { adaptUtxos, type UTxO } from "@/lib/tx/utxo";

export type DecodedListing = {
  utxo: UTxO;
  datum: DecodedMarketDatum;
  /** Asset units carried by the listing UTxO, minus lovelace. Length 1
   *  for NFT listings; arbitrary for bulk-FT listings. */
  listedUnits: string[];
};

export async function fetchMarketListings(
  client: EvolutionClient,
  marketplaceAddress: string,
): Promise<DecodedListing[]> {
  const addr = Address.fromBech32(marketplaceAddress);
  const utxos = adaptUtxos(await client.getUtxos(addr));
  const out: DecodedListing[] = [];
  for (const utxo of utxos) {
    const datumHex = utxo.datum;
    if (!datumHex) continue;
    let parsed: Data.Data;
    try {
      parsed = Data.fromCBORHex(datumHex);
    } catch {
      continue;
    }
    const decoded = decodeMarketDatum(parsed);
    if (!decoded) continue;
    const listedUnits = Object.entries(utxo.assets)
      .filter(([u, q]) => u !== "lovelace" && q > 0n)
      .map(([u]) => u);
    if (listedUnits.length === 0) continue;
    out.push({ utxo, datum: decoded, listedUnits });
  }
  return out;
}
