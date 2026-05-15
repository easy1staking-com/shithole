/**
 * Golden-master parity tests between the OLD tx-building library
 * (@lucid-evolution/lucid, Anastasia Labs, pre-WASM-on-eval) and the NEW
 * one (@evolution-sdk/evolution, no-witness-labs, pure TS).
 *
 * <p><b>Prerequisite (transient):</b> the libsodium-wrappers-sumo@0.7.16
 * shipped with both SDKs has a broken ESM relative import. Before running
 * this test locally, create the symlink that resolves it:
 * <pre>
 *   ln -sf ../../../libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs \
 *     web/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs
 * </pre>
 * The fix has to be reapplied after every {@code npm install}. Once the
 * migration is done and we delete @lucid-evolution, the symlink is no
 * longer needed.
 *
 * <p>Migration cannot land safely unless these byte-identity assertions
 * pass — the existing preprod-registered listings store a
 * {@code listing_script_address} derived from the OLD library's
 * {@code applyParamsToScript} output, and any deployed config UTxO
 * holds CBOR produced by the OLD library's {@code Data.to}. If the NEW
 * library disagrees on either, swapping it in mid-flight bricks the
 * live deployment.
 *
 * <p>What each test pins down:
 * <ol>
 *   <li><b>UPLC apply parity</b> — same compiled listing.spend code +
 *       same 28-byte config_nft_policy param produces the same applied
 *       script bytes (and therefore the same script hash + bech32
 *       enterprise address).</li>
 *   <li><b>Plutus Data CBOR parity</b> — every shape we encode on the
 *       wire today: config datum, genesis listing datum, swap-successor
 *       listing datum, swap redeemer, cancel redeemer, treasury inline
 *       (bare bytes), OutputReference.</li>
 *   <li><b>Datum decode parity</b> — given a known listing datum hex,
 *       both libraries extract the same lister pkh.</li>
 *   <li><b>Bucket-math seed parity</b> — OutputReference CBOR encoded
 *       by Evolution matches our hand-rolled
 *       {@code serialiseOutputReference} in bucketMath.ts so the
 *       bucket equation stays byte-identical (this is what the
 *       on-chain validator hashes).</li>
 * </ol>
 *
 * <p>When all green: delete this file and rip out the lucid-evolution
 * dep in the migration PR.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// OLD lib
import {
  Constr as OldConstr,
  Data as OldData,
  applyParamsToScript as oldApplyParams,
  credentialToAddress as oldCredentialToAddress,
  mintingPolicyToId as oldMintingPolicyToId,
  scriptHashToCredential as oldScriptHashToCredential,
} from "@lucid-evolution/lucid";

// NEW lib (namespace imports — Evolution SDK is heavily modular)
import * as Evolution from "@evolution-sdk/evolution";

// Local: our hand-rolled CBOR-for-OutputReference is the canonical
// reference the on-chain validator hashes against.
import { serialiseOutputReference } from "@/lib/pit/bucketMath";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

// The real listing.spend compiled code from contracts/plutus.json.
// We bypass plutusBlueprint.ts (which is browser-only fetch-based) and
// read the file directly under vitest's node env.
function readListingSpendCompiled(): string {
  const repoRoot = path.resolve(__dirname, "../../../../../..");
  const candidates = [
    path.join(repoRoot, "contracts/plutus.json"),
    path.resolve(__dirname, "../../../../public/contracts/plutus.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const bp = JSON.parse(fs.readFileSync(c, "utf8")) as {
        validators: Array<{ title: string; compiledCode: string }>;
      };
      const v = bp.validators.find((x) => x.title === "listing.listing.spend");
      if (!v) throw new Error("listing.listing.spend missing in blueprint");
      return v.compiledCode;
    }
  }
  throw new Error(`plutus.json not found in candidates: ${candidates.join(", ")}`);
}

const LISTING_SPEND_COMPILED = readListingSpendCompiled();

// A real preprod config NFT policy id (28 bytes / 56 hex). Borrowed from
// the /pit/hosky preprod registration so the test is grounded in a
// value the system already saw.
const CONFIG_NFT_POLICY_HEX =
  "669f94f66646769eb821386b608905a3960758f908f4da5506eb3f1d";

// A 28-byte lister pkh (pulled from the live BE — the user's preprod
// admin pkh). Public on-chain data; not a secret.
const LISTER_PKH_HEX =
  "dfc194b57dcb52cbdc6774f2050d471fa237ed43f24232aabf11f9ea";

// A representative OutputReference (tx hash + output index) for
// compute_output_tag testing.
const OREF_TX_HEX =
  "5fcf521d7493466e2129c4760ecfea33409033f4a407c54de482fe46814e8ec2";
const OREF_INDEX = 0;

// A representative NB asset name (the deposit NFT name) — 14 bytes.
const NB_ASSET_NAME_HEX = "46616b65486f736b794844303031"; // "FakeHoskyHD001"

/* -------------------------------------------------------------------------- */
/* 1. UPLC applyParamsToScript parity                                          */
/* -------------------------------------------------------------------------- */

