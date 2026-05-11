use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}
use shithole/types.{ConfigDatum, is_valid_config_datum}
use shithole/utils

// ============================================================================
// Config validator — multi-handler (mint + spend).
//
// Compiled hash is BOTH the policy id of the one-shot config NFT AND the
// script credential of the address holding the config UTxO. Same script
// mints and controls spending — continuing-UTxO property comes for free.
//
// Parameterized by `seed_utxo: OutputReference`. The seed UTxO must be
// consumed at mint time; once spent it can never be respent, so the mint
// handler can fire at most once. The asset name minted IS the
// `collection_policy_id` (28 bytes, enforced at mint, immutable forever).
// ============================================================================

validator config(seed_utxo: OutputReference) {
  // --------------------------------------------------------------------------
  // Mint handler — one-shot creation of the config NFT + initial config UTxO.
  // Invariants M1-M4 from SPEC §3.1.
  // --------------------------------------------------------------------------
  mint(_redeemer: Data, policy_id: PolicyId, self: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = self

    // M2/M3: exactly one minted asset under this policy with quantity +1,
    //        asset name length == 28 (= the collection policy id).
    expect [Pair(asset_name, quantity)] =
      mint
        |> assets.tokens(policy_id)
        |> dict.to_pairs()

    // M1: seed UTxO consumed (one-shot guarantee).
    let seed_consumed =
      list.any(inputs, fn(input) { input.output_reference == seed_utxo })

    // M4: output to ScriptCredential(policy_id) carrying the minted NFT and
    //     a well-typed `ConfigDatum` satisfying the floors.
    let output_well_formed =
      is_mint_output_valid(outputs, policy_id, asset_name)

    and {
      quantity == 1,
      bytearray.length(asset_name) == 28,
      seed_consumed?,
      output_well_formed?,
    }
  }

  // --------------------------------------------------------------------------
  // Spend handler — admin updates to the config datum.
  // Invariants C1-C6 from SPEC §3.1. Redeemer is `Void`; every spend re-runs
  // all checks. There is no Retire path — the config NFT is permanent.
  // --------------------------------------------------------------------------
  spend(
    datum: Option<ConfigDatum>,
    _redeemer: Data,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(input_cfg) = datum

    // Resolve own input to learn the script credential + the config NFT identity.
    expect Some(own_input) = find_input(self.inputs, own_ref)
    let own_address = own_input.output.address
    expect Script(policy_id) = own_address.payment_credential

    // Locate the continuing output at the same address holding the same
    // config NFT (preserved). asset_name is whatever the mint produced — we
    // don't constrain it here; the spend never changes the asset name.
    //
    // Strictly enforce EXACTLY ONE matching output to prevent junk
    // outputs at the config address from weakening the continuing-UTxO
    // invariant the rest of the protocol depends on.
    let output =
      unique_matching_output(
        self.outputs,
        fn(o) {
          and {
            o.address == own_address,
            (
              o.value
                |> assets.tokens(policy_id)
                |> dict.size()
            ) == 1,
            // exactly one asset under this policy (the config NFT)
            assets.quantity_of(
              o.value,
              policy_id,
              extract_only_asset_name(o.value, policy_id),
            ) == 1,
          }
        },
      )

    expect InlineDatum(out_data) = output.datum
    expect output_cfg: ConfigDatum = out_data

    // Check cheap things first; rotation sig check only if admin changed.
    and {
      // C1: admin must sign
      utils.signed_by(self, input_cfg.admin_pkh)?,
      // C3-C5: floors
      is_valid_config_datum(output_cfg)?,
      // C6: if admin rotation, new admin must also sign
      or {
        input_cfg.admin_pkh == output_cfg.admin_pkh,
        utils.signed_by(self, output_cfg.admin_pkh),
      }?,
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Helpers
// ============================================================================

/// Validates the mint-time output: lives at ScriptCredential(policy_id),
/// holds the minted NFT (and only that token of this policy), and carries
/// an inline `ConfigDatum` satisfying the floor invariants.
///
/// Strictly enforces EXACTLY ONE matching output to prevent extra outputs
/// at the config address from sneaking through alongside the legitimate one.
fn is_mint_output_valid(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: ByteArray,
) -> Bool {
  let output =
    unique_matching_output(
      outputs,
      fn(o) {
        when o.address.payment_credential is {
          Script(hash) -> and {
              hash == policy_id,
              assets.quantity_of(o.value, policy_id, asset_name) == 1,
            }
          _ -> False
        }
      },
    )

  expect InlineDatum(data) = output.datum
  expect cfg: ConfigDatum = data
  is_valid_config_datum(cfg)
}

/// Read the (single expected) asset name under `policy_id` in a value.
/// Caller has already verified `dict.size == 1` so the destructure is total.
fn extract_only_asset_name(
  value: assets.Value,
  policy_id: PolicyId,
) -> ByteArray {
  expect [Pair(asset_name, _qty)] =
    value
      |> assets.tokens(policy_id)
      |> dict.to_pairs()
  asset_name
}

/// Find the single output matching `pred`. Fails (via expect) if zero or
/// more than one output matches. This is the load-bearing fix from Codex
/// review of v0.3 — using `list.find` would allow junk outputs at the
/// config address to slip past validation.
fn unique_matching_output(
  outputs: List<Output>,
  pred: fn(Output) -> Bool,
) -> Output {
  let (count, found) =
    list.foldl(
      outputs,
      (0, None),
      fn(o, acc) {
        let (n, _) = acc
        if pred(o) {
          (n + 1, Some(o))
        } else {
          acc
        }
      },
    )
  expect 1 = count
  expect Some(output) = found
  output
}
