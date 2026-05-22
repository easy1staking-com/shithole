use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}
use shithole/utils

// ============================================================================
// Marketplace — native-asset listing validator, parameterized on the jar's
// `script_hash`.
//
// Sellers lock ONE listing UTxO at this validator's address carrying:
//   - the asset(s) for sale (held in the UTxO's value bag, minus min-UTxO ADA)
//   - a `MarketDatum` declaring the price denomination, price quantity,
//     seller pkh (Cancel authority), and the EXACT destination address for
//     the Buy-side payment.
//
// A buyer fulfills via the `Buy` redeemer in a single tx. The fee is
// INCLUSIVE of the asking price: a listing at `price_qty = 100` with a 2 %
// fee means the buyer pays 100 total, of which 98 goes to the seller and 2
// to the protocol jar. Concretely:
//   1. spends the listing UTxO
//   2. routes `>= seller_amount` of `(price_policy, price_name)` to the
//      seller's declared address, tagged with `compute_output_tag(own_ref)`
//      so the payment is bound to THIS specific listing
//   3. credits the jar with at least the listing's expected fee. Across the
//      whole tx this is enforced as an AGGREGATE check (see below).
// In the canonical case the buyer's total outlay equals `price_qty`. Both
// legs are `>=` so an overly generous buyer can top up either side.
//
// ----------------------------------------------------------------------------
// BULK BUY
//
// The validator supports any number of marketplace listings in a single tx,
// including listings priced in DIFFERENT (policy, name) pairs. To avoid
// every spend redundantly walking inputs and decoding every other listing's
// datum, the aggregate-fee check runs on EXACTLY ONE spend per tx: the
// "leader". Leader election is by lowest OutRef among marketplace inputs —
// the Plutus v3 script context delivers `tx.inputs` in canonical (sorted)
// order, so `list.find(inputs, addr == own_address)` returns the same
// input no matter which spend is currently running. Each spend asks "is
// that me?"; exactly one says yes.
//
// Per-spend (everyone):
//   - B1   price_qty > 0
//   - B3   seller output: address, datum tag, value (strict non-ADA equality
//          on the price token + `>=` lovelace, fused into one assets.match)
//   - B4   jar_input at jar_script_hash       \
//   - B5   jar_output continues at jar address /  enforce hint consistency
//                                                 across all spends in tx
// Leader-only (lowest-outref marketplace input):
//   - B6_agg  for every (policy, name) appearing as a price denomination in
//             any marketplace input, jar's value-bag delta on that pair
//             must cover the sum of all listings' expected fees in that
//             token. Built up as a Value via assets.add, then flatten +
//             list.all over the entries.
//
// Class-A double-sat (two listings collapsing into one seller output) is
// foreclosed by the tag binding on each seller output — every consumed
// listing demands a uniquely-tagged payout.
//
// Class-B double-sat (two listings claiming the same jar deposit as their
// own fee) is foreclosed by the aggregate-fee check: the leader sums fees
// across EVERY marketplace input in the tx and demands jar delta covers
// the total. Buyers cannot under-pay no matter how they arrange the tx.
//
// Datum is `Option<Data>` so a future Rescue path (admin recovery of
// accidental pay-to-script with NoDatum) can be added without breaking
// the type. v1 has no Rescue; Buy and Cancel both require `Some(data)`.
// ============================================================================

pub type MarketDatum {
  /// Cancel authority. The seller can withdraw the listing at any time
  /// (and route the contents wherever) by signing with this pkh.
  seller_pkh: VerificationKeyHash,
  /// EXACT destination for the Buy payment. Full Address equality
  /// (payment + stake credentials) — so sellers using a base address get
  /// the payment delivered into the right wallet shape.
  seller_address: Address,
  /// Price denomination. ADA uses the empty bytestring for BOTH fields.
  price_policy: PolicyId,
  price_name: AssetName,
  /// Asking price in units of (price_policy, price_name). INCLUSIVE of the
  /// 2 % protocol fee — the seller receives `price_qty - ceil(price_qty * 2
  /// / 100)`, the jar receives the rest. Validated `> 0` at Buy time so the
  /// ceiling fee is always strictly positive (avoids the degenerate
  /// "0 price, 0 fee" case).
  price_qty: Int,
  /// Lovelace the seller bonds into the listing UTxO ALONGSIDE the listed
  /// asset(s). At Buy time this ADA flows out to the seller's payout output
  /// — which is what funds the payout's min-UTxO when the price is
  /// denominated in CNT (and the payout's asset bag would otherwise carry
  /// no ADA). Typical value ~1_500_000 — slightly above the usual 1.2-1.3
  /// ADA min-UTxO floor to absorb the bundle bloat caused by worthless
  /// tokens (Hosky-style multi-policy bags). For ADA-priced listings this
  /// can be 0: the price itself satisfies min-UTxO on the seller payout.
  /// Validator enforces `seller_out.value lovelace >= accompanying_lovelace`
  /// (B7); the seller decides per-listing how much to lock.
  accompanying_lovelace: Int,
}

pub type MarketRedeemer {
  /// Buyer fulfills the listing. Indexes hint O(1) lookup of the jar
  /// input/output and THIS listing's seller-payment output. In a bulk tx
  /// every Buy redeemer should carry the same `jar_input_index` and
  /// `jar_output_index` (off-chain consistency — each spend re-checks B4/B5
  /// against its own redeemer hints); `seller_output_index` differs per
  /// listing.
  Buy { jar_input_index: Int, jar_output_index: Int, seller_output_index: Int }
  /// Seller withdraws. No output constraints — the seller signed; their
  /// asset, their call.
  Cancel
}

