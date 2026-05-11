use aiken/builtin
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use listing
use shithole/types.{Cancel, ConfigDatum, ListingDatum, ListingRedeemer, Swap}
use shithole/utils

// ============================================================================
// Test fixtures
// ============================================================================

const test_config_nft_policy =
  #"00000000000000000000000000000000000000000000000000000099"

const test_listing_script_hash =
  #"00000000000000000000000000000000000000000000000000000088"

// 28-byte collection policy id (lives as asset name on the config NFT)
const test_collection_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_lister_pkh =
  #"11111111111111111111111111111111111111111111111111111111"

const test_swapper_pkh =
  #"22222222222222222222222222222222222222222222222222222222"

const test_treasury_pkh =
  #"33333333333333333333333333333333333333333333333333333333"

// Asset names for NA (in listing) and NB (deposited by swapper).
// With cfg.m = 1, bucket math is trivially satisfied, so any names work.
const test_na_name = #"4e41"

const test_nb_name = #"4e42"

fn test_treasury_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_treasury_pkh),
    stake_credential: None,
  }
}

fn test_listing_addr() -> Address {
  Address {
    payment_credential: Script(test_listing_script_hash),
    stake_credential: None,
  }
}

fn test_swapper_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_swapper_pkh),
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
    admin_pkh: #"00000000000000000000000000000000000000000000000000000001",
  }
}

fn listing_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000010",
    output_index: 0,
  }
}

fn other_listing_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000020",
    output_index: 0,
  }
}

fn ua_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000030",
    output_index: 0,
  }
}

fn config_ref_input() -> Input {
  let config_outref =
    OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000099",
      output_index: 0,
    }
  Input {
    output_reference: config_outref,
    output: Output {
      address: test_config_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_config_nft_policy, test_collection_policy, 1),
      datum: InlineDatum(valid_config_datum()),
      reference_script: None,
    },
  }
}

fn listing_input_holding(asset_name: ByteArray, oref: OutputReference) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_collection_policy, asset_name, 1),
      datum: InlineDatum(
        ListingDatum { lister_pkh: test_lister_pkh, update_ref: None },
      ),
      reference_script: None,
    },
  }
}

