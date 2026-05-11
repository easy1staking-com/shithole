use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use config
use shithole/types.{ConfigDatum, min_lister_fee}

// ============================================================================
// Test fixtures
// ============================================================================

const test_seed_tx_hash =
  #"0000000000000000000000000000000000000000000000000000000000000001"

// Policy id of the config validator (= its compiled hash). 28 bytes.
const test_config_policy =
  #"00000000000000000000000000000000000000000000000000000099"

// 28-byte asset name = the collection policy id this config governs.
const test_collection_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_admin_pkh =
  #"00000000000000000000000000000000000000000000000000000001"

const test_new_admin_pkh =
  #"00000000000000000000000000000000000000000000000000000077"

const test_treasury_pkh =
  #"00000000000000000000000000000000000000000000000000000033"

fn test_seed_utxo() -> OutputReference {
  OutputReference { transaction_id: test_seed_tx_hash, output_index: 0 }
}

fn test_treasury_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_treasury_pkh),
    stake_credential: None,
  }
}

fn test_config_addr() -> Address {
  Address {
    payment_credential: Script(test_config_policy),
    stake_credential: None,
  }
}

fn valid_config_datum() -> ConfigDatum {
  ConfigDatum {
    m: 3,
    protocol_fee: 1_000_000,
    lister_fee: 1_000_000,
    treasury_addr: test_treasury_addr(),
    admin_pkh: test_admin_pkh,
  }
}

