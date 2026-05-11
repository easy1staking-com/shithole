use aiken/cbor.{serialise}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash, blake2b_256}
use cardano/transaction.{OutputReference, Transaction}

// ============================================================================
// Double Satisfaction Prevention
// ============================================================================

/// Compute the tag for an output: blake2b_256(cbor.serialise(output_reference)).
/// Used to bind a side-effect output (treasury payment) or a stateful continuing
/// output (recreated listing) uniquely to the input that produced it, so a single
/// output cannot satisfy multiple consumed inputs in the same transaction.
///
/// Convention shared with easy1staking-com/jpgstore-sniper.
pub fn compute_output_tag(oref: OutputReference) -> ByteArray {
  oref
    |> serialise
    |> blake2b_256
}

// ============================================================================
// Signature Checking
// ============================================================================

/// Check if a verification key hash is in the tx extra_signatories.
/// Cheap; prefer this over on-chain Ed25519 verification.
pub fn signed_by(tx: Transaction, pkh: VerificationKeyHash) -> Bool {
  list.has(tx.extra_signatories, pkh)
}
