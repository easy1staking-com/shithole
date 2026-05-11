use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/primitive/bytearray
use aiken/primitive/int.{from_bytearray_big_endian}
use cardano/assets.{PolicyId, lovelace_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use shithole/types.{Cancel, ConfigDatum, ListingDatum, ListingRedeemer, Swap}
use shithole/utils

// ============================================================================
// Listing spend validator — parameterized on `config_nft_policy`.
//
// Compile-time parameter binds this validator's address to one specific
// per-collection config. The config UTxO is read via CIP-31 reference input
// on every Swap; the listing UTxO itself is consumed and recreated.
//
// The bucket-equation seed is anchored to `own_ref` — the consumed listing's
// OutputReference, which is FIXED once the swapper picks which listing UTxO
// to target. The swapper has no per-attempt manipulation axis: for any
// (listing, nb) pair the swap outcome is fully determined off-chain. They
// can enumerate matches across their wallet × the pool, but can't grind a
// specific listing into matching with their chosen NFT. For dead collections
// this is the desired randomness-preserving property.
//
// ----------------------------------------------------------------------------
// Datum type is `Option<Data>`, not `Option<ListingDatum>`, so that the
// `Cancel` branch can recover the lister's `pkh` via a partial decode (first
// field only) even if the rest of the datum is somehow corrupt. The `Swap`
// branch still requires the full `ListingDatum` shape via `expect`-cast.
// ============================================================================

validator listing(config_nft_policy: PolicyId) {
  spend(
    datum: Option<Data>,
    redeemer: ListingRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(input_data) = datum

    when redeemer is {
      Swap { nb_asset_name, listing_output_index, treasury_output_index } -> {
        expect input_datum: ListingDatum = input_data
        validate_swap(
          self,
          input_datum,
          own_ref,
          config_nft_policy,
          nb_asset_name,
          listing_output_index,
          treasury_output_index,
        )
      }

      Cancel -> {
        // Defensive: just read the first field as bytes. As long as the
        // datum is `Constr 0 [bytestring, ...]` the lister can reclaim via
        // signature even if `update_ref` (or any further field) is corrupt.
        // Datums that are not constructor-shaped, or whose first field is
        // not a bytestring, will fail to decode here — but those can never
        // be produced by `Swap` (which writes a full `ListingDatum`) nor by
        // a legitimate initial listing creation.
        let lister_pkh = utils.extract_first_bytearray_field(input_data)
        utils.signed_by(self, lister_pkh)
      }
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Swap path
// ============================================================================
//
// Invariants (per SPEC §6.3 — checks ordered cheap-first, hashing last):
//   S1  config ref input pinpointed via config_nft_policy → cfg, collection_policy_id
//   S2  consumed listing input value strictly carries one NFT under
//       collection_policy_id (its asset_name = NA, read from input value)
//   S3  out_listing.address == own_address (same script address)
//   S4  out_listing.datum == ListingDatum { lister_pkh: input.lister_pkh,
//       update_ref: Some(compute_output_tag(own_ref)) }  (combined S5+S6 from
//       the old shape — single struct equality covers both fields)
//   S5  out_listing.value strictly carries (collection_policy, nb_asset_name) × 1
//   S6  out_listing.value.lovelace >= input.lovelace + cfg.lister_fee
//   S7  out_treasury.address == cfg.treasury_addr
//   S8  out_treasury.datum == InlineDatum(compute_output_tag(own_ref))
//   S9  out_treasury.value.lovelace >= cfg.protocol_fee
//   S10 bucket: blake2b(collection_policy ‖ na) % M
//             == blake2b(collection_policy ‖ nb ‖ serialise(own_ref)) % M

fn validate_swap(
  self: Transaction,
  input_datum: ListingDatum,
  own_ref: OutputReference,
  config_nft_policy: PolicyId,
  nb_asset_name: ByteArray,
  listing_output_index: Int,
  treasury_output_index: Int,
) -> Bool {
  let Transaction { inputs, reference_inputs, outputs, .. } = self

  // S1: locate the config UTxO via at-least-one ref input under
  // `config_nft_policy`. One-shot mint guarantees at most one asset under
  // this policy exists chain-wide.
  let cfg_input =
    list.expect_find(
      reference_inputs,
      fn(i) { assets.has_any_nft(i.output.value, config_nft_policy) },
    )
  // Extract the (asset_name, quantity) pair from the config NFT —
  // collection_policy_id IS the asset name (28 bytes, enforced at mint).
  expect [Pair(collection_policy_id, 1)] =
    cfg_input.output.value
      |> assets.tokens(config_nft_policy)
      |> dict.to_pairs()
  expect InlineDatum(cfg_data) = cfg_input.output.datum
  expect cfg: ConfigDatum = cfg_data

  // Resolve own input once (used for value/address/lovelace).
  expect Some(own_input) = find_input(inputs, own_ref)
  let own_address = own_input.output.address
  let input_value = own_input.output.value
  let input_lovelace = lovelace_of(input_value)

  // S2: input strictly carries one NFT under collection_policy (and nothing
  // else besides ADA). Extract NA's asset_name from the input value — we
  // don't need it in the redeemer since it's already pinned by the consumed
  // UTxO. We just need the bytes for the bucket equation.
  expect assets.has_any_nft_strict(input_value, collection_policy_id)
  expect [Pair(na_asset_name, 1)] =
    input_value
      |> assets.tokens(collection_policy_id)
      |> dict.to_pairs()

  // Precompute the output tag once — used by S4 and S8.
  let own_tag = utils.compute_output_tag(own_ref)

  // O(1) output lookups via redeemer hints.
  let out_listing = list.expect_at(outputs, listing_output_index)
  let out_treasury = list.expect_at(outputs, treasury_output_index)

  // Build the expected new listing datum once for S4 — compare-by-equality
  // saves field-by-field checks.
  let expected_listing_datum =
    ListingDatum {
      lister_pkh: input_datum.lister_pkh,
      update_ref: Some(own_tag),
    }
  expect InlineDatum(out_listing_data) = out_listing.datum
  expect out_listing_datum: ListingDatum = out_listing_data

  and {
    // S3: continuing output at the same script address
    (out_listing.address == own_address)?,
    // S4: lister identity preserved + correct update_ref tag (one comparison)
    (out_listing_datum == expected_listing_datum)?,
    // S5: new listing strictly carries NB
    assets.has_nft_strict(
      out_listing.value,
      collection_policy_id,
      nb_asset_name,
    )?,
    // S6: accrual lower bound
    (lovelace_of(out_listing.value) >= input_lovelace + cfg.lister_fee)?,
    // S7: treasury address
    (out_treasury.address == cfg.treasury_addr)?,
    // S8: treasury uniqueness tag (double-satisfaction Case 1)
    (out_treasury.datum == InlineDatum(own_tag))?,
    // S9: protocol fee paid
    (lovelace_of(out_treasury.value) >= cfg.protocol_fee)?,
    // S10: bucket equation, anchored to own_ref — most expensive, evaluated last
    bucket_equation(
      collection_policy_id,
      na_asset_name,
      nb_asset_name,
      own_ref,
      cfg.m,
    )?,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/// The deterministic bucket equation from SPEC §7.
///
/// Seed is anchored to `own_ref` (the consumed listing's outRef), not to a
/// swapper-controlled input. This makes swap outcomes fully determined by
/// (listing, nb) pairs — the swapper can enumerate matches but cannot grind
/// any specific outcome.
fn bucket_equation(
  collection_policy: PolicyId,
  na_asset_name: ByteArray,
  nb_asset_name: ByteArray,
  own_ref: OutputReference,
  m: Int,
) -> Bool {
  let bucket_self =
    collection_policy
      |> bytearray.concat(na_asset_name)
      |> blake2b_256
      |> from_bytearray_big_endian
  let bucket_target =
    collection_policy
      |> bytearray.concat(nb_asset_name)
      |> bytearray.concat(cbor.serialise(own_ref))
      |> blake2b_256
      |> from_bytearray_big_endian
  bucket_self % m == bucket_target % m
}