fn seed_input() -> Input {
  Input {
    output_reference: test_seed_utxo(),
    output: Output {
      address: Address {
        payment_credential: VerificationKey(test_admin_pkh),
        stake_credential: None,
      },
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn mint_output_with(asset_name: ByteArray, datum: ConfigDatum) -> Output {
  Output {
    address: test_config_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_config_policy, asset_name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn mint_output() -> Output {
  mint_output_with(test_collection_policy, valid_config_datum())
}

// ============================================================================
// Mint handler tests (M1-M4)
// ============================================================================

test mint_succeeds() {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output()],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
      extra_signatories: [test_admin_pkh],
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_without_seed_consumed() fail {
  let other_ref =
    OutputReference { transaction_id: test_seed_tx_hash, output_index: 99 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [Input { ..seed_input(), output_reference: other_ref }],
      outputs: [mint_output()],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_quantity_2() fail {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output()],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 2),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_two_asset_names() fail {
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1)
        |> assets.merge(
            assets.from_asset(
              test_config_policy,
              "another_collection_padding00",
              1,
            ),
          ),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_short_asset_name() fail {
  // 4 bytes instead of 28
  let short_name = #"deadbeef"
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output_with(short_name, valid_config_datum())],
      mint: assets.from_asset(test_config_policy, short_name, 1),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_m_zero() fail {
  let bad_datum = ConfigDatum { ..valid_config_datum(), m: 0 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output_with(test_collection_policy, bad_datum)],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_lister_fee_below_floor() fail {
  let bad_datum =
    ConfigDatum { ..valid_config_datum(), lister_fee: min_lister_fee - 1 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output_with(test_collection_policy, bad_datum)],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_fails_with_negative_protocol_fee() fail {
  let bad_datum = ConfigDatum { ..valid_config_datum(), protocol_fee: -1 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output_with(test_collection_policy, bad_datum)],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

test mint_succeeds_with_zero_protocol_fee() {
  let datum = ConfigDatum { ..valid_config_datum(), protocol_fee: 0 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output_with(test_collection_policy, datum)],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
      extra_signatories: [test_admin_pkh],
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

// ============================================================================
// Spend handler tests (C1-C6)
// ============================================================================

fn config_input_with_datum(oref: OutputReference, datum: ConfigDatum) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: test_config_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_config_policy, test_collection_policy, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn config_output_with_datum(datum: ConfigDatum) -> Output {
  Output {
    address: test_config_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_config_policy, test_collection_policy, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn own_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000002",
    output_index: 0,
  }
}

test spend_succeeds() {
  let datum = valid_config_datum()
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      outputs: [config_output_with_datum(datum)],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}

test spend_fails_without_admin_sig() fail {
  let datum = valid_config_datum()
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      outputs: [config_output_with_datum(datum)],
      extra_signatories: [],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}

test spend_fails_without_continuing_output() fail {
  let datum = valid_config_datum()
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      // Send the NFT somewhere else
      outputs: [
        Output {
          address: Address {
            payment_credential: VerificationKey(test_admin_pkh),
            stake_credential: None,
          },
          value: assets.from_lovelace(2_000_000)
            |> assets.add(test_config_policy, test_collection_policy, 1),
          datum: InlineDatum(datum),
          reference_script: None,
        },
      ],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}

test spend_fails_with_m_zero_on_output() fail {
  let datum = valid_config_datum()
  let bad_datum = ConfigDatum { ..datum, m: 0 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      outputs: [config_output_with_datum(bad_datum)],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}

test spend_fails_with_lister_fee_below_floor_on_output() fail {
  let datum = valid_config_datum()
  let bad_datum = ConfigDatum { ..datum, lister_fee: min_lister_fee - 1 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      outputs: [config_output_with_datum(bad_datum)],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}

test spend_succeeds_with_admin_rotation_both_sign() {
  let in_datum = valid_config_datum()
  let out_datum = ConfigDatum { ..in_datum, admin_pkh: test_new_admin_pkh }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), in_datum)],
      outputs: [config_output_with_datum(out_datum)],
      extra_signatories: [test_admin_pkh, test_new_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(in_datum), 0, own_ref(), tx)
}

test spend_fails_with_rotation_missing_new_admin_sig() fail {
  let in_datum = valid_config_datum()
  let out_datum = ConfigDatum { ..in_datum, admin_pkh: test_new_admin_pkh }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), in_datum)],
      outputs: [config_output_with_datum(out_datum)],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(in_datum), 0, own_ref(), tx)
}

test spend_fails_with_rotation_missing_old_admin_sig() fail {
  let in_datum = valid_config_datum()
  let out_datum = ConfigDatum { ..in_datum, admin_pkh: test_new_admin_pkh }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), in_datum)],
      outputs: [config_output_with_datum(out_datum)],
      extra_signatories: [test_new_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(in_datum), 0, own_ref(), tx)
}

// ============================================================================
// Accepted footgun: extra output at config script address
// ============================================================================
//
// The validator uses `list.expect_find`, which proves AT LEAST ONE matching
// output exists. A careless transaction could include a second, junk output
// at the config address — that UTxO has no protocol meaning (it carries no
// config NFT, since one-shot mint guarantees the config NFT exists on
// exactly one UTxO chain-wide), and the ADA on it is locked behind the
// spend validator forever. This hurts only whoever sent the extra output.
//
// See the ACCEPTED FOOTGUN block at the top of `config.ak`. We deliberately
// do NOT enforce uniqueness — fold-and-count costs more cpu/mem than the
// self-injurious nature of this mistake warrants.

test mint_accepts_extra_junk_output_at_script_address() {
  // Two outputs at the config address. The first is well-formed; the second
  // is junk (no NFT, no datum). The validator passes because it finds the
  // legitimate one via `list.expect_find` and ignores the junk.
  let junk_output =
    Output {
      address: test_config_addr(),
      value: assets.from_lovelace(1_500_000),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [seed_input()],
      outputs: [mint_output(), junk_output],
      mint: assets.from_asset(test_config_policy, test_collection_policy, 1),
      extra_signatories: [test_admin_pkh],
    }
  config.config.mint(test_seed_utxo(), 0, test_config_policy, tx)
}

// ============================================================================
// Spend-path datum-floor negative pinned on the spend side too.
// ============================================================================

test spend_fails_with_negative_protocol_fee_on_output() fail {
  let datum = valid_config_datum()
  let bad_datum = ConfigDatum { ..datum, protocol_fee: -1 }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [config_input_with_datum(own_ref(), datum)],
      outputs: [config_output_with_datum(bad_datum)],
      extra_signatories: [test_admin_pkh],
    }
  config.config.spend(test_seed_utxo(), Some(datum), 0, own_ref(), tx)
}
