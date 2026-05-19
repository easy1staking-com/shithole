/**
 * Plutus Data encoders for v3 wanted-listing datum + redeemers.
 *
 * Mirrors the on-chain Aiken types in `contracts/lib/shithole/types.ak`:
 *
 *   WantedDatum
 *     buyer_pkh: VerificationKeyHash       — Constr 0 field 0
 *     buyer_address: Address               — Constr 0 field 1
 *     accepted_merkle_root: ByteArray      — Constr 0 field 2
 *
 *   WantedRedeemer = Fulfill | Reclaim | Rescue
 *     Fulfill (Constr 0):
 *       merkle_proof: Proof<ByteArray>     — List<ProofItem>
 *       treasury_output_index: Option<Int> — Constr 0 [Int] (Some) | Constr 1 [] (None)
 *     Reclaim (Constr 1): no fields
 *     Rescue  (Constr 2): no fields — admin-only path for accidentally
 *                         pay-to-script'd no-datum UTxOs (mirrors v2
 *                         ListingRedeemer.Recover; renamed in Aiken to avoid
 *                         constructor-name collision in types.ak)
 *
 *   ProofItem<a> (from aiken_merkle_tree)
 *     Left  (Constr 0) [Root]
 *     Right (Constr 1) [Root]
 *   Root (record, single field):
 *     Constr 0 [inner: ByteArray]
 *   So a proof step ON THE WIRE is:
 *     Constr alt [Constr 0 [ByteArray]]
 *   — NOT Constr alt [ByteArray]. The contract tests didn't catch this
 *   because they generate proofs via mt.get_proof which already wraps the
 *   bytes in the Root record.
 *
 * The on-chain validator decodes these via Aiken's `expect` machinery, so
 * byte-exact correctness is load-bearing. Every public function here is
 * a pure transformation tested against fixture vectors in
 * {@code __tests__/wanted.test.ts}.
 *
 * No Evolution SDK tx-building here — that lives in higher-level modules
 * (`buildCreateWantedTx`, `buildFulfillTx`, `buildReclaimTx`) that consume
 * the {@code Data.Data} values produced here.
 */

import { Address, Data } from "@evolution-sdk/evolution";

/* -------------------------------------------------------------------------- */
/* Type aliases — TypeScript views of the wire shapes                         */
/* -------------------------------------------------------------------------- */

export type Hex = string;

/** One step of a merkle membership proof. Mirrors BE `ProofStep`. */
export type ProofItem = {
  /** Sibling's position relative to the running hash at this level. */
  side: "left" | "right";
  /** 32-byte sibling hash. */
  hashHex: Hex;
};

export type WantedDatumInput = {
  /** 28-byte buyer payment-key hash. */
  buyerPkhHex: Hex;
  /**
   * EXACT delivery address as a bech32 string. Validator does full-Address
   * equality so the buyer keeps stake-credential routing for the deposit.
   */
  buyerBech32Address: string;
  /** 32-byte sha2_256 merkle root committed to by this listing. */
  acceptedMerkleRootHex: Hex;
};

export type FulfillRedeemerInput = {
  merkleProof: ProofItem[];
  /**
   * Index into tx.outputs of the treasury payment, or null when no treasury
   * output is present (zero-fee path; validator enforces protocol_fee == 0
   * in that case).
   */
  treasuryOutputIndex: number | null;
};

/* -------------------------------------------------------------------------- */
/* Address encoding (mirrors deployConfig.ts addressData/decomposeAddress)    */
/* -------------------------------------------------------------------------- */

/**
 * Aiken Address Plutus Data:
 *   Constr 0 [payment_credential, stake_credential]
 *   payment_credential: Constr 0 [bytes] (VerificationKey) | Constr 1 [bytes] (Script)
 *   stake_credential:
 *     Some(Inline(cred)) → Constr 0 [Constr 0 [cred]]
 *     None               → Constr 1 []
 */