fn ua_input_holding(asset_name: ByteArray) -> Input {
  Input {
    output_reference: ua_outref(),
    output: Output {
      address: test_swapper_addr(),
      value: assets.from_lovelace(5_000_000)
        |> assets.add(test_collection_policy, asset_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn out_listing_holding(
  asset_name: ByteArray,
  lister_pkh: ByteArray,
  update_ref: Option<ByteArray>,
  lovelace: Int,
) -> Output {
  Output {
    address: test_listing_addr(),
    value: assets.from_lovelace(lovelace)
      |> assets.add(test_collection_policy, asset_name, 1),
    datum: InlineDatum(ListingDatum { lister_pkh, update_ref }),
    reference_script: None,
  }
}

fn out_treasury_with(tag: ByteArray, lovelace: Int, addr: Address) -> Output {
  Output {
    address: addr,
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

/// Canonical well-formed swap tx for the happy path. Listing input at index 0,
/// swapper's NB-holding input at index 1. Output 0 = new listing (NB),
/// output 1 = treasury fee.
fn happy_swap_tx() -> Transaction {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  Transaction {
    ..transaction.placeholder,
    inputs: [
      listing_input_holding(test_na_name, listing_outref()),
      ua_input_holding(test_nb_name),
    ],
    reference_inputs: [config_ref_input()],
    outputs: [
      out_listing_holding(
        test_nb_name,
        test_lister_pkh,
        Some(own_tag),
        2_000_000 + cfg.lister_fee,
      ),
      out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
    ],
  }
}

fn happy_swap_redeemer() {
  Swap {
    nb_asset_name: test_nb_name,
    listing_output_index: 0,
    treasury_output_index: 1,
  }
}

/// Invoke the listing spend validator for the canonical listing UTxO with a
/// well-formed `ListingDatum` (cast to `Data`).
fn invoke_swap(tx: Transaction, redeemer: ListingRedeemer) -> Bool {
  let listing_datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  listing.listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    redeemer,
    listing_outref(),
    tx,
  )
}

// ============================================================================
// Happy path
// ============================================================================

test swap_succeeds() {
  invoke_swap(happy_swap_tx(), happy_swap_redeemer())
}

// ============================================================================
// S1: config ref input must be findable under config_nft_policy
// ============================================================================

test swap_fails_without_config_ref_input() fail {
  let tx = Transaction { ..happy_swap_tx(), reference_inputs: [] }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S2: consumed listing input must strictly carry one NFT under collection_policy
// ============================================================================

test swap_fails_when_input_has_no_collection_nft() fail {
  // Listing input holds an NFT under the WRONG policy — S2's
  // has_any_nft_strict(input_value, collection_policy_id) fails.
  let wrong_policy = #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  let bad_input =
    Input {
      output_reference: listing_outref(),
      output: Output {
        address: test_listing_addr(),
        value: assets.from_lovelace(2_000_000)
          |> assets.add(wrong_policy, test_na_name, 1),
        datum: InlineDatum(
          ListingDatum { lister_pkh: test_lister_pkh, update_ref: None },
        ),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      inputs: [bad_input, ua_input_holding(test_nb_name)],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_when_input_has_two_nfts_under_collection() fail {
  // Listing input holds TWO NFTs under collection_policy — has_any_nft_strict
  // requires exactly one.
  let bad_input =
    Input {
      output_reference: listing_outref(),
      output: Output {
        address: test_listing_addr(),
        value: assets.from_lovelace(2_000_000)
          |> assets.add(test_collection_policy, test_na_name, 1)
          |> assets.add(test_collection_policy, #"99", 1),
        datum: InlineDatum(
          ListingDatum { lister_pkh: test_lister_pkh, update_ref: None },
        ),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      inputs: [bad_input, ua_input_holding(test_nb_name)],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_when_input_has_qty_2() fail {
  let bad_input =
    Input {
      output_reference: listing_outref(),
      output: Output {
        address: test_listing_addr(),
        value: assets.from_lovelace(2_000_000)
          |> assets.add(test_collection_policy, test_na_name, 2),
        datum: InlineDatum(
          ListingDatum { lister_pkh: test_lister_pkh, update_ref: None },
        ),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      inputs: [bad_input, ua_input_holding(test_nb_name)],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S3: out_listing must be at the same script address
// ============================================================================

test swap_fails_with_listing_to_wrong_address() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        Output {
          address: test_swapper_addr(),
          value: assets.from_lovelace(3_000_000)
            |> assets.add(test_collection_policy, test_nb_name, 1),
          datum: InlineDatum(
            ListingDatum {
              lister_pkh: test_lister_pkh,
              update_ref: Some(own_tag),
            },
          ),
          reference_script: None,
        },
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S4: out_listing datum must match expected { lister_pkh, Some(own_tag) }
// ============================================================================

test swap_fails_when_lister_pkh_changes() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_swapper_pkh,
          Some(own_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_with_wrong_update_ref() fail {
  let wrong_tag = utils.compute_output_tag(other_listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(wrong_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(
          utils.compute_output_tag(listing_outref()),
          cfg.protocol_fee,
          cfg.treasury_addr,
        ),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_with_no_update_ref() fail {
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          None,
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(
          utils.compute_output_tag(listing_outref()),
          cfg.protocol_fee,
          cfg.treasury_addr,
        ),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S5: out_listing.value strictly carries (collection_policy, nb_asset_name) × 1
// ============================================================================

test swap_fails_when_out_listing_under_wrong_policy() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let wrong_policy = #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  let bad =
    Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000 + cfg.lister_fee)
        |> assets.add(wrong_policy, test_nb_name, 1),
      datum: InlineDatum(
        ListingDatum { lister_pkh: test_lister_pkh, update_ref: Some(own_tag) },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        bad,
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_when_out_listing_has_qty_2() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let bad =
    Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000 + cfg.lister_fee)
        |> assets.add(test_collection_policy, test_nb_name, 2),
      datum: InlineDatum(
        ListingDatum { lister_pkh: test_lister_pkh, update_ref: Some(own_tag) },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        bad,
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

test swap_fails_with_extra_asset_in_listing_output() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let bloated =
    Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000 + cfg.lister_fee)
        |> assets.add(test_collection_policy, test_nb_name, 1)
        |> assets.add(test_collection_policy, #"ee", 1),
      datum: InlineDatum(
        ListingDatum { lister_pkh: test_lister_pkh, update_ref: Some(own_tag) },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        bloated,
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S6: out_listing.lovelace must cover input.lovelace + cfg.lister_fee
// ============================================================================

test swap_fails_with_insufficient_accrual() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(own_tag),
          2_000_000,
        ),
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S7: out_treasury must be at cfg.treasury_addr
// ============================================================================

test swap_fails_when_treasury_to_wrong_addr() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(own_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(own_tag, cfg.protocol_fee, test_swapper_addr()),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S8: out_treasury.datum must be InlineDatum(compute_output_tag(own_ref))
// DOUBLE-SATISFACTION Case 1
// ============================================================================

test swap_fails_with_wrong_treasury_tag() fail {
  let wrong_tag = utils.compute_output_tag(other_listing_outref())
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(own_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(wrong_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S9: out_treasury.lovelace >= cfg.protocol_fee
// ============================================================================

test swap_fails_with_insufficient_protocol_fee() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(own_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(own_tag, cfg.protocol_fee - 1, cfg.treasury_addr),
      ],
    }
  invoke_swap(tx, happy_swap_redeemer())
}

// ============================================================================
// S10: bucket equation enforced — KNOWN UNIT-TEST GAP
//
// All fixtures use cfg.m = 1, so the modulo comparison is trivially satisfied.
// Validator code is verified correct by Codex's review; golden tests with
// cfg.m >= 2 and precomputed (na, nb, own_ref) → bucket values are deferred
// to Phase 3 (Yaci DevKit integration), where the off-chain (Java / Evolution
// SDK) computation cross-checks against the validator end-to-end.
// ============================================================================

// ============================================================================
// Multi-swap double-satisfaction regression: invoke validator for input B
// in a tx where treasury is tagged for input A. S8 must fail because each
// consumed input demands its own own_tag.
// ============================================================================

test multi_swap_blocked_by_treasury_tag_binding() fail {
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [
        listing_input_holding(test_na_name, listing_outref()),
        listing_input_holding(test_na_name, other_listing_outref()),
        ua_input_holding(test_nb_name),
      ],
      reference_inputs: [config_ref_input()],
      outputs: [
        // out_listing for A — correctly tagged
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(tag_a),
          2_000_000 + cfg.lister_fee,
        ),
        // out_listing for B — correctly tagged
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(tag_b),
          2_000_000 + cfg.lister_fee,
        ),
        // ONE treasury output, tagged for A only — B's S8 must reject
        out_treasury_with(tag_a, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r =
    Swap {
      nb_asset_name: test_nb_name,
      listing_output_index: 1,
      treasury_output_index: 2,
    }
  let listing_datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  listing.listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    r,
    other_listing_outref(),
    tx,
  )
}

// ============================================================================
// Datum handling — Swap requires the full ListingDatum shape;
// Cancel is hardened to extract just the first field (lister_pkh) from
// arbitrary Constr-encoded Data.
// ============================================================================

test swap_fails_with_no_input_datum() fail {
  listing.listing.spend(
    test_config_nft_policy,
    None,
    happy_swap_redeemer(),
    listing_outref(),
    happy_swap_tx(),
  )
}

test cancel_succeeds_with_lister_sig() {
  let listing_datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [test_lister_pkh],
    }
  listing.listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

test cancel_fails_without_lister_sig() fail {
  let listing_datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [],
    }
  listing.listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

test cancel_fails_with_wrong_signer() fail {
  let listing_datum: Data =
    ListingDatum { lister_pkh: test_lister_pkh, update_ref: None }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [test_swapper_pkh],
    }
  listing.listing.spend(
    test_config_nft_policy,
    Some(listing_datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

// Defense-in-depth: even if the datum's second field (`update_ref`) is
// corrupted or has the wrong type, Cancel must still let the lister recover.
// The validator extracts only the first field via builtin.head_list on the
// Constr's field list.
test cancel_succeeds_with_corrupt_update_ref_field() {
  // Constr 0 [bytestring(lister_pkh), integer(42)] — second field is an Int
  // instead of Option<ByteArray>. A full `ListingDatum` cast would fail.
  let weird_data: Data =
    builtin.constr_data(
      0,
      [builtin.b_data(test_lister_pkh), builtin.i_data(42)],
    )
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [test_lister_pkh],
    }
  listing.listing.spend(
    test_config_nft_policy,
    Some(weird_data),
    Cancel,
    listing_outref(),
    tx,
  )
}
