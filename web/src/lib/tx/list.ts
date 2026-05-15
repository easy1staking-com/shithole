/**
 * Build + submit a batch listing tx (SPEC §5.2). TypeScript port of
 * {@code api/.../tools/preprod/ListNftTool.java}, generalized to multi-NFT
 * batching.
 *
 * <p>For each selected NFT, the tx produces one pay-to-script output at
 * the listing-script address carrying:
 * <ul>
 *   <li>the NFT itself (qty 1),</li>
 *   <li>min-ADA lovelace (Evolution's auto-min-ada balancer bumps if
 *       needed; we send a conservative {@code DEFAULT_LISTING_LOVELACE}),</li>
 *   <li>inline {@code ListingDatum = Constr 0 [bytes(lister_pkh), Constr 1 []]}
 *       — {@code update_ref = None} on genesis (S6 bumps it on swap).</li>
 * </ul>
 *
 * <p>The tx is unsigned-script (paying TO the script, not spending FROM
 * it). No redeemer, no validator attached.
 *
 * <p>Migrated from @lucid-evolution/lucid to @evolution-sdk/evolution.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import {
  inlineDatum,
  toAddress,
  toAssets,
  txHashHex,
} from "./txAdapters";

/**
 * Lovelace floor for a fresh listing UTxO. Single-NFT + small inline
 * datum on a Babbage-era output bottoms out around 1.3 ADA; 2 ADA
 * leaves headroom (the balancer bumps if needed, never trims).
 *
 * <p>Exported so the cancel-and-relist builder reuses the same floor
 * — keeps the relisted UTxO indistinguishable from a fresh listing.
 */
export const DEFAULT_LISTING_LOVELACE = 2_000_000n;

export type ListingNftRef = {
  /** Full unit hex (policy + asset_name). */
  unit: string;
};

export type BuildListInput = {
  /** Bech32 listing-script address (from the collection's config). */
  listingScriptAddress: string;
  /** 28-byte hex pkh of the connected wallet — written into every datum. */
  listerPkhHex: string;
  /** One or more NFTs to list. Each → one listing UTxO. */
  nfts: ListingNftRef[];
};

export type ListResult = {
  txHash: string;
  /** Listings created: outRef per NFT, in declaration order (output_index = i). */
  createdOutRefs: { txHash: string; outputIndex: number; unit: string }[];
};

/* -------------------------------------------------------------------------- */
/* Datum builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Genesis listing datum: {@code Constr 0 [bytes(lister_pkh), Constr 1 []]}.
 * Aiken's {@code Option<ByteArray>::None} encodes as Constr 1 with no fields.
 */
export function buildGenesisListingDatum(listerPkhHex: string): Data.Data {
  if (!/^[0-9a-fA-F]{56}$/.test(listerPkhHex)) {
    throw new Error("listerPkh must be 56 hex chars (28 bytes)");
  }
  return Data.constr(0n, [
    Data.bytearray(listerPkhHex.toLowerCase()),
    Data.constr(1n, []),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build, sign, and submit the batch listing tx.
 *
 * <p>Output indices are assigned 0..N-1 in declaration order. Evolution
 * preserves the order across its builder; if you suspect a future SDK
 * change might reorder, add a post-build matcher that pairs each unit
 * with the first matching listing-script output. Previous lucid-based
 * implementation did that via CML; with Evolution-only inputs it's
 * deferred until needed.
 */
export async function submitList(
  client: EvolutionClient,
  input: BuildListInput,
): Promise<ListResult> {
  if (input.nfts.length === 0) {
    throw new Error("at least one NFT must be selected");
  }
  // Dedup defensively — Cardano's 1-per-policy means the same unit can
  // never legitimately appear twice in a wallet, but a UI bug could try.
  const seen = new Set<string>();
  for (const n of input.nfts) {
    const u = n.unit.toLowerCase();
    if (seen.has(u)) {
      throw new Error(`duplicate unit in selection: ${u}`);
    }
    seen.add(u);
  }

  const datum = buildGenesisListingDatum(input.listerPkhHex);

  let txBuilder = client.newTx();
  for (const nft of input.nfts) {
    const unit = nft.unit.toLowerCase();
    txBuilder = txBuilder.payToAddress({
      address: toAddress(input.listingScriptAddress),
      assets: toAssets({ lovelace: DEFAULT_LISTING_LOVELACE, [unit]: 1n }),
      datum: inlineDatum(datum),
    });
  }

  const built = await txBuilder.build();
  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  // Declaration-order outputs: i-th payToAddress → output index i.
  const createdOutRefs = input.nfts.map((nft, i) => ({
    txHash,
    outputIndex: i,
    unit: nft.unit.toLowerCase(),
  }));

  return { txHash, createdOutRefs };
}
