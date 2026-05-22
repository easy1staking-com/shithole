use aiken/fuzz
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{ada_asset_name, ada_policy_id}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use jar.{Deposit, JarDatum, Sweep}
use shithole/utils

// ============================================================================
// Fixtures
// ============================================================================

const test_admin_pkh =
  #"44444444444444444444444444444444444444444444444444444444"

const test_other_pkh =
  #"99999999999999999999999999999999999999999999999999999999"

const test_jar_script_hash =
  #"00000000000000000000000000000000000000000000000000000077"

const test_fee_policy =
  #"feefeefeefeefeefeefeefeefeefeefeefeefeefeefeefeefeefeefe"

const test_fee_name = #"534849"

// "SHI"

const test_other_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_other_name = #"4f4c44"

// "OLD"

fn jar_addr() -> Address {
  Address {
    payment_credential: Script(test_jar_script_hash),
    stake_credential: None,
  }
}

fn wallet_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_admin_pkh),
    stake_credential: None,
  }
}

fn jar_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000077",
    output_index: 0,
  }
}

fn other_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000088",
    output_index: 0,
  }
}

/// Second jar's outref for multi-input merge tests.
fn jar_b_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000078",
    output_index: 0,
  }
}

/// Standalone jar input at a caller-chosen outref, carrying lovelace + an
/// optional fee-token balance. Used by the multi-input merge fixtures.
fn jar_input_at(
  outref: OutputReference,
  base_ada: Int,
  existing_fee: Int,
) -> Input {
  let v0 = assets.from_lovelace(base_ada)
  let v = if existing_fee > 0 {
    assets.add(v0, test_fee_policy, test_fee_name, existing_fee)
  } else {
    v0
  }
  Input {
    output_reference: outref,
    output: Output {
      address: jar_addr(),
      value: v,
      datum: InlineDatum(JarDatum { update_ref: #"deadbeef" }),
      reference_script: None,
    },
  }
}

/// A jar input at `jar_outref()` carrying `base_ada` lovelace, `existing_fee`
/// of the fee token, and `existing_other` of an unrelated CNT (to verify
/// non-fee-asset preservation across deposits). The seed `update_ref` value
/// is arbitrary — the validator never reads input.datum.update_ref; only the
/// recreated output's tag matters.
fn jar_input(base_ada: Int, existing_fee: Int, existing_other: Int) -> Input {
  let v0 = assets.from_lovelace(base_ada)
  let v1 = if existing_fee > 0 {
    assets.add(v0, test_fee_policy, test_fee_name, existing_fee)
  } else {
    v0
  }
  let v = if existing_other > 0 {
    assets.add(v1, test_other_policy, test_other_name, existing_other)
  } else {
    v1
  }
  Input {
    output_reference: jar_outref(),
    output: Output {
      address: jar_addr(),
      value: v,
      datum: InlineDatum(JarDatum { update_ref: #"deadbeef" }),
      reference_script: None,
    },
  }
}

fn jar_output_with(
  value: assets.Value,
  update_ref_tag: ByteArray,
  addr: Address,
) -> Output {
  Output {
    address: addr,
    value,
    datum: InlineDatum(JarDatum { update_ref: update_ref_tag }),
    reference_script: None,
  }
}

/// Canonical happy-path Deposit tx for the fee CNT.
fn happy_deposit_tx(qty: Int) -> Transaction {
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, qty)
  Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(expected_value, out_tag, jar_addr())],
  }
}

fn happy_deposit_redeemer(qty: Int) {
  Deposit {
    fee_token_policy: test_fee_policy,
    fee_token_name: test_fee_name,
    qty,
    output_index: 0,
  }
}

/// Canonical happy-path Sweep tx — admin pulls all fee tokens out into their
/// wallet, leaves min-ADA + the unrelated CNT on the recreated jar.
fn happy_sweep_tx() -> Transaction {
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  // Jar continues with just the ADA + the unrelated CNT (admin extracted the
  // fee tokens). The continuing UTxO's exact ADA/token contents are
  // unconstrained by the validator (admin's call).
  let continuing_value = assets.from_lovelace(2_000_000)
    |> assets.add(test_other_policy, test_other_name, 500)
  let admin_payout = assets.from_lovelace(1_500_000)
    |> assets.add(test_fee_policy, test_fee_name, 100)
  Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [
      jar_output_with(continuing_value, out_tag, jar_addr()),
      Output {
        address: wallet_addr(),
        value: admin_payout,
        datum: NoDatum,
        reference_script: None,
      },
    ],
    extra_signatories: [test_admin_pkh],
  }
}

