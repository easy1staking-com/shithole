use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId}
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
//
// ----------------------------------------------------------------------------
// ACCEPTED FOOTGUN — config-address output uniqueness is NOT enforced.
//
// Both `is_mint_output_valid` (M4) and the spend handler (C2) use
// `list.expect_find`, which proves only AT LEAST ONE matching output exists.
// A careless or malicious transaction could include an extra output at the
// config address. Such a UTxO is meaningless to the protocol — the swap path
// looks for the config via the config NFT, which exists on EXACTLY one UTxO
// chain-wide (one-shot mint guarantees this). The "extra output" has no NFT
// (since there's only one, on the real config UTxO), so it cannot impersonate
// the config.
//
// Net effect of an extra output: the ADA on it is locked behind the spend
// validator forever (no one can prove their valid configuration on it).
// That hurts only the party that put it there. Not a protocol vulnerability,
// just self-injurious behavior. We accept this rather than pay the cost of
// fold-and-count enforcement.
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
    // Pattern-matching the literal `1` does double duty: it both destructures
    // the (asset_name, quantity) pair AND asserts quantity == 1 in one step.
    expect [Pair(asset_name, 1)] = mint
      |> assets.tokens(policy_id)
      |> dict.to_pairs()

    // M1: seed UTxO consumed (one-shot guarantee).
    list.expect_any(inputs, fn(input) { input.output_reference == seed_utxo })

    // M4: output to ScriptCredential(policy_id) carrying the minted NFT and
    //     a well-typed `ConfigDatum` satisfying the floors.
    and {
      bytearray.length(asset_name) == 28,
      is_mint_output_valid(outputs, policy_id, asset_name)?,
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

    // Resolve own input to learn the script credential.
    expect Some(own_input) = find_input(self.inputs, own_ref)
    let own_address = own_input.output.address
    expect Script(policy_id) = own_address.payment_credential

    // C2: locate the continuing output at the same address holding the same
    // config NFT (preserved). See the ACCEPTED FOOTGUN comment at the top —
    // we use list.expect_find here, not a uniqueness-enforcing fold.
    //
    // `assets.has_any_nft_strict` enforces "exactly one NFT under the
    // parameterized policy and no other non-ADA assets" — which is the right
    // continuity check for the config UTxO.
    let output = list.expect_find(
      self.outputs,
      fn(o) {
        and {
          o.address == own_address,
          assets.has_any_nft_strict(o.value, policy_id),
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
/// holds exactly one NFT under `policy_id` (no other tokens of any policy
/// besides ADA), and carries an inline `ConfigDatum` satisfying the floor
/// invariants.
///
/// Uses `assets.has_any_nft_strict` for the value check — that enforces
/// "exactly one NFT under this policy AND nothing else (besides ADA)" in
/// one stdlib call, replacing the previous custom check.
fn is_mint_output_valid(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: ByteArray,
) -> Bool {
  let output = list.expect_find(
    outputs,
    fn(o) {
      when o.address.payment_credential is {
        Script(hash) -> and {
            hash == policy_id,
            assets.has_nft_strict(o.value, policy_id, asset_name),
          }
        _ -> False
      }
    },
  )

  expect InlineDatum(data) = output.datum
  expect cfg: ConfigDatum = data
  is_valid_config_datum(cfg)
}
