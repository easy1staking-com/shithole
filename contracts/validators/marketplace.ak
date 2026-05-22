use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
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
//   2. routes `>= price_qty - ceil(price_qty * 2 / 100)` of
//      `(price_policy, price_name)` to the seller's declared address,
//      tagged with `compute_output_tag(own_ref)` so the payment is bound to
//      THIS specific listing
//   3. routes `>= ceil(price_qty * 2 / 100)` of the SAME asset to the jar
//      UTxO, enforced via a jar input/output value-delta check (no need to
//      read the jar's redeemer; the direct delta is cleaner and
//      shape-agnostic).
// In the canonical case the buyer's total outlay equals `price_qty`. Both
// legs are `>=` so an overly generous buyer can top up either side.
//
// The 2 % fee is HARDCODED. One marketplace instance per (admin, fee-rate)
// pair; admin lives on the jar, not here. The jar's `script_hash` is the
// only compile-time parameter — it derives the jar address used to locate
// the fee-bearing input and continuing output.
//
// Class-B double-satisfaction (two listings believing a single jar deposit
// credits both) is foreclosed by B2: exactly one input at the marketplace
// address per tx. Without B2, a buyer could batch two listings + one jar
// deposit and have both validators count the same delta as their fee.
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
  /// input/output and the seller-payment output.
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
// Buy path
// ============================================================================
//
// Invariants (cheap-first; the value-delta hash on B6 is the last thing
// we do):
//   B1  price_qty > 0 (sanity; also makes the ceil-fee strictly positive)
//   B2  exactly one input at THIS marketplace address (Class-B defense)
//   B3+B7  seller_output @ seller_output_index, in one `assets.match`:
//            - address == datum.seller_address
//            - datum   == InlineDatum(compute_output_tag(own_ref))
//            - non-ADA value: STRICT equality with
//              {price_policy -> {price_name -> seller_amount}}
//              where seller_amount = price_qty - ceil(price_qty * 2 / 100)
//              (no junk tokens permitted; for ADA-priced listings this slot
//               is empty on both sides)
//            - lovelace: >= datum.accompanying_lovelace (CNT case) or
//              >= seller_amount + accompanying_lovelace (ADA case — the
//              price-token side accumulates onto the lovelace slot via
//              assets.add, and the assets.match callback enforces `>=`)
//   B4  jar_input @ jar_input_index:
//         - payment_credential == Script(jar_script_hash)
//   B5  jar_output @ jar_output_index:
//         - address == jar_input.address  (continuing UTxO)
//   B6  jar value delta on (price_policy, price_name) >= ceil(price_qty * 2 / 100)

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

  // Resolve own input once — used to derive the marketplace address for B2.
  expect Some(own_input) = find_input(inputs, own_ref)
  let own_address = own_input.output.address

  // Fee math, computed once up front. `expected_fee` is the integer ceiling
  // of 2 % of price_qty; `seller_amount` is what the seller must receive
  // (price IS inclusive of fee). For price_qty > 0 the fee is always >= 1
  // and seller_amount may bottom out at 0 for tiny prices (e.g. price = 1
  // -> fee = 1, seller = 0 — degenerate but not exploitable).
  let expected_fee = ( input_datum.price_qty * 2 + 99 ) / 100
  let seller_amount = input_datum.price_qty - expected_fee

  // B3: seller-payment output via O(1) hint.
  let seller_out = list.expect_at(outputs, seller_output_index)
  let own_tag = utils.compute_output_tag(own_ref)
  let expected_seller_datum = InlineDatum(own_tag)
  // B3 + B7 combined: build the expected seller-payment value once and
  // delegate to `assets.match`. The non-ADA half is enforced as STRICT
  // equality (seller output must carry exactly `seller_amount` of the
  // price token and nothing else under any non-ADA policy — no
  // buyer-injected junk allowed); the ADA half uses `>=` so the buyer can
  // top up the output above the declared bond. For ADA-priced listings
  // the price token IS ADA, so `assets.add(value, ada_policy, ada_name,
  // seller_amount)` accumulates onto the lovelace slot — the callback
  // then enforces `actual_lovelace >= seller_amount + accompanying_lovelace`
  // in one shot. Same code path serves both currencies.
  let expected_seller_payment =
    assets.from_lovelace(input_datum.accompanying_lovelace)
      |> assets.add(
          input_datum.price_policy,
          input_datum.price_name,
          seller_amount,
        )
  let expected_payment_data: Data = expected_seller_payment
  expect seller_out.address == input_datum.seller_address
  expect seller_out.datum == expected_seller_datum
  expect
    assets.match(
      seller_out.value,
      expected_payment_data,
      fn(actual_lovelace, expected_lovelace) {
        actual_lovelace >= expected_lovelace
      },
    )

  // B4/B5: locate the jar leg via O(1) hints.
  let jar_in = list.expect_at(inputs, jar_input_index)
  let jar_out = list.expect_at(outputs, jar_output_index)

  let actual_fee = quantity_of(
    jar_out.value,
    input_datum.price_policy,
    input_datum.price_name,
  ) - quantity_of(
    jar_in.output.value,
    input_datum.price_policy,
    input_datum.price_name,
  )

  and {
    // B1: positive price.
    (input_datum.price_qty > 0)?,
    // B2: exactly one consumed input at this marketplace address. Forbids
    // multi-listing batching; pairs with B6's direct delta check to make
    // jar-deposit theft (Class B) impossible.
    (list.count(inputs, fn(i) { i.output.address == own_address }) == 1)?,
    // B4: the fee input is at the configured jar script.
    (jar_in.output.address.payment_credential == Script(jar_script_hash))?,
    // B5: jar continues at the same address (admin can't redirect mid-tx).
    (jar_out.address == jar_in.output.address)?,
    // B6: jar value delta on (price_policy, price_name) covers the ceiling
    // 2 % fee. Reading both sides via `quantity_of` (which returns 0 on
    // missing keys) lets the same code path handle ADA and CNT fees.
    (actual_fee >= expected_fee)?,
  }
}