fn happy_sweep_redeemer() {
  Sweep { output_index: 0 }
}

fn invoke_jar(
  input_datum: Option<Data>,
  redeemer: jar.JarRedeemer,
  tx: Transaction,
) -> Bool {
  jar.jar.spend(test_admin_pkh, input_datum, redeemer, jar_outref(), tx)
}

/// Multi-input variant — caller supplies the consumed jar's `own_ref` so we
/// can drive the validator separately for each input in a merge scenario.
fn invoke_jar_at(
  outref: OutputReference,
  input_datum: Option<Data>,
  redeemer: jar.JarRedeemer,
  tx: Transaction,
) -> Bool {
  jar.jar.spend(test_admin_pkh, input_datum, redeemer, outref, tx)
}

fn default_input_datum() -> Option<Data> {
  let d: Data = JarDatum { update_ref: #"deadbeef" }
  Some(d)
}

// ============================================================================
// Deposit — happy paths
// ============================================================================

test deposit_token_succeeds() {
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(7),
    happy_deposit_tx(7),
  )
}

test deposit_ada_succeeds() {
  // Sub-1-ADA fee, paid in ADA. Same code path; ADA is just a token with
  // empty policy + empty name in Cardano's value model.
  let in_ = jar_input(2_000_000, 0, 0)
  let out_tag = utils.compute_output_tag(jar_outref())
  let expected_value = in_.output.value
    |> assets.add(ada_policy_id, ada_asset_name, 250_000)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(expected_value, out_tag, jar_addr())],
  }
  let redeemer = Deposit {
    fee_token_policy: ada_policy_id,
    fee_token_name: ada_asset_name,
    qty: 250_000,
    output_index: 0,
  }
  invoke_jar(default_input_datum(), redeemer, tx)
}

test deposit_preserves_unrelated_token() {
  // Jar input has 500 of an unrelated CNT. After Deposit of 7 fee tokens,
  // the 500 unrelated must still be on the recreated jar. The single
  // value-equality check `out.value == add(in.value, fee_token, qty)`
  // covers preservation by construction; this test pins the property.
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(7),
    happy_deposit_tx(7),
  )
}

// ============================================================================
// Deposit — J1: qty > 0
// ============================================================================

test deposit_fails_when_qty_zero() fail {
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(0),
    happy_deposit_tx(0),
  )
}

test deposit_fails_when_qty_negative() fail {
  // qty < 0 would be a withdraw-via-Deposit attack — caller drains tokens
  // out of the jar into another output of their choosing. J1 kills it.
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(-5),
    happy_deposit_tx(-5),
  )
}

// ============================================================================
// Deposit — J2: continuing output must be at jar address
// ============================================================================

