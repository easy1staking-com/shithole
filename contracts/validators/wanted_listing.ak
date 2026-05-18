use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use shithole/types.{
  ConfigDatum, Fulfill, Reclaim, WantedDatum, WantedRedeemer,
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
//   W2 deposit_input: an input that is NOT own_ref, strictly carries 1 NFT
//      under collection_policy_id and no other non-ADA assets. Records
//      deposit_asset_name (28 bytes).
//   W3 merkle proof: blake2b_256-sorted-pair chain rooted at
//      input_datum.accepted_merkle_root, with leaf = deposit_asset_name.
//   W4 buyer_output: some output at buyer_pkh's payment credential carries
//      the deposit NFT.
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
  merkle_proof: List<ByteArray>,
  treasury_output_index: Option<Int>,
) -> Bool {
  let Transaction { reference_inputs, outputs, .. } = self

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

  // W2: own_tag binds outputs to THIS specific consumed listing UTxO. Same
  // anti-double-sat construction v2 listing.ak uses for its treasury.
  let own_tag = utils.compute_output_tag(own_ref)

  // W3: locate the buyer-output by its own_tag inline datum. This is the
  // KEY anti-double-sat lever: a single output's datum can only carry ONE
  // tag, so it can only satisfy ONE consumed listing's validator. Without
  // this, two listings from the same buyer with overlapping merkle roots
  // could be drained by a single seller-supplied NFT (one buyer output for
  // two listings → seller pockets both bounties).
  expect Some(buyer_out) =
    list.find(
      outputs,
      fn(o) { o.datum == InlineDatum(own_tag) && o.address != cfg.treasury_addr },
    )

  // W4: buyer_out delivered to the EXACT buyer address the datum specifies
  // (full Address equality — payment cred AND stake cred). This lets buyers
  // pin delivery to a wallet with their bonus-staking delegation set.
  expect buyer_out.address == input_datum.buyer_address

  // W5: buyer_out strictly carries ONE NFT under collection_policy_id and
  // no other non-ADA assets. Extracting the deposit's asset_name from the
  // output (rather than the input) sidesteps the multi-listing "which
  // deposit belongs to me" question entirely — the seller commits via the
  // value they route to the buyer, and the validator reads it back.
  let deposit_asset_name = extract_single_collection_nft(buyer_out.value, collection_policy_id)

  // W6: merkle proof verifies deposit_asset_name (28-byte leaf) → root via
  // sorted-pair blake2b_256 hashing. 28-vs-32 byte length separation gives
  // implicit domain separation between leaves and internal nodes (the
  // security ultimately rests on blake2b preimage resistance, not on the
  // length difference).
  expect verify_merkle_proof(
    deposit_asset_name,
    merkle_proof,
    input_datum.accepted_merkle_root,
  )

  // Treasury leg (W7-W9 / W9'). Same Some/None gate as v2 listing's S7-S9 / S9'.
  when treasury_output_index is {
    Some(idx) -> {
      let out_treasury = list.expect_at(outputs, idx)
      and {
        // W7: treasury address
        (out_treasury.address == cfg.treasury_addr)?,
        // W8: anti-double-sat tag
        (out_treasury.datum == InlineDatum(own_tag))?,
        // W9: protocol fee paid (trivially true when cfg.protocol_fee == 0)
        (assets.expect_lovelace_of(out_treasury.value) >= cfg.protocol_fee)?,
      }
    }
    None ->
      // W9'
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

/// Verify a sorted-pair merkle proof.
///
/// Leaves are raw 28-byte asset_names. Internal nodes are
/// `blake2b_256(concat(left, right))`. At each step the verifier
/// concatenates the smaller value first, so the proof needs no direction
/// bits.
///
/// Domain separation between leaves and internals is guaranteed by the
/// 28-byte vs 32-byte length difference.
fn verify_merkle_proof(
  leaf: ByteArray,
  proof: List<ByteArray>,
  root: ByteArray,
) -> Bool {
  let computed =
    list.foldl(
      proof,
      leaf,
      fn(sibling, acc) {
        when bytearray.compare(acc, sibling) is {
          Less -> blake2b_256(bytearray.concat(acc, sibling))
          _ -> blake2b_256(bytearray.concat(sibling, acc))
        }
      },
    )
  computed == root
}