validator marketplace(jar_script_hash: ScriptHash) {
  spend(
    datum: Option<Data>,
    redeemer: MarketRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    when redeemer is {
      Buy { jar_input_index, jar_output_index, seller_output_index } -> {
        expect Some(input_data) = datum
        expect input_datum: MarketDatum = input_data
        validate_buy(
          self,
          input_datum,
          own_ref,
          jar_script_hash,
          jar_input_index,
          jar_output_index,
          seller_output_index,
        )
      }

      Cancel -> {
        expect Some(input_data) = datum
        let seller_pkh = utils.extract_first_bytearray_field(input_data)
        utils.signed_by(self, seller_pkh)
      }
    }
  }

  else(_) {
    fail
  }
}

// ============================================================================
// Per-listing checks (run on EVERY spend in a bulk tx).
// ============================================================================

fn validate_buy(
  self: Transaction,
  input_datum: MarketDatum,
  own_ref: OutputReference,
  jar_script_hash: ScriptHash,
  jar_input_index: Int,
  jar_output_index: Int,
  seller_output_index: Int,
) -> Bool {
  let Transaction { inputs, outputs, .. } = self

  expect Some(own_input) = find_input(inputs, own_ref)
  let own_address = own_input.output.address

  // Fee math (per-listing): expected_fee is the integer ceiling of 2 % of
  // price_qty; seller_amount is what THIS listing's payout owes the seller.
  let expected_fee = ( input_datum.price_qty * 2 + 99 ) / 100
  let seller_amount = input_datum.price_qty - expected_fee

  // ---- B3: seller-payment output for THIS listing ----
  // O(1) hint, strict non-ADA equality + `>=` lovelace via assets.match.
  // For ADA-priced listings the price-token side accumulates onto the
  // lovelace slot — the callback then enforces
  // `actual >= seller_amount + accompanying_lovelace` in one shot.
  let seller_out = list.expect_at(outputs, seller_output_index)
  let own_tag = utils.compute_output_tag(own_ref)
  let expected_seller_payment =
    assets.from_lovelace(input_datum.accompanying_lovelace)
      |> assets.add(
          input_datum.price_policy,
          input_datum.price_name,
          seller_amount,
        )
  let expected_payment_data: Data = expected_seller_payment
  expect input_datum.price_qty > 0
  expect seller_out.address == input_datum.seller_address
  expect seller_out.datum == InlineDatum(own_tag)
  expect
    assets.match(
      seller_out.value,
      expected_payment_data,
      fn(actual_lovelace, expected_lovelace) {
        actual_lovelace >= expected_lovelace
      },
    )

  // ---- B4 + B5: jar leg sanity (per-spend) ----
  // Each spend resolves its own redeemer's jar hints and asserts they point
  // at a real jar leg (input at the configured jar script, output continuing
  // at the same address). Forces the off-chain tx-builder to set consistent
  // jar_input_index / jar_output_index across every Buy redeemer in the tx.
  // The aggregate fee check itself is leader-only (below).
  let jar_in = list.expect_at(inputs, jar_input_index)
  let jar_out = list.expect_at(outputs, jar_output_index)
  expect jar_in.output.address.payment_credential == Script(jar_script_hash)
  expect jar_out.address == jar_in.output.address

  // ---- Leader detection ----
  // tx.inputs is canonically sorted by OutRef in Plutus v3, so list.find
  // returns the lowest-outref marketplace input — deterministically the
  // same input no matter which spend is running. Exactly one spend will
  // find that this input IS itself.
  expect Some(first_marketplace) =
    list.find(inputs, fn(i) { i.output.address == own_address })

  if first_marketplace.output_reference == own_ref {
    // Leader path — run the aggregate fee check once for the whole tx.
    validate_aggregate_fee(inputs, own_address, jar_in, jar_out)
  } else {
    // Non-leader path — trust the leader to verify the aggregate.
    True
  }
}

// ============================================================================
// Leader-only aggregate-fee check.
//
// Walk every marketplace input in tx.inputs, decode each datum, and
// accumulate expected fees grouped by (price_policy, price_name) into a
// running `Value`. Then for every (policy, name, expected_qty) triple in
// that value bag, assert the jar's delta on that pair is `>= expected_qty`.
//
// `assets.add` merges same-token entries on the fly, so listings priced in
// the same token contribute additively. Listings priced in different
// tokens create separate entries, each independently checked against the
// jar.
// ============================================================================

fn validate_aggregate_fee(
  inputs: List<Input>,
  marketplace_address: Address,
  jar_in: Input,
  jar_out: Output,
) -> Bool {
  let expected_jar_delta =
    list.foldr(
      inputs,
      assets.zero,
      fn(input, acc) {
        if input.output.address == marketplace_address {
          expect InlineDatum(input_data) = input.output.datum
          expect md: MarketDatum = input_data
          let fee = ( md.price_qty * 2 + 99 ) / 100
          assets.add(acc, md.price_policy, md.price_name, fee)
        } else {
          acc
        }
      },
    )

  expected_jar_delta
    |> jar_delta_covers_each_token(jar_in.output.value, jar_out.value)
}

/// For every (policy, name, expected_qty) in `expected_delta`, check
/// `quantity_of(jar_out_value, p, n) - quantity_of(jar_in_value, p, n) >= expected_qty`.
/// Other tokens present in the jar's value bag are ignored — we only care
/// that the FEE tokens went up by at least the expected amount.
fn jar_delta_covers_each_token(
  expected_delta: Value,
  jar_in_value: Value,
  jar_out_value: Value,
) -> Bool {
  expected_delta
    |> assets.flatten
    |> list.all(
        fn(triple) {
          let (p, n, expected_qty) = triple
          quantity_of(jar_out_value, p, n) - quantity_of(jar_in_value, p, n) >= expected_qty
        },
      )
}