test deposit_fails_when_output_at_wrong_address() fail {
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(expected_value, out_tag, wallet_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

// ============================================================================
// Deposit — J3: update_ref must equal compute_output_tag(own_ref)
// ============================================================================

test deposit_fails_with_wrong_update_ref_tag() fail {
  let in_ = jar_input(2_000_000, 100, 500)
  let wrong_tag = utils.compute_output_tag(other_outref())
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(expected_value, wrong_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_with_garbage_update_ref() fail {
  let in_ = jar_input(2_000_000, 100, 500)
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(expected_value, #"00", jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

// ============================================================================
// Deposit — J4: value equality (exact delta + preservation of everything else)
// ============================================================================

test deposit_fails_when_value_unchanged() fail {
  // Caller claims qty=7 but the output value didn't actually change.
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(in_.output.value, out_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_with_extra_unrelated_token() fail {
  // Output has an EXTRA token (50 of a new policy) on top of the expected
  // delta. Value-equality rejects.
  let extra_policy = #"abababababababababababababababababababababababababababab"
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let bloated = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
    |> assets.add(extra_policy, #"ff", 50)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(bloated, out_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_when_unrelated_token_dropped() fail {
  // Caller drops the 500 unrelated CNT from the recreated jar. Value-equality
  // rejects — preservation isn't a separate check, it's baked into J4.
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let truncated = assets.from_lovelace(2_000_000)
    |> assets.add(test_fee_policy, test_fee_name, 107)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(truncated, out_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_when_ada_siphoned_during_token_deposit() fail {
  // Token deposit must NOT shrink the jar's ADA. (Attacker tries to pocket
  // 500_000 lovelace by reducing the continuing UTxO's ADA.)
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let drained = assets.from_lovelace(1_500_000)
    |> assets.add(test_fee_policy, test_fee_name, 107)
    |> assets.add(test_other_policy, test_other_name, 500)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(drained, out_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_when_redeemer_qty_mismatches_actual_delta() fail {
  // Redeemer claims qty=7, output actually credits +100. Value-equality
  // catches it (expected_value built from redeemer.qty).
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let real_delta = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 100)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(real_delta, out_tag, jar_addr())],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

// ============================================================================
// Deposit — non-inline output datum
// ============================================================================

test deposit_fails_when_output_datum_is_hash_referenced() fail {
  // Inline datum required so off-chain consumers can read update_ref without
  // resolving a hash.
  let in_ = jar_input(2_000_000, 100, 500)
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
  let hashed = Output {
    address: jar_addr(),
    value: expected_value,
    datum: DatumHash(
      #"0000000000000000000000000000000000000000000000000000000000000000",
    ),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [hashed],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

test deposit_fails_when_output_has_no_datum() fail {
  let in_ = jar_input(2_000_000, 100, 500)
  let expected_value = in_.output.value
    |> assets.add(test_fee_policy, test_fee_name, 7)
  let no_datum = Output {
    address: jar_addr(),
    value: expected_value,
    datum: NoDatum,
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [no_datum],
  }
  invoke_jar(default_input_datum(), happy_deposit_redeemer(7), tx)
}

// ============================================================================
// Deposit — input datum is permissive
// ============================================================================
//
// The validator does not constrain the consumed UTxO's datum. A NoDatum
// input (e.g. one accidentally pay-to-script'd at the jar address) is
// spendable via Deposit — the depositor's qty + the stuck value both flow
// into the recreated jar, so the protocol effectively gets free rescue of
// stuck UTxOs without a dedicated Rescue redeemer. Sweep / Consolidate
// stay admin-gated regardless.

test deposit_succeeds_when_input_has_no_datum() {
  invoke_jar(None, happy_deposit_redeemer(7), happy_deposit_tx(7))
}

// ============================================================================
// Sweep — happy paths
// ============================================================================

test sweep_admin_takes_all_fee_tokens() {
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), happy_sweep_tx())
}

test sweep_admin_can_drain_ada() {
  // Sweep does NOT enforce ADA preservation — admin can lower the jar's
  // ADA (Cardano-level min-UTxO will fail the tx if below floor). Here we
  // drop the jar's ADA to 1.5 ADA and the admin pockets the 0.5 ADA.
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let continuing = assets.from_lovelace(1_500_000)
    |> assets.add(test_other_policy, test_other_name, 500)
  let admin_payout = assets.from_lovelace(500_000)
    |> assets.add(test_fee_policy, test_fee_name, 100)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [
      jar_output_with(continuing, out_tag, jar_addr()),
      Output {
        address: wallet_addr(),
        value: admin_payout,
        datum: NoDatum,
        reference_script: None,
      },
    ],
    extra_signatories: [test_admin_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

test sweep_admin_can_top_up() {
  // Sweep also lets the admin ADD value to the jar (no upper bound either).
  // Useful for replenishing min-UTxO if Cardano params raise the floor.
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  let topped_up = assets.from_lovelace(5_000_000)
    |> assets.add(test_fee_policy, test_fee_name, 100)
    |> assets.add(test_other_policy, test_other_name, 500)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(topped_up, out_tag, jar_addr())],
    extra_signatories: [test_admin_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

// ============================================================================
// Sweep — K1: admin signature required
// ============================================================================

test sweep_fails_without_admin_signature() fail {
  let tx = Transaction { ..happy_sweep_tx(), extra_signatories: [] }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

test sweep_fails_with_wrong_signer() fail {
  let tx = Transaction {
    ..happy_sweep_tx(),
    extra_signatories: [test_other_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

// ============================================================================
// Sweep — K2: continuing output must be at jar address
// ============================================================================

test sweep_fails_when_output_at_wrong_address() fail {
  let in_ = jar_input(2_000_000, 100, 500)
  let out_tag = utils.compute_output_tag(jar_outref())
  // Admin tries to migrate the jar to a wallet address (would lose protocol
  // continuity).
  let continuing = assets.from_lovelace(2_000_000)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(continuing, out_tag, wallet_addr())],
    extra_signatories: [test_admin_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

// ============================================================================
// Sweep — datum on the continuing output is intentionally unconstrained
// ============================================================================
//
// The admin chose the tx; the protocol only cares that SOMETHING continues at
// the jar address. The continuing UTxO may carry any tag (or no datum at
// all); the next Deposit forces a proper JarDatum on its own output.

test sweep_succeeds_with_wrong_update_ref_tag() {
  // Demonstrates that the datum-tag check from earlier iterations is gone:
  // admin can recreate the jar with any update_ref value.
  let in_ = jar_input(2_000_000, 100, 500)
  let wrong_tag = utils.compute_output_tag(other_outref())
  let continuing = assets.from_lovelace(2_000_000)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [jar_output_with(continuing, wrong_tag, jar_addr())],
    extra_signatories: [test_admin_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

test sweep_succeeds_with_no_datum_on_continuing_output() {
  // Admin produces a continuing carrier with NoDatum. Valid — the next
  // Deposit forces a JarDatum (via J3's expect-cast on the output).
  let in_ = jar_input(2_000_000, 100, 500)
  let continuing = assets.from_lovelace(2_000_000)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [in_],
    outputs: [
      Output {
        address: jar_addr(),
        value: continuing,
        datum: NoDatum,
        reference_script: None,
      },
    ],
    extra_signatories: [test_admin_pkh],
  }
  invoke_jar(default_input_datum(), happy_sweep_redeemer(), tx)
}

// ============================================================================
// Property tests
// ============================================================================

/// Any qty > 0 produces a valid deposit when the output is built to match.
test prop_deposit_succeeds_for_positive_qty(
  qty via fuzz.int_between(1, 1_000_000_000),
) {
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(qty),
    happy_deposit_tx(qty),
  )
}

/// Any qty <= 0 is rejected by J1 (qty > 0), regardless of how the output
/// is built. We pair the redeemer with a tx whose output already matches
/// `add(in.value, fee_token, qty)` so the failure is unambiguously J1 and
/// not a value-equality failure.
test prop_deposit_rejects_non_positive_qty(
  qty via fuzz.int_between(-1_000_000, 0),
) fail {
  invoke_jar(
    default_input_datum(),
    happy_deposit_redeemer(qty),
    happy_deposit_tx(qty),
  )
}

// ============================================================================
// Multi-jar merge — both inputs use Sweep (Consolidate was redundant once
// the tag check was dropped from the admin path).
// ============================================================================
//
// Canonical 2-in-1-out merge:
//   Input A (jar_outref):   2 ADA + 100 fee tokens
//   Input B (jar_b_outref): 2 ADA +  50 fee tokens
//   Output: 4 ADA + 150 fee tokens at jar address (any datum admin chooses).
//
// Each spend invocation runs the validator on ONE input. A full multi-input
// validation = invoke both, AND the results. With the simplified Sweep,
// BOTH inputs can use Sweep — admin's signature is the trust anchor.

fn merge_two_jars_tx() -> Transaction {
  let in_a = jar_input_at(jar_outref(), 2_000_000, 100)
  let in_b = jar_input_at(jar_b_outref(), 2_000_000, 50)
  // Any tag here is fine — Sweep no longer enforces datum equality. Using
  // jar_outref's tag for realism (an admin tool might still tag for ease of
  // off-chain tracking).
  let merge_tag = utils.compute_output_tag(jar_outref())
  let merged_value = assets.from_lovelace(4_000_000)
    |> assets.add(test_fee_policy, test_fee_name, 150)
  Transaction {
    ..transaction.placeholder,
    inputs: [in_a, in_b],
    outputs: [jar_output_with(merged_value, merge_tag, jar_addr())],
    extra_signatories: [test_admin_pkh],
  }
}

test merge_two_jars_with_two_sweeps_succeeds() {
  // Both inputs use Sweep, both succeed. Admin's signature subsumes any
  // inter-input double-sat concern — there's no exploit when the spender
  // controls the whole tx.
  let tx = merge_two_jars_tx()
  let sweep_a_ok =
    invoke_jar_at(
      jar_outref(),
      default_input_datum(),
      Sweep { output_index: 0 },
      tx,
    )
  let sweep_b_ok =
    invoke_jar_at(
      jar_b_outref(),
      default_input_datum(),
      Sweep { output_index: 0 },
      tx,
    )
  sweep_a_ok && sweep_b_ok
}

test merge_two_jars_fails_without_admin_signature_on_either_input() {
  // Admin signature is per-tx; if it's missing, BOTH Sweep invocations
  // fail. Encoded as a single conjunction: tx is invalid iff both refuse.
  let tx = Transaction { ..merge_two_jars_tx(), extra_signatories: [] }
  let sweep_a_ok =
    invoke_jar_at(
      jar_outref(),
      default_input_datum(),
      Sweep { output_index: 0 },
      tx,
    )
  let sweep_b_ok =
    invoke_jar_at(
      jar_b_outref(),
      default_input_datum(),
      Sweep { output_index: 0 },
      tx,
    )
  !sweep_a_ok && !sweep_b_ok
}
