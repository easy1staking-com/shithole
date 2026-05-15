/**
 * Lucid-shape ↔ Evolution SDK type adapters for the tx builder.
 *
 * <p>Evolution's builder is strongly typed: addresses are
 * {@code Address.Address} class instances, multi-asset values are
 * {@code Assets.Assets} class instances, datums are {@code InlineDatum}
 * or {@code DatumHash}, and redeemers are unencoded {@code Data} values
 * (not CBOR hex strings).
 *
 * <p>Lucid Evolution accepted bare strings/objects everywhere. This
 * module bridges the gap so caller code can keep its compact shape.
 */

import {
  Address,
  Assets,
  Bytes,
  Data,
  InlineDatum,
  KeyHash,
  TransactionHash,
  TransactionInput,
} from "@evolution-sdk/evolution";

/**
 * Evolution exposes Data both as a namespace (with constructors) and as
 * a type (the discriminated-union value type). Re-alias here for clarity
 * — {@code Data.Data} is the value type, {@code Data.X} are factories.
 */
type DataValue = Data.Data;

/**
 * Convert a flat lucid-style asset record ({@code {lovelace, unit_hex: qty}})
 * to a properly-typed Evolution {@code Assets.Assets} instance.
 */
export function toAssets(flat: Record<string, bigint>): Assets.Assets {
  const lovelace = flat.lovelace ?? 0n;
  let assets = Assets.fromLovelace(lovelace);
  for (const [unit, qty] of Object.entries(flat)) {
    if (unit === "lovelace") continue;
    if (qty === 0n) continue;
    if (unit.length < 56) {
      throw new Error(`unit ${unit} is shorter than a policy id (56 hex)`);
    }
    const policyHex = unit.slice(0, 56);
    const assetNameHex = unit.slice(56);
    assets = Assets.addByHex(assets, policyHex, assetNameHex, qty);
  }
  return assets;
}

/** Wrap a bech32 string as an Evolution {@code Address.Address}. */
export function toAddress(bech32: string): Address.Address {
  return Address.fromBech32(bech32);
}

/** Wrap a Plutus Data value as an inline datum option. */
export function inlineDatum(data: DataValue): InlineDatum.InlineDatum {
  return new InlineDatum.InlineDatum({ data });
}

/**
 * Parse a CBOR hex string back into a {@code Data} value.
 *
 * <p>Lucid-style code emitted CBOR hex via {@code Data.to}. Evolution
 * builders want the un-encoded Data value. This helper round-trips so
 * existing callers that constructed CBOR hex can pass it through.
 *
 * <p>Prefer building {@code Data} values directly (with
 * {@code Data.constr / bytearray / int}) when possible — it avoids the
 * encode/decode roundtrip.
 */
export function dataFromCBORHex(cborHex: string): DataValue {
  return Data.fromCBORHex(cborHex);
}

/** Wrap a 28-byte hex pkh as a typed {@code KeyHash}. */
export function toKeyHash(hex: string): KeyHash.KeyHash {
  return KeyHash.fromHex(hex);
}

/** Wrap a 32-byte hex tx hash as a typed {@code TransactionHash}. */
export function toTxHash(hex: string): TransactionHash.TransactionHash {
  return TransactionHash.fromHex(hex);
}

/** Get the hex string from a TransactionHash. */
export function txHashHex(th: TransactionHash.TransactionHash): string {
  return TransactionHash.toHex(th);
}

/** Wrap an outref ({@code txHash#index}) as a typed {@code TransactionInput}. */
export function toTxInput(txHashHex: string, outputIndex: number): TransactionInput.TransactionInput {
  return new TransactionInput.TransactionInput({
    transactionId: TransactionHash.fromHex(txHashHex),
    index: BigInt(outputIndex),
  });
}

// Keep Bytes alive — used by callers via re-export elsewhere.
void Bytes;