function addressData(parts: {
  paymentKeyHashHex: Hex;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: Hex | null;
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

/**
 * Decompose a bech32 address into the bytes + variants {@link addressData}
 * needs. Exported so tests can compose without a fully-built Evolution
 * Address.
 */
export function decomposeAddress(bech32: string): {
  paymentKeyHashHex: Hex;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: Hex | null;
  stakeCredentialType: "verification_key" | "script" | null;
} {
  const addr = Address.fromBech32(bech32) as unknown as {
    paymentCredential: { _tag: "KeyHash" | "ScriptHash"; hash: Uint8Array };
    stakingCredential?: { _tag: "KeyHash" | "ScriptHash"; hash: Uint8Array };
  };
  return {
    paymentKeyHashHex: bytesToHex(addr.paymentCredential.hash),
    paymentCredentialType:
      addr.paymentCredential._tag === "KeyHash" ? "verification_key" : "script",
    stakeCredentialHashHex: addr.stakingCredential
      ? bytesToHex(addr.stakingCredential.hash)
      : null,
    stakeCredentialType: addr.stakingCredential
      ? addr.stakingCredential._tag === "KeyHash"
        ? "verification_key"
        : "script"
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Public builders                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build the buyer's listing datum: {@code Constr 0 [pkh, address, root]}.
 *
 * <p>Address is always decoded from bech32 inside this builder — we don't
 * accept a pre-built {@code Data} for the address to keep callers honest
 * about WHAT they're committing to.
 */
export function buildWantedDatum(input: WantedDatumInput): Data.Data {
  assertHexLen(input.buyerPkhHex, 28, "buyerPkhHex");
  assertHexLen(input.acceptedMerkleRootHex, 32, "acceptedMerkleRootHex");

  const address = addressData(decomposeAddress(input.buyerBech32Address));

  return Data.constr(0n, [
    Data.bytearray(input.buyerPkhHex.toLowerCase()),
    address,
    Data.bytearray(input.acceptedMerkleRootHex.toLowerCase()),
  ]);
}

/**
 * Build the seller's Fulfill redeemer:
 *   Constr 0 [List<ProofItem>, Option<Int>]
 *
 * <p>Each {@link ProofItem} encodes to {@code Constr 0|1 [Constr 0 [bytes]]}
 * per the aiken_merkle_tree library — the bytes are wrapped in a {@code Root}
 * record (single-field record = Constr 0 with one field) before the outer
 * Left/Right constructor. The contract tests didn't catch the wrong shape
 * because they generate proofs via {@code mt.get_proof}, which already
 * produces the correct Root wrapping.
 *
 * <p>{@code treasuryOutputIndex} of {@code null} encodes as None;
 * an int encodes as Some(idx). The validator's W7/W7' branch picks the
 * right path.
 */
export function buildFulfillRedeemer(input: FulfillRedeemerInput): Data.Data {
  const proofData: Data.Data[] = input.merkleProof.map((step) => {
    assertHexLen(step.hashHex, 32, "merkleProof[].hashHex");
    const tag = step.side === "left" ? 0n : 1n;
    // Root { inner: ByteArray } — a record with one field = Constr 0 [bytes].
    const root = Data.constr(0n, [Data.bytearray(step.hashHex.toLowerCase())]);
    return Data.constr(tag, [root]);
  });
  const proofList = Data.list(proofData);

  let treasuryOption: Data.Data;
  if (input.treasuryOutputIndex === null) {
    treasuryOption = Data.constr(1n, []); // None
  } else {
    if (!Number.isInteger(input.treasuryOutputIndex) || input.treasuryOutputIndex < 0) {
      throw new Error(
        `treasuryOutputIndex must be a non-negative integer, got ${input.treasuryOutputIndex}`,
      );
    }
    treasuryOption = Data.constr(0n, [Data.int(BigInt(input.treasuryOutputIndex))]);
  }

  return Data.constr(0n, [proofList, treasuryOption]);
}

/**
 * Build the buyer's Reclaim redeemer: {@code Constr 1 []}. No data — the
 * validator authorises via {@code signed_by(buyer_pkh)} from the partial-
 * decoded datum.
 */
export function buildReclaimRedeemer(): Data.Data {
  return Data.constr(1n, []);
}

/**
 * Build the admin's Rescue redeemer: {@code Constr 2 []}. Used to spend a
 * UTxO that landed at the wanted-listing address with NO datum (someone
 * accidentally pay-to-script'd). Validator strictly requires {@code datum ==
 * None} and admin signature pulled from the config ref input.
 */
export function buildRescueRedeemer(): Data.Data {
  return Data.constr(2n, []);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function assertHexLen(hex: Hex, expectedBytes: number, field: string): void {
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`${field} is not valid hex: ${hex}`);
  }
  if (hex.length !== expectedBytes * 2) {
    throw new Error(
      `${field} expected ${expectedBytes} bytes (${expectedBytes * 2} hex chars), got ${hex.length}`,
    );
  }
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
