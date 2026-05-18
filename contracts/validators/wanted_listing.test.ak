use aiken_merkle_tree/mt.{Proof, from_list, get_proof, root, to_hash}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use shithole/types.{ConfigDatum, Fulfill, Reclaim, WantedDatum}
use shithole/utils
use wanted_listing

// ============================================================================
// Test fixtures
// ============================================================================

const test_config_nft_policy =
  #"00000000000000000000000000000000000000000000000000000099"

const test_wanted_script_hash =
  #"00000000000000000000000000000000000000000000000000000077"

const test_collection_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_buyer_pkh =
  #"11111111111111111111111111111111111111111111111111111111"

const test_seller_pkh =
  #"22222222222222222222222222222222222222222222222222222222"

const test_treasury_pkh =
  #"33333333333333333333333333333333333333333333333333333333"

const test_admin_pkh =
  #"44444444444444444444444444444444444444444444444444444444"

// Offered NFT (the buyer's "unwanted") and a sample of trait-matching NFTs
// the seller might use as deposit.
const test_offered_name = #"4f464645524544"
// 28-byte asset names so the validator's strict 28-vs-32 length separator
// for merkle leaves still holds against typical Cardano CNFT asset names.
const test_deposit_name = #"aabbccddeeff00112233445566778899aabbccddeeff001122334411"
const test_other_name = #"aabbccddeeff00112233445566778899aabbccddeeff001122334422"
const test_third_name = #"aabbccddeeff00112233445566778899aabbccddeeff001122334433"

const test_bounty_lovelace = 10_000_000

fn test_treasury_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_treasury_pkh),
    stake_credential: None,
  }
}

fn test_wanted_addr() -> Address {
  Address {
    payment_credential: Script(test_wanted_script_hash),
    stake_credential: None,
  }
}

fn test_buyer_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_buyer_pkh),
    stake_credential: None,
  }
}

fn test_seller_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_seller_pkh),
    stake_credential: None,
  }
}

fn test_config_addr() -> Address {
  Address {
    payment_credential: Script(test_config_nft_policy),
    stake_credential: None,
  }
}

fn valid_config_datum() -> ConfigDatum {
  ConfigDatum {
    m: 1,
    protocol_fee: 1_000_000,
    lister_fee: 1_000_000,
    treasury_addr: test_treasury_addr(),
    admin_pkh: test_admin_pkh,
  }
}

fn zero_fee_config_datum() -> ConfigDatum {
  ConfigDatum { ..valid_config_datum(), protocol_fee: 0 }
}

fn wanted_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000010",
    output_index: 0,
  }
}

fn other_wanted_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000020",
    output_index: 0,
  }
}

fn deposit_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000030",
    output_index: 0,
  }
}

fn config_ref_input(cfg: ConfigDatum) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000099",
      output_index: 0,
    },
    output: Output {
      address: test_config_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_config_nft_policy, test_collection_policy, 1),
      datum: InlineDatum(cfg),
      reference_script: None,
    },
  }
}

/// Wanted-listing input UTxO: the offered NFT + bounty lovelace at the
/// parameterized script address.
fn wanted_input(root: ByteArray, outref: OutputReference) -> Input {
  Input {
    output_reference: outref,
    output: Output {
      address: test_wanted_addr(),
      value: assets.from_lovelace(test_bounty_lovelace + 2_000_000)
        |> assets.add(test_collection_policy, test_offered_name, 1),
      datum: InlineDatum(
        WantedDatum {
          buyer_pkh: test_buyer_pkh,
          buyer_address: test_buyer_addr(),
          accepted_merkle_root: root,
        },
      ),
      reference_script: None,
    },
  }
}

