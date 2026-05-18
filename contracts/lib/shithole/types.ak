use aiken/crypto.{VerificationKeyHash}
use aiken_merkle_tree/mt.{Proof}
use cardano/address.{Address}

// ============================================================================
// Protocol-level constants
// ============================================================================

/// Hardcoded floor on the per-collection lister_fee.
///
/// The config validator enforces `lister_fee >= MIN_LISTER_FEE` on every
/// admin update, giving listers a compile-time guarantee that the admin can
/// never strip their incentive to zero. 1 ADA = 1_000_000 lovelace.
pub const min_lister_fee: Int = 1_000_000

/// Hardcoded floor on the lovelace a buyer must lock in a wanted-listing
/// UTxO, ON TOP of `cfg.protocol_fee`. The wanted_listing validator enforces
/// `own_input.lovelace >= cfg.protocol_fee + min_seller_compensation` on the
/// Fulfill path so a seller can plausibly cover the buyer-bound output's
/// min_utxo (~1.5 ADA for an NFT + inline datum) plus the Cardano tx fee
/// (~0.3-0.5 ADA) from the listing alone. Any lovelace ABOVE this floor is
/// the seller's fulfillment tip.
///
/// 2 ADA is a starting point chosen for preprod testing. It is INTENTIONALLY
/// tight — once we have real fulfill-tx fee measurements and a confirmed
/// buyer_output min_utxo (which depends on min-UTxO-per-byte at submission
/// time + the exact Address shape), refine this constant. Better safe is
/// 2.5 ADA if measurements show the floor is too aggressive.
///
/// Protocol-level constant (not a per-collection config knob) so an admin
/// can't strip the seller's break-even floor.
pub const min_seller_compensation: Int = 2_000_000

// ============================================================================
// Config UTxO (mint handler creates it; spend handler updates it)
// ============================================================================

/// Per-collection configuration.
///
/// `collection_policy_id` is NOT a datum field — it lives as the config NFT's
/// asset name (28 bytes, enforced at mint). Once minted it is immutable.
///
/// `treasury_addr` should always be a base/payment-key address in practice
/// (wallet, possibly HW). Script credentials are technically allowed but the
/// script must accept payments with our tagged inline datum and not require
/// any other signatures or datum fields — see SPEC §3.1 note.
pub type ConfigDatum {
  m: Int,
  protocol_fee: Int,
  lister_fee: Int,
  treasury_addr: Address,
  admin_pkh: VerificationKeyHash,
}

/// On-chain validation of `ConfigDatum` invariants. Used by both mint (M4)
/// and spend (C3-C5) handlers — same bounds enforced everywhere.
pub fn is_valid_config_datum(datum: ConfigDatum) -> Bool {
  and {
    datum.m >= 1,
    datum.protocol_fee >= 0,
    datum.lister_fee >= min_lister_fee,
  }
}

// ============================================================================
// Listing UTxO (held at parameterized spend-script address)
// ============================================================================

/// Per-NFT listing slot. The NFT inside the UTxO changes per swap; the
/// `lister_pkh` is fixed at initial creation and never changes.
///
/// `update_ref` is the double-satisfaction binding for the listing-recreation
/// path. On initial pay-to-script creation it is `None` and never validated.
/// On every swap, the new listing output must carry
/// `Some(compute_output_tag(consumed.outRef))`. This forces each consumed
/// listing input to demand a uniquely-bound successor output.
pub type ListingDatum {
  lister_pkh: VerificationKeyHash,
  update_ref: Option<ByteArray>,
}

// ============================================================================
// Listing redeemer
// ============================================================================

