/**
 * UTxO adapter: a lucid-shaped facade over Evolution SDK's UTxO class.
 *
 * <p>Evolution exposes UTxOs as typed class instances with effect-schema
 * fields:
 * <pre>
 *   { transactionId: { hash }, index: bigint, address: Address,
 *     assets: { lovelace: bigint, multiAsset?: { map: Map<...> } },
 *     datumOption?: DatumHash | InlineDatum, scriptRef?: ... }
 * </pre>
 *
 * <p>Lucid Evolution used a flat object:
 * <pre>
 *   { txHash: string, outputIndex: number, address: string,
 *     assets: { [unit]: bigint }, datum?: string (inline cbor hex), ... }
 * </pre>
 *
 * <p>Rather than churn every caller (cancel.ts, list.ts, /me, /pit pages,
 * /admin), we keep the lucid shape as the canonical type for the rest
 * of the app and adapt at the boundary — every {@code findX} / {@code fetchX}
 * helper returns the adapted shape and the tx-builder calls re-pack to
 * Evolution's UTxO when needed.
 *
 * <p>The original Evolution UTxO is retained on {@code _evolution} so we
 * can hand it back to {@code newTx().collectFrom(...)} unchanged.
 */

import {
  Address,
  Assets as EvAssets,
  Data,
  InlineDatum,
  TransactionHash,
  type UTxO as EvolutionUTxO,
} from "@evolution-sdk/evolution";

/**
 * Lucid-shaped UTxO. Same logical fields lucid-evolution exposed; the
 * underlying Evolution UTxO is carried on {@code _evolution} for
 * round-tripping into tx builders.
 */
export type UTxO = {
  txHash: string;
  outputIndex: number;
  address: string;
  /** Flat map: 'lovelace' + unit_hex → bigint. */
  assets: Record<string, bigint>;
  /** Inline datum CBOR hex if present. */
  datum?: string;
  /** Underlying Evolution UTxO instance for re-injection into tx builders. */
  _evolution: EvolutionUTxO.UTxO;
};

/**
 * Adapt an Evolution UTxO instance to the lucid-shaped facade.
 *
 * <p>Reads {@code transactionId.hash}, converts the bigint {@code index}
 * to a Number (output indices are always small), bech32-encodes the
 * address, flattens the multi-asset map to a `unit → bigint` dict, and
 * extracts the inline datum CBOR hex when present.
 */
export function adaptUtxo(u: EvolutionUTxO.UTxO): UTxO {
  return {
    txHash: TransactionHash.toHex(u.transactionId),
    outputIndex: Number(u.index),
    address: Address.toBech32(u.address),
    assets: flattenAssets(u.assets),
    datum: extractInlineDatumHex(u.datumOption),
    _evolution: u,
  };
}

/**
 * Adapt an array of Evolution UTxOs in one go. Common case after
 * {@code client.getUtxos(...)} / {@code getUtxosByOutRef(...)}.
 */
export function adaptUtxos(
  utxos: ReadonlyArray<EvolutionUTxO.UTxO>,
): UTxO[] {
  return utxos.map(adaptUtxo);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function flattenAssets(assets: EvAssets.Assets): Record<string, bigint> {
  const out: Record<string, bigint> = { lovelace: assets.lovelace };
  const ma = assets.multiAsset;
  if (ma && ma.map) {
    for (const [policy, byAsset] of ma.map.entries()) {
      const policyHex = policyToHex(policy);
      for (const [asset, qty] of byAsset.entries()) {
        const assetHex = assetNameToHex(asset);
        out[policyHex + assetHex] = qty;
      }
    }
  }
  return out;
}

/**
 * Hex extraction from Evolution's PolicyId / AssetName branded types.
 * Runtime shapes observed in @evolution-sdk/evolution@0.5.8:
 *   PolicyId  → { _tag: "PolicyId",  hash:  Uint8Array }   (28 bytes)
 *   AssetName → { _tag: "AssetName", bytes: Uint8Array }   (≤ 32 bytes)
 * String + .toHex() variants are kept as fallbacks in case a future
 * SDK rev changes the shape.
 */
function policyToHex(p: unknown): string {
  return typedHex(p, "policy");
}
function assetNameToHex(a: unknown): string {
  return typedHex(a, "asset name");
}
function typedHex(v: unknown, label: string): string {
  if (typeof v === "string") return v.toLowerCase();
  const x = v as {
    bytes?: Uint8Array;
    hash?: Uint8Array | string;
    toHex?: () => string;
  };
  if (x.bytes instanceof Uint8Array) return bytesToHex(x.bytes);
  if (x.hash instanceof Uint8Array) return bytesToHex(x.hash);
  if (typeof x.hash === "string") return x.hash.toLowerCase();
  if (typeof x.toHex === "function") return x.toHex().toLowerCase();
  throw new Error(`could not extract hex from ${label}`);
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function extractInlineDatumHex(
  datumOption: EvolutionUTxO.UTxO["datumOption"],
): string | undefined {
  if (!datumOption) return undefined;
  // InlineDatum has _tag === 'InlineDatum' and a `data: Data` field.
  // DatumHash is just a 32-byte hash with no inline payload — we don't
  // surface it because the on-chain code we interact with always uses
  // inline datums.
  const tagged = datumOption as { _tag: string; data?: unknown };
  if (tagged._tag !== "InlineDatum") return undefined;
  if (tagged.data === undefined) return undefined;
  // Evolution's Data values are CBOR-encodable via Data.toCBORHex.
  return Data.toCBORHex(tagged.data as Parameters<typeof Data.toCBORHex>[0]);
}

// Keep the InlineDatum type import alive so tree-shaking doesn't strip
// the schema registration (some builds need the side-effect import).
void InlineDatum;
