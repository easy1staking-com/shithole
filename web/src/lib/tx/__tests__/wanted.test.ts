/**
 * Encoder tests for {@link buildWantedDatum}, {@link buildFulfillRedeemer},
 * and {@link buildReclaimRedeemer}.
 *
 * Tests assert on CBOR hex strings rather than Evolution's internal
 * {@code Data.Data} shape — CBOR hex is the actual on-chain interface, so
 * the test catches the only thing that matters: byte-level drift between
 * what the builder produces and what the validator expects. As a side
 * benefit, the tests survive Evolution SDK internal-rep changes.
 *
 * Each fixture builds the EXPECTED value via the same {@code Data.constr}
 * primitives the encoder uses and compares the two CBOR hexes. The encoder
 * is then exercised independently for malformed input + lowercase
 * normalization.
 */

import {
  Address,
  Bytes,
  Credential,
  Data,
} from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";

import {
  buildFulfillRedeemer,
  buildReclaimRedeemer,
  buildWantedDatum,
} from "@/lib/tx/wanted";

const BUYER_PKH = "11".repeat(28);
const BUYER_STAKE_PKH = "aa".repeat(28);
const ACCEPTED_ROOT = "33".repeat(32);
const SIBLING_A = "44".repeat(32);
const SIBLING_B = "55".repeat(32);

/* -------------------------------------------------------------------------- */
/* Address builders (test-only)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build a bech32 enterprise (no-stake) address for a given payment pkh on
 * preprod. Goes through Evolution's Address.Address constructor so the
 * test stays in sync with whatever bech32 polymorphism the SDK applies.
 */
function enterpriseAddressFor(paymentPkhHex: string): string {
  return addressBech32For(paymentPkhHex, null);
}

function baseAddressFor(paymentPkhHex: string, stakePkhHex: string): string {
  return addressBech32For(paymentPkhHex, stakePkhHex);
}

function addressBech32For(
  paymentPkhHex: string,
  stakePkhHex: string | null,
): string {
  const paymentCred = Credential.makeKeyHash(Bytes.fromHex(paymentPkhHex));
  const stakingCred = stakePkhHex
    ? Credential.makeKeyHash(Bytes.fromHex(stakePkhHex))
    : undefined;
  const a = new Address.Address({
    networkId: 0,
    paymentCredential: paymentCred,
    stakingCredential: stakingCred,
  });
  return Address.toBech32(a);
}

/* -------------------------------------------------------------------------- */
/* Expected-CBOR builders — mirror the on-chain Aiken shape                    */
/* -------------------------------------------------------------------------- */

function expectedAddressData(parts: {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
}): Data.Data {
  const paymentCred = Data.constr(
    parts.paymentCredentialType === "verification_key" ? 0n : 1n,
    [Data.bytearray(parts.paymentKeyHashHex)],
  );
  let stakeOption: Data.Data;
  if (parts.stakeCredentialHashHex && parts.stakeCredentialType) {
    const stakeInner = Data.constr(
      parts.stakeCredentialType === "verification_key" ? 0n : 1n,
      [Data.bytearray(parts.stakeCredentialHashHex)],
    );
    const inline = Data.constr(0n, [stakeInner]);
    stakeOption = Data.constr(0n, [inline]);
  } else {
    stakeOption = Data.constr(1n, []);
  }
  return Data.constr(0n, [paymentCred, stakeOption]);
}

function asHex(d: Data.Data): string {
  return Data.toCBORHex(d);
}

/* ============================================================ */
/* WantedDatum                                                  */
/* ============================================================ */

