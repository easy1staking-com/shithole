use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/primitive/bytearray
use aiken/primitive/int.{from_bytearray_big_endian}
use cardano/assets.{PolicyId, Value, lovelace_of}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use shithole/types.{Cancel, ConfigDatum, ListingDatum, ListingRedeemer, Swap}
use shithole/utils

// ============================================================================
// Listing spend validator — parameterized on `config_nft_policy`.
//
// Compile-time parameter binds this validator's address to one specific
// per-collection config. The config UTxO is read via CIP-31 reference input
// on every Swap; the listing UTxO itself is consumed and recreated.
//
// Two redeemer branches: `Swap` (the hot path; S1-S12 from SPEC §6.3) and
// `Cancel` (lister-signed unlock; K1).
// ============================================================================

validator listing(config_nft_policy: PolicyId) {
  spend(
    datum: Option<ListingDatum>,
    redeemer: ListingRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(input_datum) = datum

    when redeemer is {
      Swap {
        na_asset_name,
        nb_asset_name,
        nb_input_index,
        listing_output_index,
        treasury_output_index,
      } ->
        validate_swap(
          self,
          input_datum,
          own_ref,
          config_nft_policy,
          na_asset_name,
          nb_asset_name,
          nb_input_index,
          listing_output_index,
          treasury_output_index,
        )

      Cancel -> utils.signed_by(self, input_datum.lister_pkh)
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
//   S2  consumed listing input value == (collection_policy, na_asset_name) × 1 (+ ADA)
//   S3  tx.inputs[nb_input_index].value contains (collection_policy, nb_asset_name) × 1
//   S4  out_listing.address == own_address (same script address)
//   S5  out_listing.datum.lister_pkh == input.lister_pkh
//   S6  out_listing.datum.update_ref == Some(compute_output_tag(own_ref))
//   S7  out_listing.value == (collection_policy, nb_asset_name) × 1 (+ ADA)
//   S8  out_listing.value.lovelace >= input.lovelace + cfg.lister_fee
//   S9  out_treasury.address == cfg.treasury_addr
//   S10 out_treasury.datum == InlineDatum(compute_output_tag(own_ref))
//   S11 out_treasury.value.lovelace >= cfg.protocol_fee
//   S12 blake2b(collection_policy ‖ na) % M == blake2b(collection_policy ‖ nb ‖ serialise(ua.outRef)) % M

fn validate_swap(
  self: Transaction,
  input_datum: ListingDatum,
  own_ref: OutputReference,
  config_nft_policy: PolicyId,
  na_asset_name: ByteArray,
  nb_asset_name: ByteArray,
  nb_input_index: Int,
  listing_output_index: Int,
  treasury_output_index: Int,
) -> Bool {
  let Transaction { inputs, reference_inputs, outputs, .. } = self

  // S1: locate the config UTxO via at-least-one ref input under config_nft_policy.
  // One-shot mint guarantees at most one asset under this policy exists chain-wide,
  // so list.find is safe.
  expect Some(cfg_input) =
    list.find(
      reference_inputs,
      fn(i) { !dict.is_empty(assets.tokens(i.output.value, config_nft_policy)) },
    )
  // Extract the (asset_name, quantity) pair — collection_policy_id IS the asset name.
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

  // Precompute the output tag once — used by S6 and S10.
  let own_tag = utils.compute_output_tag(own_ref)

  // O(1) lookups via redeemer hints.
  expect Some(ua) = list.at(inputs, nb_input_index)
  expect Some(out_listing) = list.at(outputs, listing_output_index)
  expect Some(out_treasury) = list.at(outputs, treasury_output_index)

  // Decode the new listing's datum.
  expect InlineDatum(out_listing_data) = out_listing.datum
  expect out_listing_datum: ListingDatum = out_listing_data

  and {
    // S2: input strictly carries (collection_policy, na_asset_name) × 1
    is_strict_single_nft(input_value, collection_policy_id, na_asset_name)?,
    // S3: UA carries NB
    (assets.quantity_of(ua.output.value, collection_policy_id, nb_asset_name) == 1)?,
    // S4: continuing output at the same script address
    (out_listing.address == own_address)?,
    // S5: lister identity preserved
    (out_listing_datum.lister_pkh == input_datum.lister_pkh)?,
    // S6: listing-recreation uniqueness tag (double-satisfaction Case 2)
    (out_listing_datum.update_ref == Some(own_tag))?,
    // S7: new listing strictly carries NB
    is_strict_single_nft(out_listing.value, collection_policy_id, nb_asset_name)?,
    // S8: accrual lower bound
    (lovelace_of(out_listing.value) >= input_lovelace + cfg.lister_fee)?,
    // S9: treasury address
    (out_treasury.address == cfg.treasury_addr)?,
    // S10: treasury uniqueness tag (double-satisfaction Case 1)
    (out_treasury.datum == InlineDatum(own_tag))?,
    // S11: protocol fee paid
    (lovelace_of(out_treasury.value) >= cfg.protocol_fee)?,
    // S12: bucket equation — most expensive, evaluated last
    bucket_equation(
      collection_policy_id,
      na_asset_name,
      nb_asset_name,
      ua.output_reference,
      cfg.m,
    )?,
  }
}

// ============================================================================
// Helpers
// ============================================================================

/// True iff `value` contains exactly one non-ADA asset, equal to
/// `(policy, asset_name)` with quantity 1. Lovelace may be anything.
fn is_strict_single_nft(
  value: Value,
  policy: PolicyId,
  asset_name: ByteArray,
) -> Bool {
  assets.without_lovelace(value) == assets.from_asset(policy, asset_name, 1)
}

/// The deterministic bucket equation from SPEC §7.
fn bucket_equation(
  collection_policy: PolicyId,
  na_asset_name: ByteArray,
  nb_asset_name: ByteArray,
  ua_outref: OutputReference,
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
      |> bytearray.concat(cbor.serialise(ua_outref))
      |> blake2b_256
      |> from_bytearray_big_endian
  bucket_self % m == bucket_target % m
}
