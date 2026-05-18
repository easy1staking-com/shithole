use aiken/collection/dict
use aiken/collection/list
use aiken_merkle_tree/mt.{Proof, from_hash, is_member}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use shithole/types.{
  ConfigDatum, Fulfill, Reclaim, WantedDatum, WantedRedeemer,
  min_seller_compensation,
}
use shithole/utils

// ============================================================================
// Wanted-listing spend validator — parameterized on `config_nft_policy`.
//
// "Wanted" listings are a buyer-initiated P2P swap mechanism for trait-
// conditioned NFT exchanges. A buyer locks (offered_NFT + bounty ADA) at this
// script address with a `WantedDatum` carrying:
//   - `buyer_pkh`: the buyer's payment-key hash (signature gate for Reclaim)
//   - `accepted_merkle_root`: 32-byte commitment to a set of acceptable
//     asset_names (the "trait set" the buyer cares about)
//
// A seller fulfills alone by:
//   1. providing a deposit input containing a trait-matching NFT from the
//      same collection
//   2. supplying a merkle proof of that NFT's asset_name against the listing's
//      accepted_merkle_root
//
// Unlike the v2 swap-pool listing, wanted-listings DO NOT replant. They
// dissolve on fulfill: deposited NFT → buyer; offered NFT + bounty → seller;
// protocol fee (if any) → treasury.
//
// ----------------------------------------------------------------------------
// Datum type is `Option<Data>` (not `Option<WantedDatum>`) so the `Reclaim`
// branch can recover the buyer's pkh via a partial decode even if the rest of
// the datum is somehow corrupt — mirrors the v2 Cancel pattern.
// ============================================================================