describe("buildWantedDatum", () => {
  it("encodes an enterprise (no-stake) buyer address", () => {
    const bech32 = enterpriseAddressFor(BUYER_PKH);
    const actual = buildWantedDatum({
      buyerPkhHex: BUYER_PKH,
      buyerBech32Address: bech32,
      acceptedMerkleRootHex: ACCEPTED_ROOT,
    });
    const expected = Data.constr(0n, [
      Data.bytearray(BUYER_PKH),
      expectedAddressData({
        paymentKeyHashHex: BUYER_PKH,
        paymentCredentialType: "verification_key",
        stakeCredentialHashHex: null,
        stakeCredentialType: null,
      }),
      Data.bytearray(ACCEPTED_ROOT),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("encodes a base (with-stake) buyer address", () => {
    const bech32 = baseAddressFor(BUYER_PKH, BUYER_STAKE_PKH);
    const actual = buildWantedDatum({
      buyerPkhHex: BUYER_PKH,
      buyerBech32Address: bech32,
      acceptedMerkleRootHex: ACCEPTED_ROOT,
    });
    const expected = Data.constr(0n, [
      Data.bytearray(BUYER_PKH),
      expectedAddressData({
        paymentKeyHashHex: BUYER_PKH,
        paymentCredentialType: "verification_key",
        stakeCredentialHashHex: BUYER_STAKE_PKH,
        stakeCredentialType: "verification_key",
      }),
      Data.bytearray(ACCEPTED_ROOT),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("CBOR-roundtrips losslessly", () => {
    const datum = buildWantedDatum({
      buyerPkhHex: BUYER_PKH,
      buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
      acceptedMerkleRootHex: ACCEPTED_ROOT,
    });
    const hex = Data.toCBORHex(datum);
    const decoded = Data.fromCBORHex(hex);
    expect(Data.toCBORHex(decoded)).toBe(hex);
  });

  it("lowercases hex inputs", () => {
    const upperHex = Data.toCBORHex(
      buildWantedDatum({
        buyerPkhHex: BUYER_PKH.toUpperCase(),
        buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
        acceptedMerkleRootHex: ACCEPTED_ROOT.toUpperCase(),
      }),
    );
    const lowerHex = Data.toCBORHex(
      buildWantedDatum({
        buyerPkhHex: BUYER_PKH,
        buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
        acceptedMerkleRootHex: ACCEPTED_ROOT,
      }),
    );
    expect(upperHex).toBe(lowerHex);
  });

  it("rejects malformed pkh length", () => {
    expect(() =>
      buildWantedDatum({
        buyerPkhHex: "aa".repeat(27),
        buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
        acceptedMerkleRootHex: ACCEPTED_ROOT,
      }),
    ).toThrow(/buyerPkhHex expected 28 bytes/);
  });

  it("rejects malformed merkle root length", () => {
    expect(() =>
      buildWantedDatum({
        buyerPkhHex: BUYER_PKH,
        buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
        acceptedMerkleRootHex: "ff".repeat(31),
      }),
    ).toThrow(/acceptedMerkleRootHex expected 32 bytes/);
  });

  it("rejects non-hex pkh", () => {
    expect(() =>
      buildWantedDatum({
        buyerPkhHex: "z".repeat(56),
        buyerBech32Address: enterpriseAddressFor(BUYER_PKH),
        acceptedMerkleRootHex: ACCEPTED_ROOT,
      }),
    ).toThrow(/is not valid hex/);
  });
});

/* ============================================================ */
/* Fulfill redeemer                                             */
/* ============================================================ */

describe("buildFulfillRedeemer", () => {
  it("encodes Some(treasury_output_index) and a Left proof step", () => {
    const actual = buildFulfillRedeemer({
      merkleProof: [{ side: "left", hashHex: SIBLING_A }],
      treasuryOutputIndex: 1,
    });
    const expected = Data.constr(0n, [
      Data.list([Data.constr(0n, [Data.bytearray(SIBLING_A)])]),
      Data.constr(0n, [Data.int(1n)]),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("encodes None treasury_output_index and a Right proof step", () => {
    const actual = buildFulfillRedeemer({
      merkleProof: [{ side: "right", hashHex: SIBLING_A }],
      treasuryOutputIndex: null,
    });
    const expected = Data.constr(0n, [
      Data.list([Data.constr(1n, [Data.bytearray(SIBLING_A)])]),
      Data.constr(1n, []),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("encodes a mixed multi-step proof preserving order", () => {
    const actual = buildFulfillRedeemer({
      merkleProof: [
        { side: "right", hashHex: SIBLING_A },
        { side: "left", hashHex: SIBLING_B },
      ],
      treasuryOutputIndex: 0,
    });
    const expected = Data.constr(0n, [
      Data.list([
        Data.constr(1n, [Data.bytearray(SIBLING_A)]),
        Data.constr(0n, [Data.bytearray(SIBLING_B)]),
      ]),
      Data.constr(0n, [Data.int(0n)]),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("encodes an empty proof list (single-leaf tree)", () => {
    const actual = buildFulfillRedeemer({
      merkleProof: [],
      treasuryOutputIndex: 1,
    });
    const expected = Data.constr(0n, [
      Data.list([]),
      Data.constr(0n, [Data.int(1n)]),
    ]);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("CBOR-roundtrips losslessly", () => {
    const redeemer = buildFulfillRedeemer({
      merkleProof: [
        { side: "left", hashHex: SIBLING_A },
        { side: "right", hashHex: SIBLING_B },
      ],
      treasuryOutputIndex: 2,
    });
    const hex = Data.toCBORHex(redeemer);
    const decoded = Data.fromCBORHex(hex);
    expect(Data.toCBORHex(decoded)).toBe(hex);
  });

  it("rejects malformed proof item hash", () => {
    expect(() =>
      buildFulfillRedeemer({
        merkleProof: [{ side: "left", hashHex: "aa".repeat(31) }],
        treasuryOutputIndex: 0,
      }),
    ).toThrow(/merkleProof\[\]\.hashHex expected 32 bytes/);
  });

  it("rejects negative treasury_output_index", () => {
    expect(() =>
      buildFulfillRedeemer({
        merkleProof: [],
        treasuryOutputIndex: -1,
      }),
    ).toThrow(/treasuryOutputIndex must be a non-negative integer/);
  });

  it("rejects fractional treasury_output_index", () => {
    expect(() =>
      buildFulfillRedeemer({
        merkleProof: [],
        treasuryOutputIndex: 0.5,
      }),
    ).toThrow(/treasuryOutputIndex must be a non-negative integer/);
  });
});

/* ============================================================ */
/* Reclaim redeemer                                             */
/* ============================================================ */

describe("buildReclaimRedeemer", () => {
  it("is equivalent to Constr 1 []", () => {
    const actual = buildReclaimRedeemer();
    const expected = Data.constr(1n, []);
    expect(asHex(actual)).toBe(asHex(expected));
  });

  it("produces stable CBOR (regression anchor)", () => {
    // Constr alt=1 with 0 fields ⇒ CBOR tag 122 + empty array ⇒ d87a80.
    expect(Data.toCBORHex(buildReclaimRedeemer())).toBe("d87a80");
  });
});
