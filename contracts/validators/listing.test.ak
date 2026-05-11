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

// 28-byte hashes
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

// Asset names for NA and NB (arbitrary; M=1 means bucket math is trivial)
const test_na_name = #"4e41"

// "NA"
const test_nb_name = #"4e42"

// "NB"

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
    // M=1 so bucket math is always satisfied
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

/// Build a complete, well-formed swap transaction for the canonical happy path.
/// Tests perturb individual fields to verify each invariant.
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
      // out_listing — index 0
      out_listing_holding(
        test_nb_name,
        test_lister_pkh,
        Some(own_tag),
        2_000_000 + cfg.lister_fee,
      ),
      // out_treasury — index 1
      out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
    ],
  }
}

fn happy_swap_redeemer(
  nb_input_index: Int,
  listing_output_index: Int,
  treasury_output_index: Int,
) {
  Swap {
    na_asset_name: test_na_name,
    nb_asset_name: test_nb_name,
    nb_input_index,
    listing_output_index,
    treasury_output_index,
  }
}

fn invoke_swap(tx: Transaction, redeemer: ListingRedeemer) -> Bool {
  let datum =
    Some(ListingDatum { lister_pkh: test_lister_pkh, update_ref: None })
  listing.listing.spend(
    test_config_nft_policy,
    datum,
    redeemer,
    listing_outref(),
    tx,
  )
}

// ============================================================================
// Happy path
// ============================================================================