validator wanted_listing(config_nft_policy: PolicyId) {
  spend(
    datum: Option<Data>,
    redeemer: WantedRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    when redeemer is {
      Fulfill { merkle_proof, treasury_output_index } -> {
        expect Some(input_data) = datum
        expect input_datum: WantedDatum = input_data
        validate_fulfill(
          self,
          input_datum,
          own_ref,
          config_nft_policy,
          merkle_proof,
          treasury_output_index,
        )
      }

      Reclaim -> {
        // Buyer pulls their offered NFT + bounty back. Defensive partial
        // decode of the first field (`buyer_pkh`) — same robustness trick
        // v2 listing.ak uses for Cancel. Lets a buyer reclaim even if a
        // later-version BE writes a slightly different datum shape, as
        // long as the FIRST field stays `bytestring(pkh)`.
        expect Some(input_data) = datum
        let buyer_pkh = utils.extract_first_bytearray_field(input_data)
        utils.signed_by(self, buyer_pkh)
      }
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Fulfill path
// ============================================================================
//
// Invariants:
//   W1 config ref input pinpointed via config_nft_policy → cfg, collection_policy_id
//   W2 own_input lovelace floor: the consumed listing UTxO must carry at
//      least `cfg.protocol_fee + min_seller_compensation` lovelace. Protects
//      sellers from listings that can't possibly cover their tx fee + the
//      buyer-bound output's ~1.5 ADA min_utxo. Anything above this floor
//      flows to the seller as their fulfillment incentive.
//   W3 buyer_output: some output at buyer_pkh's payment credential carries
//      the deposit NFT and the anti-double-sat tag.
//   W4 merkle proof: sha2_256 chain rooted at
//      input_datum.accepted_merkle_root, with leaf = deposit_asset_name.
//   Treasury leg (gated by redeemer.treasury_output_index : Option<Int>):
//     Some(idx) →
//       W5 outputs[idx].address == cfg.treasury_addr
//       W6 outputs[idx].datum == InlineDatum(compute_output_tag(own_ref))
//          (anti-double-sat: one treasury output per consumed listing)
//       W7 outputs[idx].value.lovelace >= cfg.protocol_fee
//     None →
//       W7' cfg.protocol_fee == 0
// ----------------------------------------------------------------------------
// Why we DON'T enforce where the offered NFT or bounty lovelace go: the
// seller builds the tx and will route those to themselves (otherwise they
// wouldn't sign it). Validator only guards what the BUYER and the PROTOCOL
// care about: the buyer receives a trait-matching NFT, the treasury (if any)
// receives the fee.

fn validate_fulfill(
  self: Transaction,
  input_datum: WantedDatum,
  own_ref: OutputReference,
  config_nft_policy: PolicyId,
  merkle_proof: Proof<ByteArray>,
  treasury_output_index: Option<Int>,
) -> Bool {
  let Transaction { reference_inputs, inputs, outputs, .. } = self

  // W1: locate config UTxO + extract cfg, collection_policy_id (= asset name
  // on the config NFT, enforced at config mint time).
  let cfg_input =
    list.expect_find(
      reference_inputs,
      fn(i) { assets.has_any_nft_strict(i.output.value, config_nft_policy) },
    )
  expect [Pair(actual_cfg_policy, cfg_nft)] =
    cfg_input.output.value
      |> assets.to_dict()
      |> dict.expect_tail()
      |> dict.to_pairs()
  expect actual_cfg_policy == config_nft_policy
  expect [Pair(collection_policy_id, 1)] = dict.to_pairs(cfg_nft)
  expect InlineDatum(cfg_data) = cfg_input.output.datum
  expect cfg: ConfigDatum = cfg_data

  // W2: seller break-even floor. The consumed listing must carry at least
  // `cfg.protocol_fee + min_seller_compensation` lovelace so the seller is
  // guaranteed to cover their tx fee + the buyer-output's min_utxo from the
  // listing alone. Read the input value via find_input on own_ref (cheap,
  // single-pass) and assert the floor BEFORE doing any merkle work.
  expect Some(own_input) = find_input(inputs, own_ref)
  expect
    assets.expect_lovelace_of(own_input.output.value) >= cfg.protocol_fee + min_seller_compensation

  // W3: precompute the buyer-output identity. `own_tag` binds an output to
  // THIS specific consumed listing UTxO (anti-double-sat for the buyer
  // side, same construction v2 listing.ak uses for its treasury).
  // Wrapping in InlineDatum once OUTSIDE the find-loop avoids re-allocating
  // it on every output we walk.
  let own_tag = utils.compute_output_tag(own_ref)
  let buyer_out_datum = InlineDatum(own_tag)

  // W3: locate the buyer-output by BOTH (a) the EXACT buyer_address
  // the datum specifies (full Address equality — payment cred + stake
  // cred, so the NFT lands in a wallet with the bonus-staking delegation
  // set) AND (b) the own_tag inline datum.
  //
  // The combined filter is the anti-double-sat lever: a single output's
  // datum can only carry ONE tag, so even when two listings share the
  // same buyer_address and accept overlapping merkle roots, a seller can't
  // route ONE NFT to satisfy both — the second listing's invocation needs
  // its own tag in its own output. Address check first, since it's the
  // more discriminating filter on a typical tx with diverse outputs.
  expect Some(buyer_out) =
    list.find(
      outputs,
      fn(o) {
        o.address == input_datum.buyer_address && o.datum == buyer_out_datum
      },
    )

  // W3 (cont.): buyer_out strictly carries ONE NFT under collection_policy_id
  // and no other non-ADA assets. Extracting the deposit's asset_name from
  // the output (rather than the input) sidesteps the multi-listing "which
  // deposit belongs to me" question entirely — the seller commits via the
  // value they route to the buyer, and the validator reads it back.
  let deposit_asset_name =
    extract_single_collection_nft(buyer_out.value, collection_policy_id)

  // W4: merkle proof verifies deposit_asset_name → accepted_merkle_root via
  // the aiken_merkle_tree library (sha2_256 leaves + internals, directional
  // Left/Right proof items). identity serialiser since asset_names are
  // already raw ByteArrays.
  expect
    is_member(
      from_hash(input_datum.accepted_merkle_root),
      deposit_asset_name,
      merkle_proof,
      identity,
    )

  // Treasury leg (W5-W7 / W7'). Same Some/None gate as v2 listing's S7-S9 / S9'.
  when treasury_output_index is {
    Some(idx) -> {
      let out_treasury = list.expect_at(outputs, idx)
      and {
        // W5: treasury address
        (out_treasury.address == cfg.treasury_addr)?,
        // W6: anti-double-sat tag
        (out_treasury.datum == InlineDatum(own_tag))?,
        // W7: protocol fee paid (trivially true when cfg.protocol_fee == 0)
        (assets.expect_lovelace_of(out_treasury.value) >= cfg.protocol_fee)?,
      }
    }
    None ->
      // W7'
      (cfg.protocol_fee == 0)?
  }
}

// ============================================================================
// Helpers
// ============================================================================

/// Strictly extract the SINGLE asset_name of the NFT under
/// `collection_policy_id` from `value`. The value must contain exactly one
/// non-ADA policy (the configured collection), exactly one asset under
/// that policy with quantity 1, and nothing else. Fails the validator
/// otherwise.
///
/// Used to read the buyer-bound output's value and find which trait-matching
/// NFT the seller delivered.
fn extract_single_collection_nft(
  value: Value,
  collection_policy_id: ByteArray,
) -> ByteArray {
  // Mirror v2 listing.ak's S2 extraction: drop the leading ADA row via
  // dict.expect_tail (relies on ADA's empty-bytestring policy id sorting
  // first ascending), then pattern-match the remainder as a single non-ADA
  // policy with a single 1-quantity asset.
  expect [Pair(p, inner)] =
    value
      |> assets.to_dict()
      |> dict.expect_tail()
      |> dict.to_pairs()
  expect p == collection_policy_id
  expect [Pair(name, 1)] = dict.to_pairs(inner)
  name
}
