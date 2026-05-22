use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use shithole/utils

// ============================================================================
// Jar — token / micro-ADA fee accumulator
//
// A jar is a long-lived UTxO at this validator's address that collects fees.
// Each Deposit spends the jar and recreates it at the same address with
// `value += qty` for the redeemer-named (policy, name). Because the jar's
// min-UTxO ADA was paid once at creation and is preserved across deposits,
// fee deltas have no per-tx min-UTxO floor — sub-1-ADA fees and fees
// denominated in any CNT both become feasible (the same code path handles
// ADA when the redeemer's policy/name is the empty bytes pair).
//
// Class-A double satisfaction (two consumed jars sharing a single continuing
// output) is prevented ON THE DEPOSIT PATH by tagging the recreated jar's
// datum with `compute_output_tag(own_ref)`. The redeemer carries an
// `output_index` hint so the validator never has to scan `tx.outputs`.
//
// Class-B double satisfaction (a calling pit / p2p / marketplace validator
// believing the jar deposit credits ITS swap when it actually credits another)
// is addressed in the CALLING validator — typically by forbidding multi-listing
// batching in a single tx, or by tagging a fee-side output the caller controls.
// Not the jar's concern.
//
// Sweep is admin-only and intentionally permissive: the admin's signature is
// the trust anchor for value distribution. The only structural invariant is
// that SOMETHING continues at the jar address — a footgun guard against
// accidentally retiring the jar group, not a security check. No datum
// constraint on Sweep's continuing output: a NoDatum carrier UTxO is
// self-healed by the next Deposit (which DOES require its output to have a
// JarDatum). Multi-jar merges and other admin operations all collapse into
// this one redeemer.
//
// Parameterized on `admin_pkh`: distinct admin -> distinct script hash ->
// distinct jar address. One contract serves many fee tokens; jars are
// horizontally shardable (N UTxOs at the same address) without any validator
// change — sharding is purely an off-chain (FE / indexer) concern.
// ============================================================================

pub type JarDatum {
  /// Anti-double-sat binding for the Deposit-created continuing UTxO. On
  /// every Deposit the recreated jar's `update_ref` must equal
  /// `compute_output_tag(consumed_jar.out_ref)`. The seed (initial) jar
  /// created by the admin can carry any value here — the validator does not
  /// run on creation, and the first Deposit overwrites it. Sweep does not
  /// touch this field; admin can carry whatever value (or no datum at all)
  /// on the continuing UTxO.
  update_ref: ByteArray,
}

pub type JarRedeemer {
  /// Anyone-callable: caller adds `qty` of `(fee_token_policy, fee_token_name)`
  /// to the jar. `output_index` points to the continuing jar UTxO in
  /// `tx.outputs` for O(1) lookup.
  Deposit {
    fee_token_policy: PolicyId,
    fee_token_name: AssetName,
    qty: Int,
    output_index: Int,
  }
  /// Admin-only. Value distribution across the tx is admin's call (Cardano-
  /// level min-UTxO will fail the tx if the continuing UTxO falls below the
  /// protocol floor). The only structural invariants: admin signed, and at
  /// least one output exists at the jar address. This single redeemer covers
  /// both single-jar withdrawals AND multi-jar merges (N inputs -> M outputs,
  /// M < N) — the admin's signature subsumes any inter-input double-sat
  /// concern, so no per-input tag binding is needed on this path.
  Sweep { output_index: Int }
}

validator jar(admin_pkh: VerificationKeyHash) {
  spend(
    _datum: Option<Data>,
    redeemer: JarRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    let Transaction { inputs, outputs, .. } = self
    expect Some(own_input) = find_input(inputs, own_ref)

    when redeemer is {
      Deposit { fee_token_policy, fee_token_name, qty, output_index } -> {
        // J1: positive delta — prevents withdraw-via-Deposit (negative qty)
        //     and silent no-ops (zero qty).
        expect qty > 0
        // O(1) lookup of the continuing output.
        let out = list.expect_at(outputs, output_index)
        // J2: continuing UTxO at the jar script address.
        expect out.address == own_input.output.address
        // Expected post-deposit value: input + delta on (policy, name). All
        // other assets (and ADA, when the fee token is a CNT) are preserved
        // by single-equality with the assembled value.
        let expected_value =
          own_input.output.value
            |> assets.add(fee_token_policy, fee_token_name, qty)
        expect InlineDatum(out_data) = out.datum
        expect out_datum: JarDatum = out_data
        let expected_datum =
          JarDatum { update_ref: utils.compute_output_tag(own_ref) }
        // J3: anti-double-sat tag binds this output to THIS consumed input.
        expect expected_datum == out_datum
        // J4: exact value preservation + exact delta. One equality covers
        //     "the right token went up by exactly qty" AND "nothing else
        //     changed" — no scanning, no per-asset checks.
        (expected_value == out.value)?
      }

      Sweep { output_index } -> {
        let out = list.expect_at(outputs, output_index)
        and {
          // K1: admin authorization — the trust anchor for value movement.
          //     Cheap list scan; runs before the address resolution so a
          //     bad-signer tx fails before any extra work.
          utils.signed_by(self, admin_pkh)?,
          // K2: at least one output continues at the jar address. Datum
          //     on this output is intentionally unconstrained — admin can
          //     carry a JarDatum, NoDatum, or any inline shape. The next
          //     Deposit will force a proper JarDatum on its own output
          //     (J3 cast), so any NoDatum carrier left behind self-heals.
          (out.address == own_input.output.address)?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
