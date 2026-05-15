/**
 * Bucket-equation math for the Shithole swap path. TypeScript mirror of
 * the Aiken validator's S10 invariant (SPEC §6.3 + §7) and the Java
 * PreprodSwapTool.findBucketMatch.
 *
 * The validator's bucket equation:
 *
 *   bucket_self(NA_name)              % M
 *     == bucket_target(NB_name ‖ consumed.outRef) % M
 *
 * where:
 *   - NA = the consumed listing's asset name (extracted from the input value)
 *   - NB = the swapper's deposit asset name (= successor listing's NFT name
 *          = redeemer.nb_asset_name)
 *   - consumed.outRef = OutputReference of the consumed listing UTxO
 *   - bucket_self(name)  = from_bytearray_big_endian(blake2b_256(policy ‖ name)) mod M
 *   - bucket_target(name, oref) = from_bytearray_big_endian(blake2b_256(policy ‖ name ‖ cbor.serialise(oref))) mod M
 *
 * Both side outputs are 32-byte digests interpreted as 256-bit big-endian
 * integers and reduced mod M.
 *
 * Notes:
 *   - This file is sync + pure: no React, no async, no I/O. Suitable for
 *     eager precomputation over (wallet × pool) without performance worry.
 *   - The CBOR shape for OutputReference matches Plutus Data's
 *     `Constr 0 [bytes(32), int]` encoding: tag 121 + indefinite-length
 *     array. Aiken's `cbor.serialise` produces these bytes verbatim.
 */

import { blake2b } from "@noble/hashes/blake2b";

/* -------------------------------------------------------------------------- */
/* CBOR encoding of OutputReference                                           */
/* -------------------------------------------------------------------------- */

/**
 * Plutus Data CBOR-encode a Cardano {@code OutputReference}. Format:
 *
 *   D8 79 9F                                     // tag 121 (Constr 0), indef-len list
 *     58 20 <32 bytes>                           // ByteString(32) — tx_id
 *     <int>                                      // Integer — output_index
 *   FF                                           // break (close indef list)
 */
export function serialiseOutputReference(
  txIdBytes: Uint8Array,
  outputIndex: number,
): Uint8Array {
  if (txIdBytes.length !== 32) {
    throw new Error(
      `txId must be 32 bytes, got ${txIdBytes.length}`,
    );
  }
  if (!Number.isInteger(outputIndex) || outputIndex < 0) {
    throw new Error(`outputIndex must be a non-negative integer, got ${outputIndex}`);
  }
  const intBytes = encodeCborUInt(outputIndex);
  const out = new Uint8Array(2 /* D8 79 */ + 1 /* 9F */ + 2 /* 58 20 */ + 32 + intBytes.length + 1 /* FF */);
  let p = 0;
  out[p++] = 0xd8;
  out[p++] = 0x79; // tag 121 = Constr 0
  out[p++] = 0x9f; // indef-len array start
  out[p++] = 0x58;
  out[p++] = 0x20; // ByteString length 32
  out.set(txIdBytes, p);
  p += 32;
  out.set(intBytes, p);
  p += intBytes.length;
  out[p++] = 0xff; // break
  return out;
}

/**
 * Minimal CBOR major-type-0 (unsigned int) encoder. Covers the 0..2^32-1
 * range that {@code output_index} can ever take (it's a 32-bit signed int
 * in the Postgres schema; values are realistically 0..50).
 */
function encodeCborUInt(n: number): Uint8Array {
  if (n < 0) throw new Error("negative ints not supported here");
  if (n < 24) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x18, n]);
  if (n < 0x10000) return new Uint8Array([0x19, n >> 8, n & 0xff]);
  if (n < 0x100000000) {
    const b = new Uint8Array(5);
    b[0] = 0x1a;
    b[1] = (n >> 24) & 0xff;
    b[2] = (n >> 16) & 0xff;
    b[3] = (n >> 8) & 0xff;
    b[4] = n & 0xff;
    return b;
  }
  throw new Error("output_index too large for our encoder");
}