/// Swap carries `nb_asset_name` (the NFT the swapper is depositing) and two
/// output-index hints for O(1) lookup. NA's asset_name is read from the
/// consumed listing's input value — not provided in the redeemer.
///
/// The seed for the bucket equation is anchored to `own_ref` (the consumed
/// listing's outRef), not to a swapper-controlled input. This makes the swap
/// outcome a deterministic function of (consumed listing, deposited NFT)
/// pairs — the swapper has no per-attempt manipulation axis. For dead
/// collections this is the desired property.
///
/// Recover is an admin-only rescue path for UTxOs that landed at the listing
/// address with NO datum (e.g. someone pay-to-script'd by accident). Datum
/// is required to be `None` — admin has no power over any datum-bearing UTxO.
/// Validator pulls `admin_pkh` from the per-collection config (read as ref
/// input, same lookup pattern as Swap).
pub type ListingRedeemer {
  Swap {
    nb_asset_name: ByteArray,
    listing_output_index: Int,
    // None ⇒ no treasury output supplied; the validator then requires
    // cfg.protocol_fee == 0 (S9' in listing.ak). Some(idx) ⇒ index into
    // tx.outputs of the protocol-fee payment, checked by S7/S8/S9.
    treasury_output_index: Option<Int>,
  }
  Cancel
  Recover
}

// ============================================================================
// Wanted-listing UTxO (held at parameterized spend-script address, v3)
// ============================================================================

/// A buyer's open offer for a trait-conditioned swap.
///
/// The buyer locks ONE NFT (their unwanted "offered" NFT) plus bounty ADA at
/// the wanted-listing script address. They commit to accept any
/// NFT-of-the-same-collection whose asset_name is provable in
/// `accepted_merkle_root`. Sellers fulfill alone (no buyer signature at
/// fulfill time) by providing a deposit input + merkle proof in the redeemer.
///
/// Unlike v2 swap-pool listings, wanted-listings DO NOT replant on fulfill —
/// they dissolve. The deposited NFT flows to `buyer_address`, the offered
/// NFT + bounty flow to the seller (minus protocol fee). Because the datum
/// is never mutated, there's no `update_ref` slot; anti-double-sat binding
/// lives on the buyer-output instead
/// (`buyer_output.datum == InlineDatum(compute_output_tag(own_ref))`,
/// enforced by the validator).
pub type WantedDatum {
  /// Reclaim-key holder. Whoever can sign with this pkh can pull the
  /// offered NFT + bounty back via the Reclaim redeemer. Kept as the
  /// first field so we can defensively extract it via partial decode
  /// (same pattern v2 listing.ak uses for Cancel).
  ///
  /// Deliberately INDEPENDENT of `buyer_address.payment_credential` so a
  /// buyer can fulfill into a cold/HW wallet while keeping Reclaim
  /// authority on a hot wallet — or gift the deposit to a different
  /// recipient without giving them reclaim rights.
  buyer_pkh: VerificationKeyHash,
  /// EXACT destination address for the deposited NFT. Validator enforces
  /// full Address equality (payment + stake credentials), so buyers using
  /// a base address tied to a specific stake credential get the NFT into
  /// the wallet that's actually delegating to the bonus-trait stake pool.
  buyer_address: Address,
  accepted_merkle_root: ByteArray,
}

/// Redeemer for the wanted-listing validator.
///
/// `Fulfill` is the happy path: seller deposits a trait-matching NFT and
/// receives the offered NFT + bounty.
///
/// `Reclaim` lets the buyer pull their offered NFT + bounty back out of
/// the listing. Authorized by `signed_by(buyer_pkh)`.
pub type WantedRedeemer {
  Fulfill {
    /// Merkle membership proof of the deposited NFT's `asset_name` against
    /// `WantedDatum.accepted_merkle_root`. Built off-chain via the
    /// `aiken_merkle_tree/mt` library's `get_proof`; verified on-chain
    /// via `mt.is_member`. Each ProofItem is a directional `Left(Root)`
    /// or `Right(Root)`. Hashing is sha2_256; leaf = sha2_256(asset_name).
    merkle_proof: Proof<ByteArray>,
    /// Some(idx) ⇒ outputs[idx] is the treasury payment, validated against
    /// cfg.protocol_fee + the compute_output_tag(own_ref) anti-double-sat
    /// tag. None ⇒ no treasury output supplied; validator requires
    /// `cfg.protocol_fee == 0`.
    treasury_output_index: Option<Int>,
  }
  Reclaim
}