describe("UPLC.applyParamsToScript parity", () => {
  it("byte-identical applied script for the listing validator", () => {
    // OLD: applyParamsToScript(code, [hexString]) — string is interpreted as ByteArray.
    const oldApplied = oldApplyParams(LISTING_SPEND_COMPILED, [
      CONFIG_NFT_POLICY_HEX,
    ]);

    // NEW: UPLC.applyParamsToScript(code, [Data.bytearray(hex)])
    const newApplied = Evolution.UPLC.applyParamsToScript(
      LISTING_SPEND_COMPILED,
      [Evolution.Data.bytearray(CONFIG_NFT_POLICY_HEX)],
    );

    expect(newApplied).toBe(oldApplied);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Plutus Data CBOR parity                                                 */
/* -------------------------------------------------------------------------- */

describe("Plutus Data CBOR parity", () => {
  it("bare ByteString (treasury output_tag style)", () => {
    const tag = "a".repeat(64); // 32 bytes
    const oldHex = OldData.to(tag); // string → ByteArray
    const newHex = Evolution.Data.toCBORHex(Evolution.Data.bytearray(tag));
    expect(newHex).toBe(oldHex);
  });

  it("ListingDatum.None — Constr 0 [bytes, Constr 1 []]", () => {
    // Genesis listing datum.
    const oldHex = OldData.to(
      new OldConstr(0, [LISTER_PKH_HEX, new OldConstr(1, [])]),
    );
    const newHex = Evolution.Data.toCBORHex(
      Evolution.Data.constr(0n, [
        Evolution.Data.bytearray(LISTER_PKH_HEX),
        Evolution.Data.constr(1n, []),
      ]),
    );
    expect(newHex).toBe(oldHex);
  });

  it("ListingDatum.Some — Constr 0 [bytes, Constr 0 [bytes(output_tag)]]", () => {
    const outputTag = "b".repeat(64);
    const oldHex = OldData.to(
      new OldConstr(0, [LISTER_PKH_HEX, new OldConstr(0, [outputTag])]),
    );
    const newHex = Evolution.Data.toCBORHex(
      Evolution.Data.constr(0n, [
        Evolution.Data.bytearray(LISTER_PKH_HEX),
        Evolution.Data.constr(0n, [Evolution.Data.bytearray(outputTag)]),
      ]),
    );
    expect(newHex).toBe(oldHex);
  });

  it("Swap redeemer — Constr 0 [bytes(nb_name), int(0), int(1)]", () => {
    const oldHex = OldData.to(
      new OldConstr(0, [NB_ASSET_NAME_HEX, 0n, 1n]),
    );
    const newHex = Evolution.Data.toCBORHex(
      Evolution.Data.constr(0n, [
        Evolution.Data.bytearray(NB_ASSET_NAME_HEX),
        Evolution.Data.int(0n),
        Evolution.Data.int(1n),
      ]),
    );
    expect(newHex).toBe(oldHex);
  });

  it("Cancel redeemer — Constr 1 []", () => {
    const oldHex = OldData.to(new OldConstr(1, []));
    const newHex = Evolution.Data.toCBORHex(Evolution.Data.constr(1n, []));
    expect(newHex).toBe(oldHex);
  });

  it("OutputReference — Constr 0 [bytes(tx_id), int(output_index)]", () => {
    const oldHex = OldData.to(
      new OldConstr(0, [OREF_TX_HEX, BigInt(OREF_INDEX)]),
    );
    const newHex = Evolution.Data.toCBORHex(
      Evolution.Data.constr(0n, [
        Evolution.Data.bytearray(OREF_TX_HEX),
        Evolution.Data.int(BigInt(OREF_INDEX)),
      ]),
    );
    expect(newHex).toBe(oldHex);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Datum decode parity                                                     */
/* -------------------------------------------------------------------------- */

describe("Plutus Data decode parity", () => {
  it("both libs extract the same lister_pkh from a known listing datum", () => {
    // Build a known datum with the OLD lib, then decode with both.
    const datumHex = OldData.to(
      new OldConstr(0, [LISTER_PKH_HEX, new OldConstr(1, [])]),
    );

    const oldDecoded = OldData.from(datumHex);
    expect(oldDecoded).toBeInstanceOf(OldConstr);
    const oldConstr = oldDecoded as OldConstr<unknown>;
    expect(oldConstr.index).toBe(0);
    const oldLister = oldConstr.fields[0] as string;
    expect(oldLister).toBe(LISTER_PKH_HEX);

    const newDecoded = Evolution.Data.fromCBORHex(datumHex);
    // Evolution decodes to a plain object — check shape.
    expect(Evolution.Data.isConstr(newDecoded)).toBe(true);
    // The Constr from Data.fromCBORHex has .index (bigint) + .fields.
    // Cast via `unknown` because Data is a discriminated union; the
    // isConstr predicate above confirmed the branch at runtime.
    const newConstr = newDecoded as unknown as {
      index: bigint;
      fields: unknown[];
    };
    expect(newConstr.index).toBe(0n);
    const newLister = newConstr.fields[0] as Uint8Array | string;
    const newListerHex =
      typeof newLister === "string"
        ? newLister
        : bytesToHex(newLister);
    expect(newListerHex).toBe(LISTER_PKH_HEX);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Bucket-math OutputReference CBOR parity                                 */
/* -------------------------------------------------------------------------- */

describe("OutputReference CBOR shape (vs hand-rolled in bucketMath.ts)", () => {
  it("hand-rolled bucketMath matches OLD lib", () => {
    const handRolled = serialiseOutputReference(hexToBytes(OREF_TX_HEX), OREF_INDEX);
    const oldHex = OldData.to(
      new OldConstr(0, [OREF_TX_HEX, BigInt(OREF_INDEX)]),
    );
    expect(bytesToHex(handRolled)).toBe(oldHex);
  });

  it("hand-rolled bucketMath matches NEW lib (Evolution)", () => {
    const handRolled = serialiseOutputReference(hexToBytes(OREF_TX_HEX), OREF_INDEX);
    const newHex = Evolution.Data.toCBORHex(
      Evolution.Data.constr(0n, [
        Evolution.Data.bytearray(OREF_TX_HEX),
        Evolution.Data.int(BigInt(OREF_INDEX)),
      ]),
    );
    expect(bytesToHex(handRolled)).toBe(newHex);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Script-hash + address derivation parity                                  */
/* -------------------------------------------------------------------------- */

describe("Script-hash + bech32 address parity", () => {
  // Helper: derive (hash hex, bech32) from a double-CBOR-encoded applied
  // script (the form Aiken emits + Lucid produces) via Evolution SDK.
  //
  // **Critical convention difference**: Lucid's `mintingPolicyToId({type:
  // "PlutusV3", script: doubleCborHex})` accepts the double-CBOR form
  // and strips one wrapper internally before hashing. Evolution's
  // `new PlutusV3({bytes})` expects the bytes ALREADY single-CBOR
  // wrapped (i.e. one byte-string wrapper stripped). Without the strip,
  // Evolution wraps once more during hashing → different hash, different
  // address, broken deployment.
  //
  // For Aiken-emitted compiledCode the outer wrapper is always 3 bytes
  // (major type 2 + uint16 length), so `applied.slice(6)` in hex works.
  // For smaller scripts (<256 bytes) the header is 2 bytes; we don't ship
  // those.
  function stripOneCborWrapper(hex: string): string {
    return hex.slice(6);
  }

  function evolutionScriptHashAndAddress(
    appliedDoubleCborHex: string,
    networkId: 0 | 1,
  ): { hashHex: string; bech32: string } {
    const innerHex = stripOneCborWrapper(appliedDoubleCborHex);
    const innerBytes = Evolution.Bytes.fromHex(innerHex);
    const script = new Evolution.PlutusV3.PlutusV3({ bytes: innerBytes });
    const scriptHash = Evolution.ScriptHash.fromScript(script);
    const cred = Evolution.Credential.makeScriptHash(
      Evolution.ScriptHash.toBytes(scriptHash),
    );
    const addr = new Evolution.Address.Address({
      networkId,
      paymentCredential: cred,
    });
    return {
      hashHex: Evolution.ScriptHash.toHex(scriptHash),
      bech32: Evolution.Address.toBech32(addr),
    };
  }

  it("applied script hash matches between libs", () => {
    const oldApplied = oldApplyParams(LISTING_SPEND_COMPILED, [
      CONFIG_NFT_POLICY_HEX,
    ]);
    const oldHash = oldMintingPolicyToId({
      type: "PlutusV3",
      script: oldApplied,
    });

    const newApplied = Evolution.UPLC.applyParamsToScript(
      LISTING_SPEND_COMPILED,
      [Evolution.Data.bytearray(CONFIG_NFT_POLICY_HEX)],
    );
    const { hashHex: newHash } = evolutionScriptHashAndAddress(newApplied, 0);
    expect(newHash).toBe(oldHash);
  });

  it("bech32 enterprise address matches between libs (preprod)", () => {
    const oldApplied = oldApplyParams(LISTING_SPEND_COMPILED, [
      CONFIG_NFT_POLICY_HEX,
    ]);
    const oldHash = oldMintingPolicyToId({
      type: "PlutusV3",
      script: oldApplied,
    });
    const oldBech32 = oldCredentialToAddress(
      "Preprod",
      oldScriptHashToCredential(oldHash),
    );

    const newApplied = Evolution.UPLC.applyParamsToScript(
      LISTING_SPEND_COMPILED,
      [Evolution.Data.bytearray(CONFIG_NFT_POLICY_HEX)],
    );
    const { bech32: newBech32 } = evolutionScriptHashAndAddress(newApplied, 0);
    expect(newBech32).toBe(oldBech32);
  });
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