/* -------------------------------------------------------------------------- */
/* Hex helpers                                                                */
/* -------------------------------------------------------------------------- */

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* Bucket math                                                                */
/* -------------------------------------------------------------------------- */

/** blake2b-256(policy ‖ name) mod M. */
export function bucketSelf(
  policyHex: string,
  assetNameHex: string,
  m: number,
): number {
  const concat = concat2(hexToBytes(policyHex), hexToBytes(assetNameHex));
  return reduceMod(blake2b256(concat), m);
}

/** blake2b-256(policy ‖ nb_name ‖ cbor.serialise(outref)) mod M. */
export function bucketTarget(
  policyHex: string,
  nbAssetNameHex: string,
  outrefTxHex: string,
  outrefIdx: number,
  m: number,
): number {
  const policy = hexToBytes(policyHex);
  const nbName = hexToBytes(nbAssetNameHex);
  const orefCbor = serialiseOutputReference(hexToBytes(outrefTxHex), outrefIdx);
  const concat = concat3(policy, nbName, orefCbor);
  return reduceMod(blake2b256(concat), m);
}

function blake2b256(input: Uint8Array): Uint8Array {
  return blake2b(input, { dkLen: 32 });
}

function reduceMod(digest32: Uint8Array, m: number): number {
  // Treat the 32-byte digest as a 256-bit big-endian unsigned integer,
  // reduce mod M. M is small (<= 1_000_000 per BE invariant cap), so the
  // result always fits in a JS Number.
  const big = BigInt("0x" + bytesToHex(digest32));
  return Number(big % BigInt(m));
}

function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function concat3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length);
  out.set(a, 0);
  out.set(b, a.length);
  out.set(c, a.length + b.length);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Matchability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Compute the (wallet × pool) match map.
 *
 * <p>For each wallet NFT (the candidate deposit = SPEC's NB), find any
 * listing in the pool whose consumed outref satisfies
 * bucket_self(listing.name) == bucket_target(wallet.name ‖ listing.outref).
 * Pick the FIRST such listing per wallet NFT (deterministic for a given
 * pool order — sort the pool ahead of calling for stable output across
 * renders).
 *
 * <p>Returns a Map keyed by wallet NFT unit hex; value is the matched
 * listing reference (or absent if no match).
 */
export type WalletNftRef = {
  unit: string;
  policyHex: string;
  assetNameHex: string;
};

export type PoolListingRef = {
  /** Full unit hex (policy + asset_name). */
  unit: string;
  /** Asset name hex only (without policy). */
  assetNameHex: string;
  /** outref tx hash hex. */
  txHex: string;
  /** outref output index. */
  outputIndex: number;
};

export type Match = {
  wallet: WalletNftRef;
  consumed: PoolListingRef;
  bucket: number;
};

export function computeMatches(
  wallet: WalletNftRef[],
  pool: PoolListingRef[],
  m: number,
  collectionPolicyHex: string,
): Map<string, Match> {
  const out = new Map<string, Match>();
  if (m <= 0 || wallet.length === 0 || pool.length === 0) return out;

  // Precompute bucket_self(consumed.name) for every listing — cheap to do
  // once and reuse across all wallet candidates.
  const listingBuckets: number[] = new Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    listingBuckets[i] = bucketSelf(
      collectionPolicyHex,
      pool[i].assetNameHex,
      m,
    );
  }

  for (const w of wallet) {
    for (let i = 0; i < pool.length; i++) {
      const target = bucketTarget(
        collectionPolicyHex,
        w.assetNameHex,
        pool[i].txHex,
        pool[i].outputIndex,
        m,
      );
      if (target === listingBuckets[i]) {
        out.set(w.unit, { wallet: w, consumed: pool[i], bucket: target });
        break;
      }
    }
  }
  return out;
}