test swap_succeeds() {
  let tx = happy_swap_tx()
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S1: config ref input must be findable under config_nft_policy
// ============================================================================

test swap_fails_without_config_ref_input() fail {
  let tx = Transaction { ..happy_swap_tx(), reference_inputs: [] }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S2: input.value must strictly contain (collection_policy, na_asset_name) × 1
// ============================================================================

test swap_fails_when_input_has_wrong_na() fail {
  // Listing input actually holds a DIFFERENT asset than the redeemer claims
  let bad_input = listing_input_holding(test_nb_name, listing_outref())
  let tx =
    Transaction {
      ..happy_swap_tx(),
      inputs: [bad_input, ua_input_holding(test_nb_name)],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S3: tx.inputs[nb_input_index] must contain (collection_policy, nb_asset_name)
// ============================================================================

test swap_fails_when_nb_input_index_points_wrong() fail {
  // nb_input_index points at the listing input (which has NA, not NB)
  let r = happy_swap_redeemer(0, 0, 1)
  invoke_swap(happy_swap_tx(), r)
}

// ============================================================================
// S4: out_listing must be at the same script address
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
          // wrong address
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S5: out_listing.datum.lister_pkh must match input.lister_pkh
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
          // swapper rewrites lister!
          Some(own_tag),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S6: out_listing.update_ref must equal compute_output_tag(self.outRef)
// (DOUBLE-SATISFACTION CASE 2)
// ============================================================================

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
          // tagged for OTHER listing — double-sat attempt
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(
          utils.compute_output_tag(listing_outref()),
          cfg.protocol_fee,
          cfg.treasury_addr,
        ),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
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
          // never None on a swap output
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(
          utils.compute_output_tag(listing_outref()),
          cfg.protocol_fee,
          cfg.treasury_addr,
        ),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S7: out_listing.value strictly contains (collection_policy, nb_asset_name)
// ============================================================================

test swap_fails_with_extra_asset_in_listing_output() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  // Output has the right NB AND a stray asset
  let bloated =
    Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000 + cfg.lister_fee)
        |> assets.add(test_collection_policy, test_nb_name, 1)
        |> assets.add(test_collection_policy, "extra_asset_padding_27_bytes", 1),
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S8: out_listing.lovelace must cover input + lister_fee
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
        // Missing the +1 ADA lister_fee
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S9: out_treasury must be at cfg.treasury_addr
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S10: out_treasury.datum must be compute_output_tag(self.outRef)
// (DOUBLE-SATISFACTION CASE 1)
// ============================================================================

test swap_fails_with_wrong_treasury_tag() fail {
  let wrong_tag = utils.compute_output_tag(other_listing_outref())
  let cfg = valid_config_datum()
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        out_listing_holding(
          test_nb_name,
          test_lister_pkh,
          Some(utils.compute_output_tag(listing_outref())),
          2_000_000 + cfg.lister_fee,
        ),
        out_treasury_with(wrong_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S11: out_treasury.lovelace >= cfg.protocol_fee
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// S12: bucket equation
// ============================================================================
// With cfg.m = 1, the bucket equation is trivially satisfied (everything %1 == 0),
// so swap_succeeds above already exercises the equation along the happy path.
//
// A proper failure case requires picking (na, nb, ua_outref) for cfg.m >= 2 such
// that buckets differ — currently deferred to integration tests on Yaci DevKit,
// where the off-chain (Java/Evolution) computation can be cross-checked against
// the validator. See SPEC §12 — golden tests are planned across off-chain+on-chain.

// ============================================================================
// Cancel
// ============================================================================

test cancel_succeeds_with_lister_sig() {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [test_lister_pkh],
    }
  invoke_swap(tx, Cancel)
}

test cancel_fails_without_lister_sig() fail {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [],
    }
  invoke_swap(tx, Cancel)
}

test cancel_fails_with_wrong_signer() fail {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [listing_input_holding(test_na_name, listing_outref())],
      extra_signatories: [test_swapper_pkh],
    }
  invoke_swap(tx, Cancel)
}

// ============================================================================
// Broader negatives for S2/S7 — added 2026-05-11 after Codex review of v0.3.
// is_strict_single_nft is correct, but the original tests only covered "extra
// asset". These pin the wrong-policy and wrong-quantity rejection paths too.
// ============================================================================

// A different 28-byte policy id, not used for any of our assets.
const wrong_collection_policy =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

test swap_fails_when_input_has_correct_name_but_wrong_policy() fail {
  let bad_input =
    Input {
      output_reference: listing_outref(),
      output: Output {
        address: test_listing_addr(),
        value: assets.from_lovelace(2_000_000)
          |> assets.add(wrong_collection_policy, test_na_name, 1),
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

test swap_fails_when_input_has_quantity_2() fail {
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
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

test swap_fails_when_out_listing_under_wrong_policy() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let bad_output =
    Output {
      address: test_listing_addr(),
      value: assets.from_lovelace(2_000_000 + cfg.lister_fee)
        |> assets.add(wrong_collection_policy, test_nb_name, 1),
      datum: InlineDatum(
        ListingDatum { lister_pkh: test_lister_pkh, update_ref: Some(own_tag) },
      ),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..happy_swap_tx(),
      outputs: [
        bad_output,
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

test swap_fails_when_out_listing_has_quantity_2() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let cfg = valid_config_datum()
  let bad_output =
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
        bad_output,
        out_treasury_with(own_tag, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  let r = happy_swap_redeemer(1, 0, 1)
  invoke_swap(tx, r)
}

// ============================================================================
// nb_input_index boundary tests — pin negative/out-of-range index handling
// (added 2026-05-11 after Codex review of v0.3).
// ============================================================================

test swap_fails_with_negative_nb_input_index() fail {
  let r = happy_swap_redeemer(-1, 0, 1)
  invoke_swap(happy_swap_tx(), r)
}

test swap_fails_with_out_of_range_nb_input_index() fail {
  let r = happy_swap_redeemer(99, 0, 1)
  invoke_swap(happy_swap_tx(), r)
}

// ============================================================================
// Multi-swap double-satisfaction regression — Codex Finding 3 (v0.3 review).
//
// SPEC §6.3 S6 (out_listing.update_ref) and S10 (out_treasury.datum) bind each
// consumed input to a uniquely-tagged output. Per-input `own_tag` is computed
// from `own_ref`, so the check is per-input and cannot be satisfied
// transaction-globally by a single shared output.
//
// This test invokes the validator for input B in a transaction where the
// treasury output is tagged for input A (a real double-satisfaction attempt).
// The validator must fail S10 because the tag binds to A, not B.
// ============================================================================

test multi_swap_blocked_by_treasury_tag_binding() fail {
  let tag_a = utils.compute_output_tag(listing_outref())
  // a = "primary" listing
  let tag_b = utils.compute_output_tag(other_listing_outref())
  // b = the one we invoke for
  let cfg = valid_config_datum()
  // Build a tx that LOOKS valid for input A (shared treasury, both listing
  // outputs tagged correctly), but we invoke the validator with B's own_ref.
  // The treasury is tagged for A only — B's validator call must fail S10.
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
        // out_listing for A
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
        // ONLY ONE treasury output, tagged for A — B's S10 will fail
        out_treasury_with(tag_a, cfg.protocol_fee, cfg.treasury_addr),
      ],
    }
  // Invoke for input B: own_ref = other_listing_outref()
  let datum =
    Some(ListingDatum { lister_pkh: test_lister_pkh, update_ref: None })
  let r =
    Swap {
      na_asset_name: test_na_name,
      nb_asset_name: test_nb_name,
      nb_input_index: 2,
      // UA at index 2
      listing_output_index: 1,
      // B's listing output
      treasury_output_index: 2,
    }
  listing.listing.spend(
    test_config_nft_policy,
    datum,
    r,
    other_listing_outref(),
    tx,
  )
}

// ============================================================================
// Listing UTxOs created without a datum should be unspendable. The spend
// handler does `expect Some(input_datum) = datum`, which fails on NoDatum
// (Option<...> is None when the datum is missing).
// ============================================================================

test swap_fails_with_no_input_datum() fail {
  // Invoke spend with `None` instead of `Some(datum)`.
  let r = happy_swap_redeemer(1, 0, 1)
  listing.listing.spend(
    test_config_nft_policy,
    None,
    r,
    listing_outref(),
    happy_swap_tx(),
  )
}
// ============================================================================
// S12 (bucket equation) — KNOWN TEST GAP
//
// All current swap fixtures use cfg.m = 1, so the modulo comparison is
// trivially satisfied. The validator implementation is verified by Codex to
// be correct (uses ua.output_reference + cbor.serialise as the spec requires),
// but a "broken hash input order" or "wrong CBOR seed" bug would not be
// caught by these unit tests.
//
// Golden tests with cfg.m >= 2 and precomputed (na, nb, ua_outref) → bucket
// values are deferred to Phase 3 (Yaci DevKit integration), where the
// off-chain Java/Evolution computation can be cross-checked end-to-end
// against the validator. Tracking: SPEC §12 "Test strategy → Property-based
// tests".
// ============================================================================
