use aiken/crypto.{VerificationKeyHash}
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
    treasury_output_index: Int,
  }
  Cancel
  Recover
}
