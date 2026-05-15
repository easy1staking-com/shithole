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

import { Address, Data } from "@evolution-sdk/evolution";

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
 * <p>Created outRefs are derived from the assembled tx body — we match
 * each selected unit to the first listing-script output that carries
 * the unit with qty 1. Robust to any future SDK change that might
 * reorder outputs or insert change before user-authored outputs.
 *
 * <p>Note: Evolution's autoMinUtxo defaults to false; our 2 ADA floor
 * is comfortably above the protocol minimum for single-NFT + small
 * inline datum outputs. If we ever shrink the floor, pass
 * {@code autoMinUtxo: true} per payToAddress call or accept that
 * outputs may fail the ledger min-UTxO check at submit time.
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

  // Resolve the actual output indices from the built tx body — pair
  // each unit with the first listing-script output that carries it.
  // Robust to balancer reordering / change-output insertion.
  const txBody = (await built.toTransaction()).body;
  const claimed = new Set<number>();
  const indexByUnit = new Map<string, number>();
  for (const nft of input.nfts) {
    const unit = nft.unit.toLowerCase();
    let foundIdx = -1;
    for (let i = 0; i < txBody.outputs.length; i++) {
      if (claimed.has(i)) continue;
      const o = txBody.outputs[i];
      if (Address.toBech32(o.address) !== input.listingScriptAddress) continue;
      if (!outputCarriesUnit(o, unit)) continue;
      foundIdx = i;
      break;
    }
    if (foundIdx < 0) {
      throw new Error(
        `assembled tx does not include a listing output for ${unit}`,
      );
    }
    claimed.add(foundIdx);
    indexByUnit.set(unit, foundIdx);
  }

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  const createdOutRefs = input.nfts.map((nft) => {
    const unit = nft.unit.toLowerCase();
    return { txHash, outputIndex: indexByUnit.get(unit)!, unit };
  });

  return { txHash, createdOutRefs };
}

/**
 * Check whether a {@code TransactionOutput} carries {@code unit}
 * (policy_id_hex + asset_name_hex) with quantity 1.
 *
 * <p>Defensive against Evolution's MultiAsset map keys being typed
 * PolicyId / AssetName values rather than raw strings — use the same
 * accessor pattern as utxo.ts's flattenAssets.
 */
function outputCarriesUnit(output: unknown, unit: string): boolean {
  // Evolution's BabbageTransactionOutput exposes the value via .assets
  // (not .amount — the CDDL index is 1, but the JS field name follows
  // the UTxO class convention). Field shape per TxOut.d.ts:
  //   { _tag, address, assets: { lovelace, multiAsset?: { map } },
  //     datumOption?, scriptRef? }
  const o = output as {
    assets?: { multiAsset?: { map: Map<unknown, Map<unknown, bigint>> } };
  };
  const ma = o.assets?.multiAsset;
  if (!ma || !ma.map) return false;
  if (unit.length < 56) return false;
  const policyHex = unit.slice(0, 56).toLowerCase();
  const assetNameHex = unit.slice(56).toLowerCase();
  for (const [policy, byAsset] of ma.map.entries()) {
    if (toHex(policy) !== policyHex) continue;
    for (const [asset, qty] of byAsset.entries()) {
      if (toHex(asset) === assetNameHex && qty === 1n) return true;
    }
  }
  return false;
}

function toHex(v: unknown): string {
  if (typeof v === "string") return v.toLowerCase();
  const x = v as {
    bytes?: Uint8Array;
    hash?: Uint8Array | string;
    toHex?: () => string;
  };
  if (x.bytes instanceof Uint8Array) return bytesToHexLocal(x.bytes);
  if (x.hash instanceof Uint8Array) return bytesToHexLocal(x.hash);
  if (typeof x.hash === "string") return x.hash.toLowerCase();
  if (typeof x.toHex === "function") return x.toHex().toLowerCase();
  return "";
}

function bytesToHexLocal(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
