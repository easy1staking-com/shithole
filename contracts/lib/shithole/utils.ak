use aiken/builtin
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

// ============================================================================
// Defensive datum extraction
// ============================================================================

/// Extract the first field of a `Constr`-encoded `Data` as a `ByteArray`,
/// without requiring the rest of the datum to decode cleanly.
///
/// Used by the listing validator's `Cancel` branch so that a lister can
/// reclaim their UTxO via signature even if the datum's second field
/// (`update_ref`) is corrupt or shape-drifted between contract versions.
///
/// Recovery envelope: datum must be `Constr [bytestring, ...]`. Non-constr
/// roots (`Int`, `List`, `Map`), empty Constr field lists, or a non-bytes
/// first field will fail this extraction. Those shapes cannot arise from
/// the `Swap` path (which writes a full `ListingDatum`) nor from a
/// legitimate initial listing creation.
pub fn extract_first_bytearray_field(data: Data) -> ByteArray {
  let fields = builtin.snd_pair(builtin.un_constr_data(data))
  let first = builtin.head_list(fields)
  builtin.un_b_data(first)
}