/// Seller wallet input carrying a matching NFT (the "deposit").
fn deposit_input(asset_name: ByteArray) -> Input {
  Input {
    output_reference: deposit_outref(),
    output: Output {
      address: test_seller_addr(),
      value: assets.from_lovelace(5_000_000)
        |> assets.add(test_collection_policy, asset_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

/// Buyer output: receives the deposit NFT, carrying the
/// compute_output_tag(own_ref) inline datum so the validator can bind THIS
/// output to THIS specific consumed listing (anti-double-sat for the
/// buyer side, especially important on the zero-fee path where there's no
/// treasury tag binding).
fn buyer_output(asset_name: ByteArray, own_ref: OutputReference) -> Output {
  let tag = utils.compute_output_tag(own_ref)
  Output {
    address: test_buyer_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_collection_policy, asset_name, 1),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

/// Treasury output with the canonical tag binding.
fn treasury_output(own_ref: OutputReference, lovelace: Int) -> Output {
  let tag = utils.compute_output_tag(own_ref)
  Output {
    address: valid_config_datum().treasury_addr,
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

// ============================================================================
// Merkle helpers — thin wrappers over the aiken_merkle_tree library so the
// tests build trees and proofs the EXACT same way the on-chain validator
// verifies them. Off-chain (BE / FE) code must mirror this same pipeline:
//   - leaves are raw asset_name bytes; `identity` serialiser
//   - the library hashes leaves with sha2_256 internally
//   - tree topology is determined by `from_list`'s left-leaning split-by-half
// ============================================================================

/// Build the merkle root bytes for a list of asset_names. Returns the raw
/// 32-byte sha2_256-derived root — what we'd store in WantedDatum.
fn build_root(items: List<ByteArray>) -> ByteArray {
  expect Some(h) =
    from_list(items, identity)
      |> root
      |> to_hash
  h
}

/// Build a membership proof for a given asset_name against the tree spanned
/// by `items`. Fails the test if `item ∉ items` (proof would be `None`).
fn build_proof(items: List<ByteArray>, item: ByteArray) -> Proof<ByteArray> {
  expect Some(p) = get_proof(from_list(items, identity), item, identity)
  p
}

// ============================================================================
// Test invocation helper
// ============================================================================

fn invoke_fulfill(
  tx: Transaction,
  root: ByteArray,
  merkle_proof: Proof<ByteArray>,
  treasury_output_index: Option<Int>,
) -> Bool {
  let listing_datum: Data =
    WantedDatum {
      buyer_pkh: test_buyer_pkh,
      buyer_address: test_buyer_addr(),
      accepted_merkle_root: root,
    }
  wanted_listing.wanted_listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Fulfill { merkle_proof, treasury_output_index },
    wanted_outref(),
    tx,
  )
}

fn invoke_reclaim(tx: Transaction) -> Bool {
  let listing_datum: Data =
    WantedDatum {
      buyer_pkh: test_buyer_pkh,
      buyer_address: test_buyer_addr(),
      accepted_merkle_root: #"00",
    }
  wanted_listing.wanted_listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Reclaim,
    wanted_outref(),
    tx,
  )
}

// ============================================================================
// Happy path
// ============================================================================

/// Canonical fulfill tx: 2-leaf merkle tree (deposit_name, other_name).
fn happy_fulfill_tx(root: ByteArray) -> Transaction {
  let cfg = valid_config_datum()
  Transaction {
    ..transaction.placeholder,
    inputs: [wanted_input(root, wanted_outref()), deposit_input(test_deposit_name)],
    reference_inputs: [config_ref_input(cfg)],
    outputs: [
      buyer_output(test_deposit_name, wanted_outref()),
      treasury_output(wanted_outref(), cfg.protocol_fee),
    ],
  }
}

test fulfill_succeeds() {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let proof = build_proof(items, test_deposit_name)
  invoke_fulfill(happy_fulfill_tx(root), root, proof, Some(1))
}

// ============================================================================
// Merkle verifier
// ============================================================================

test fulfill_fails_with_wrong_proof() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  // Proof generated for a DIFFERENT leaf in the same tree. is_member will
  // hash `test_deposit_name` (the leaf the validator pulled from the buyer
  // output's value) and chain it via the test_other_name proof — root
  // mismatch → reject.
  let proof = build_proof(items, test_other_name)
  invoke_fulfill(happy_fulfill_tx(root), root, proof, Some(1))
}

test fulfill_fails_with_empty_proof_against_nontrivial_root() fail {
  // Tree of 2 leaves needs proof of length 1; supplying 0 should fail.
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let proof = []
  invoke_fulfill(happy_fulfill_tx(root), root, proof, Some(1))
}

test fulfill_succeeds_with_four_leaf_tree() {
  // 4-leaf tree; library builds it via left-leaning split-by-half.
  let d = #"aabbccddeeff00112233445566778899aabbccddeeff001122334444"
  let items = [test_deposit_name, test_other_name, test_third_name, d]
  let root = build_root(items)
  let proof = build_proof(items, test_deposit_name)
  invoke_fulfill(happy_fulfill_tx(root), root, proof, Some(1))
}

// ============================================================================
// Deposit input shape
// ============================================================================

// ============================================================================
// Buyer output (the validator's view of "what NFT was delivered")
//
// The validator extracts the deposited asset_name from the BUYER's output
// (not from any input), then verifies it against the merkle root. Tests
// here exercise the strict-shape rules on that output.
// ============================================================================

test fulfill_fails_when_buyer_output_has_wrong_policy_nft() fail {
  // Buyer output is correctly tagged + at buyer's pkh, but the NFT inside
  // is under a wrong policy. extract_single_collection_nft must reject:
  // it checks `p == collection_policy_id` exactly.
  let wrong_policy =
    #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let bad_buyer_out =
    Output {
      address: test_buyer_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(wrong_policy, test_deposit_name, 1),
      datum: InlineDatum(utils.compute_output_tag(wanted_outref())),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [wanted_input(root, wanted_outref()), deposit_input(test_deposit_name)],
      reference_inputs: [config_ref_input(cfg)],
      outputs: [bad_buyer_out, treasury_output(wanted_outref(), cfg.protocol_fee)],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

test fulfill_fails_when_buyer_output_has_extra_tokens() fail {
  // Strict shape: buyer_output may carry ADA + EXACTLY one NFT under
  // collection_policy_id. Co-tenant tokens are rejected.
  let extra_policy =
    #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let bad_buyer_out =
    Output {
      address: test_buyer_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_collection_policy, test_deposit_name, 1)
        |> assets.add(extra_policy, #"01", 1),
      datum: InlineDatum(utils.compute_output_tag(wanted_outref())),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [wanted_input(root, wanted_outref()), deposit_input(test_deposit_name)],
      reference_inputs: [config_ref_input(cfg)],
      outputs: [bad_buyer_out, treasury_output(wanted_outref(), cfg.protocol_fee)],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

test fulfill_fails_when_buyer_doesnt_receive_nft() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_fulfill_tx(root),
      // Output 0 routed to seller instead of buyer — buyer doesn't get the NFT.
      outputs: [
        Output {
          address: test_seller_addr(),
          value: assets.from_lovelace(2_000_000)
            |> assets.add(test_collection_policy, test_deposit_name, 1),
          datum: NoDatum,
          reference_script: None,
        },
        treasury_output(wanted_outref(), cfg.protocol_fee),
      ],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

test fulfill_fails_when_buyer_output_has_wrong_nft() fail {
  // Buyer's output carries a different NFT than what was deposited.
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_fulfill_tx(root),
      outputs: [
        buyer_output(test_third_name, wanted_outref()), // wrong asset!
        treasury_output(wanted_outref(), cfg.protocol_fee),
      ],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

// ============================================================================
// Treasury leg (Some/None gate — mirrors v2 S7-S9 / S9')
// ============================================================================

test fulfill_succeeds_with_zero_fee_and_no_treasury() {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = zero_fee_config_datum()
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [wanted_input(root, wanted_outref()), deposit_input(test_deposit_name)],
      reference_inputs: [config_ref_input(cfg)],
      // No treasury output.
      outputs: [buyer_output(test_deposit_name, wanted_outref())],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), None)
}

test fulfill_fails_with_none_treasury_when_fee_positive() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  invoke_fulfill(happy_fulfill_tx(root), root, build_proof(items, test_deposit_name), None)
}

test fulfill_fails_with_wrong_treasury_address() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let wrong_addr =
    Address { payment_credential: VerificationKey(test_seller_pkh), stake_credential: None }
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_fulfill_tx(root),
      outputs: [
        buyer_output(test_deposit_name, wanted_outref()),
        Output {
          address: wrong_addr, // wrong treasury target
          value: assets.from_lovelace(cfg.protocol_fee),
          datum: InlineDatum(utils.compute_output_tag(wanted_outref())),
          reference_script: None,
        },
      ],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

test fulfill_fails_with_wrong_treasury_tag() fail {
  // Tag derived from a DIFFERENT outref — double-sat defense fires.
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_fulfill_tx(root),
      outputs: [
        buyer_output(test_deposit_name, wanted_outref()),
        Output {
          address: cfg.treasury_addr,
          value: assets.from_lovelace(cfg.protocol_fee),
          datum: InlineDatum(utils.compute_output_tag(other_wanted_outref())),
          reference_script: None,
        },
      ],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

test fulfill_fails_with_insufficient_treasury_lovelace() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_fulfill_tx(root),
      outputs: [
        buyer_output(test_deposit_name, wanted_outref()),
        // Underpaid treasury: half of protocol_fee.
        Output {
          address: cfg.treasury_addr,
          value: assets.from_lovelace(cfg.protocol_fee / 2),
          datum: InlineDatum(utils.compute_output_tag(wanted_outref())),
          reference_script: None,
        },
      ],
    }
  invoke_fulfill(tx, root, build_proof(items, test_deposit_name), Some(1))
}

// ============================================================================
// Reclaim
// ============================================================================

test reclaim_succeeds_with_buyer_sig() {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [wanted_input(#"00", wanted_outref())],
      extra_signatories: [test_buyer_pkh],
    }
  invoke_reclaim(tx)
}

test reclaim_fails_without_buyer_sig() fail {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [wanted_input(#"00", wanted_outref())],
      // Wrong signer.
      extra_signatories: [test_seller_pkh],
    }
  invoke_reclaim(tx)
}

// ============================================================================
// Multi-input double-satisfaction defense
// ============================================================================

/// Multi-listing fulfill HAPPY PATH: two wanted listings A and B consumed
/// in the same tx, each with its own deposit, buyer output, and correctly-
/// tagged treasury output. Validator invocations for both listings must
/// pass — exercises the `own_address` filter in find_deposit_asset_name so
/// each invocation excludes the OTHER listing's offered NFT from its
/// deposit candidates.
test multi_fulfill_two_listings_pass() {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let other_deposit =
    Input {
      output_reference:
        OutputReference {
          transaction_id: #"0000000000000000000000000000000000000000000000000000000000000031",
          output_index: 0,
        },
      output: Output {
        address: test_seller_addr(),
        value: assets.from_lovelace(5_000_000)
          |> assets.add(test_collection_policy, test_other_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [
        wanted_input(root, wanted_outref()),
        wanted_input(root, other_wanted_outref()),
        deposit_input(test_deposit_name),
        other_deposit,
      ],
      reference_inputs: [config_ref_input(cfg)],
      outputs: [
        buyer_output(test_deposit_name, wanted_outref()),
        buyer_output(test_other_name, other_wanted_outref()),
        // Two correctly-tagged treasury outputs, one per listing.
        treasury_output(wanted_outref(), cfg.protocol_fee),
        treasury_output(other_wanted_outref(), cfg.protocol_fee),
      ],
    }
  let listing_datum: Data =
    WantedDatum {
      buyer_pkh: test_buyer_pkh,
      buyer_address: test_buyer_addr(),
      accepted_merkle_root: root,
    }
  // Invocation for listing A. Proof: deposit_name's sibling is other_name.
  wanted_listing.wanted_listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Fulfill {
      merkle_proof: build_proof(items, test_deposit_name),
      treasury_output_index: Some(2),
    },
    wanted_outref(),
    tx,
  )
}

/// Two wanted listings consumed in the same tx with ONE treasury output
/// tagged for listing A only. Validator invocation for listing B must
/// fail W6 (tag mismatch) — same pattern as v2's
/// `multi_swap_blocked_by_treasury_tag_binding`.
test multi_fulfill_blocked_by_treasury_tag_binding() fail {
  let items = [test_deposit_name, test_other_name]
  let root = build_root(items)
  let cfg = valid_config_datum()
  let other_deposit =
    Input {
      output_reference:
        OutputReference {
          transaction_id: #"0000000000000000000000000000000000000000000000000000000000000031",
          output_index: 0,
        },
      output: Output {
        address: test_seller_addr(),
        value: assets.from_lovelace(5_000_000)
          |> assets.add(test_collection_policy, test_other_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [
        wanted_input(root, wanted_outref()),
        wanted_input(root, other_wanted_outref()),
        deposit_input(test_deposit_name),
        other_deposit,
      ],
      reference_inputs: [config_ref_input(cfg)],
      outputs: [
        buyer_output(test_deposit_name, wanted_outref()),
        buyer_output(test_other_name, other_wanted_outref()),
        // ONE treasury output tagged for listing A only.
        treasury_output(wanted_outref(), cfg.protocol_fee),
      ],
    }
  // We're checking listing B's invocation, which uses other_wanted_outref.
  let listing_datum: Data =
    WantedDatum {
      buyer_pkh: test_buyer_pkh,
      buyer_address: test_buyer_addr(),
      accepted_merkle_root: root,
    }
  wanted_listing.wanted_listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Fulfill {
      // Listing B's deposit is test_other_name. Proof must be valid so we
      // confirm the test fails on the treasury tag check, not on merkle.
      merkle_proof: build_proof(items, test_other_name),
      treasury_output_index: Some(2),
    },
    other_wanted_outref(),
    tx,
  )
}
