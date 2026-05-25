/**
 * Codec for the marketplace's `MarketDatum`. Single source of truth for the
 * on-chain shape (mirrors {@code contracts/validators/marketplace.ak::MarketDatum}):
 *
 * <pre>
 *   Constr 0 [
 *     ByteArray seller_pkh,
 *     Address   seller_address,
 *     ByteArray price_policy,
 *     ByteArray price_name,
 *     Int       price_qty,
 *     Int       accompanying_lovelace,
 *   ]
 * </pre>
 *
 * <p>Address encoding reuses the same {@code addressData} / {@code decomposeAddress}
 * helpers as the wanted-listing's WantedDatum (see {@code p2p.ts}) — anywhere we
 * lock funds at a script with an inline Address field we go through that path.
 */

import { Data } from "@evolution-sdk/evolution";

import { addressData, decomposeAddress } from "./p2p";

export type Hex = string;

export type MarketDatumInput = {
  /** 28-byte hex pkh of the seller. Used for Cancel signature check. */
  sellerPkhHex: Hex;
  /** Bech32 address the Buy payment lands at. May differ from `sellerPkh`'s
   *  payment cred (e.g. seller wants to receive to a base-address with stake
   *  delegation, or to a fully separate wallet). */
  sellerBech32Address: string;
  /** Hex policy id of the price token. Empty string for ADA. */
  pricePolicyHex: Hex;
  /** Hex asset name of the price token. Empty string for ADA. */
  priceNameHex: Hex;
  /** Asking price (inclusive of the 2 % protocol fee). Must be > 0. */
  priceQty: bigint;
  /** Lovelace the seller bonds into the listing UTxO alongside the listed
   *  asset(s). Flows to the buy-side seller payout. ~1.5 ADA typical. */
  accompanyingLovelace: bigint;
};

const HEX = /^[0-9a-fA-F]*$/;

function assertHex(value: string, name: string, expectedBytes?: number): void {
  if (!HEX.test(value)) throw new Error(`${name} must be hex, got ${value}`);
  if (expectedBytes !== undefined && value.length !== expectedBytes * 2) {
    throw new Error(`${name} must be ${expectedBytes} bytes (${expectedBytes * 2} hex chars), got ${value.length}`);
  }
}

export function buildMarketDatum(input: MarketDatumInput): Data.Data {
  assertHex(input.sellerPkhHex, "sellerPkhHex", 28);
  // Policy id 0 bytes = ADA. Otherwise 28 bytes. Anything else is malformed.
  if (input.pricePolicyHex.length !== 0 && input.pricePolicyHex.length !== 56) {
    throw new Error(`pricePolicyHex must be empty or 56 hex chars, got ${input.pricePolicyHex.length}`);
  }
  assertHex(input.pricePolicyHex, "pricePolicyHex");
  assertHex(input.priceNameHex, "priceNameHex");
  if (input.priceQty <= 0n) throw new Error("priceQty must be > 0");
  if (input.accompanyingLovelace < 0n) {
    throw new Error("accompanyingLovelace must be >= 0");
  }

  const address = addressData(decomposeAddress(input.sellerBech32Address));

  return Data.constr(0n, [
    Data.bytearray(input.sellerPkhHex.toLowerCase()),
    address,
    Data.bytearray(input.pricePolicyHex.toLowerCase()),
    Data.bytearray(input.priceNameHex.toLowerCase()),
    Data.int(input.priceQty),
    Data.int(input.accompanyingLovelace),
  ]);
}

/**
 * Best-effort decode of a Plutus Data into the structured MarketDatum.
 * Returns null when the Data isn't a Constr-0 with the right arity. The
 * address is left as raw Constr — callers that need a bech32 string can
 * re-encode via the Evolution SDK's Address helpers (this codec lives on
 * both server and client, so we avoid pulling that dependency here).
 */
export type DecodedMarketDatum = {
  sellerPkhHex: Hex;
  /** Raw Constr-encoded address as it appears on chain. */
  sellerAddressRaw: Data.Data;
  pricePolicyHex: Hex;
  priceNameHex: Hex;
  priceQty: bigint;
  accompanyingLovelace: bigint;
};

export function decodeMarketDatum(data: Data.Data): DecodedMarketDatum | null {
  // Runtime shape from Evolution's Data.fromCBORHex (per swap.ts:215-236):
  //   Constr  -> object with bigint `index` + Data[] `fields`
  //   bytes   -> Uint8Array
  //   int     -> bigint
  //   list    -> Array (not used here)
  //   map     -> JS Map (not used here)
  // See Data.isConstr / Data.isList / etc. for SDK-side predicates.
  try {
    if (!Data.isConstr(data)) return null;
    const c = data as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
    if (c.index !== 0n) return null;
    if (c.fields.length !== 6) return null;
    const [pkhF, addrF, ppF, pnF, qtyF, accLovF] = c.fields;
    if (!(pkhF instanceof Uint8Array)) return null;
    if (!(ppF instanceof Uint8Array)) return null;
    if (!(pnF instanceof Uint8Array)) return null;
    if (typeof qtyF !== "bigint") return null;
    if (typeof accLovF !== "bigint") return null;
    return {
      sellerPkhHex: bytesToHex(pkhF),
      sellerAddressRaw: addrF as unknown as Data.Data,
      pricePolicyHex: bytesToHex(ppF),
      priceNameHex: bytesToHex(pnF),
      priceQty: qtyF,
      accompanyingLovelace: accLovF,
    };
  } catch {
    return null;
  }
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, "0");
  }
  return s;
}
