use aiken/fuzz
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{AssetName, PolicyId, ada_asset_name, ada_policy_id}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use marketplace.{Buy, Cancel, MarketDatum, MarketRedeemer}
use shithole/utils

// ============================================================================
// Test fixtures
// ============================================================================

const test_marketplace_script_hash =
  #"00000000000000000000000000000000000000000000000000000077"

const test_jar_script_hash =
  #"00000000000000000000000000000000000000000000000000000088"

const test_seller_pkh =
  #"11111111111111111111111111111111111111111111111111111111"

const test_buyer_pkh =
  #"22222222222222222222222222222222222222222222222222222222"

const test_other_pkh =
  #"33333333333333333333333333333333333333333333333333333333"

// 28-byte stake key hash so we can exercise a base-address seller.
const test_seller_stake_pkh =
  #"55555555555555555555555555555555555555555555555555555555"

// CNT price denomination for the canonical happy path.
const test_price_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_price_name = #"50524943"

// The listed asset (an NFT under a different policy id).
const test_listed_policy =
  #"deadbeef00000000000000000000000000000000000000000000beef"

const test_listed_name = #"4e46544131"

fn test_marketplace_addr() -> Address {
  Address {
    payment_credential: Script(test_marketplace_script_hash),
    stake_credential: None,
  }
}

fn test_jar_addr() -> Address {
  Address {
    payment_credential: Script(test_jar_script_hash),
    stake_credential: None,
  }
}

fn test_seller_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_seller_pkh),
    stake_credential: None,
  }
}

fn test_buyer_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_buyer_pkh),
    stake_credential: None,
  }
}

fn test_seller_base_addr() -> Address {
  Address {
    payment_credential: VerificationKey(test_seller_pkh),
    stake_credential: Some(Inline(VerificationKey(test_seller_stake_pkh))),
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

fn jar_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000030",
    output_index: 0,
  }
}

fn buyer_funding_outref() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000040",
    output_index: 0,
  }
}

/// Canonical CNT-priced listing datum: 100 PRICE tokens, seller_pkh as
/// Cancel authority + payment destination. 1.5 ADA accompanying-lovelace
/// bond — the ADA that flows from the listing into the seller's CNT-laden
/// payout output to satisfy min-UTxO.
fn cnt_datum() -> MarketDatum {
  MarketDatum {
    seller_pkh: test_seller_pkh,
    seller_address: test_seller_addr(),
    price_policy: test_price_policy,
    price_name: test_price_name,
    price_qty: 100,
    accompanying_lovelace: 1_500_000,
  }
}

/// ADA-priced listing variant — empty policy & name on the price slot.
/// `accompanying_lovelace` defaults to 0 because the price itself is ADA
/// and already provides min-UTxO on the seller payout.
fn ada_datum(price_qty: Int) -> MarketDatum {
  MarketDatum {
    seller_pkh: test_seller_pkh,
    seller_address: test_seller_addr(),
    price_policy: ada_policy_id,
    price_name: ada_asset_name,
    price_qty: price_qty,
    accompanying_lovelace: 0,
  }
}

/// CNT-priced listing input holding a single NFT for sale.
fn cnt_listing_input() -> Input {
  Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(cnt_datum()),
      reference_script: None,
    },
  }
}

/// Same as cnt_listing_input but with the listing UTxO using a DIFFERENT
/// outref — used in B2 fixtures that need two listing inputs at the
/// marketplace address.
fn cnt_listing_input_at(oref: OutputReference) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(cnt_datum()),
      reference_script: None,
    },
  }
}

/// Listing input for the ADA-priced happy path.
fn ada_listing_input(price_qty: Int) -> Input {
  Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(ada_datum(price_qty)),
      reference_script: None,
    },
  }
}

/// Pre-existing jar UTxO. Some min-utxo ADA, no price tokens yet.
fn cnt_jar_input() -> Input {
  Input {
    output_reference: jar_outref(),
    output: Output {
      address: test_jar_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(0),
      reference_script: None,
    },
  }
}

/// Jar input pre-loaded with some PRICE tokens — used to verify B6's delta
/// (rather than absolute) check.
fn cnt_jar_input_with_balance(existing: Int) -> Input {
  Input {
    output_reference: jar_outref(),
    output: Output {
      address: test_jar_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_price_policy, test_price_name, existing),
      datum: InlineDatum(0),
      reference_script: None,
    },
  }
}

/// Buyer's funding input — supplies the price tokens routed to the seller +
/// the fee delta routed to the jar. Validator doesn't read it; just there
/// to make the tx-shape realistic.
fn buyer_funding_input() -> Input {
  Input {
    output_reference: buyer_funding_outref(),
    output: Output {
      address: test_buyer_addr(),
      value: assets.from_lovelace(10_000_000)
        |> assets.add(test_price_policy, test_price_name, 1_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

/// Seller-payment output: CNT-priced. Carries `price_qty` of the price
/// asset and the anti-double-sat tag tied to the consumed listing.
fn cnt_seller_output(
  tag: ByteArray,
  qty: Int,
  to: Address,
) -> Output {
  Output {
    address: to,
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, qty),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

/// Seller-payment output: ADA-priced. The price IS lovelace; tag goes in
/// the inline datum. Lovelace covers both the asking price and the
/// output's min-UTxO.
fn ada_seller_output(tag: ByteArray, lovelace: Int, to: Address) -> Output {
  Output {
    address: to,
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

/// Continuing jar output for CNT-priced flows. `delta` is the fee being
/// added on top of whatever existed in the jar input.
fn cnt_jar_output(existing: Int, delta: Int) -> Output {
  Output {
    address: test_jar_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, existing + delta),
    datum: InlineDatum(0),
    reference_script: None,
  }
}

/// Continuing jar output for ADA-priced flows. `delta` is the additional
/// lovelace credited as fee.
fn ada_jar_output(existing_lovelace: Int, delta: Int) -> Output {
  Output {
    address: test_jar_addr(),
    value: assets.from_lovelace(existing_lovelace + delta),
    datum: InlineDatum(0),
    reference_script: None,
  }
}

/// Canonical CNT-priced happy-path tx. Inputs: listing (idx 0), buyer
/// funding (idx 1), jar (idx 2). Outputs: seller (idx 0), jar (idx 1).
/// price_qty = 100 → expected_fee = ceil(200/100) = 2.
fn happy_cnt_buy_tx() -> Transaction {
  let own_tag = utils.compute_output_tag(listing_outref())
  Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
}

fn happy_cnt_buy_redeemer() -> MarketRedeemer {
  Buy {
    jar_input_index: 2,
    jar_output_index: 1,
    seller_output_index: 0,
  }
}

/// Invoke the marketplace spend validator with a canonical CNT MarketDatum.
fn invoke_buy(tx: Transaction, redeemer: MarketRedeemer) -> Bool {
  let datum: Data = cnt_datum()
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(datum),
    redeemer,
    listing_outref(),
    tx,
  )
}

/// Invoke with an arbitrary datum (used by ADA-priced + base-address tests).
fn invoke_buy_with_datum(
  datum: MarketDatum,
  tx: Transaction,
  redeemer: MarketRedeemer,
) -> Bool {
  let data: Data = datum
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(data),
    redeemer,
    listing_outref(),
    tx,
  )
}

// ============================================================================
// Happy paths
// ============================================================================

test buy_succeeds_cnt_priced() {
  invoke_buy(happy_cnt_buy_tx(), happy_cnt_buy_redeemer())
}

test buy_succeeds_ada_priced() {
  // Price = 5 ADA, fee = ceil(10_000_000 * 2 / 100) = 200_000 lovelace.
  let price_lovelace = 5_000_000
  let expected_fee = ( price_lovelace * 2 + 99 ) / 100
  let own_tag = utils.compute_output_tag(listing_outref())
  let datum = ada_datum(price_lovelace)
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      ada_listing_input(price_lovelace),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      ada_seller_output(own_tag, price_lovelace + 1_000_000, test_seller_addr()),
      ada_jar_output(2_000_000, expected_fee),
    ],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_multi_asset_listing() {
  // Listing carries 50 fungible tokens of `test_listed_policy` (instead of
  // 1 NFT). The validator doesn't read the listed asset at all — it only
  // checks the seller payment + jar fee — so this just exercises that an
  // arbitrary multi-asset listing UTxO works.
  let own_tag = utils.compute_output_tag(listing_outref())
  let bulk_listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 50),
      datum: InlineDatum(cnt_datum()),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [bulk_listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_with_base_seller_address() {
  // Seller's declared address is a BASE address (payment + stake creds).
  // Full Address equality must still pass.
  let own_tag = utils.compute_output_tag(listing_outref())
  let datum = MarketDatum { ..cnt_datum(), seller_address: test_seller_base_addr() }
  let listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_base_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_with_pre_existing_jar_balance() {
  // Jar input ALREADY carries 1_000 PRICE tokens from prior deposits.
  // The fee check must read the DELTA, not the absolute balance.
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      buyer_funding_input(),
      cnt_jar_input_with_balance(1_000),
    ],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(1_000, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// B1: price_qty > 0
// ============================================================================

test buy_fails_when_price_qty_is_zero() fail {
  // Datum says price 0; even if the buyer ships any fee, B1 must reject.
  let datum = MarketDatum { ..cnt_datum(), price_qty: 0 }
  let own_tag = utils.compute_output_tag(listing_outref())
  let listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 0, test_seller_addr()),
      cnt_jar_output(0, 1),
    ],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_price_qty_is_negative() fail {
  let datum = MarketDatum { ..cnt_datum(), price_qty: -5 }
  let own_tag = utils.compute_output_tag(listing_outref())
  let listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 0, test_seller_addr()),
      cnt_jar_output(0, 1),
    ],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// Bulk buy — aggregate fee enforcement (leader pattern)
// ============================================================================

test bulk_buy_fails_when_jar_delta_short_for_aggregate() fail {
  // Two same-token listings (price 100 each, fee 2 each => aggregate 4)
  // but the jar only got 2 deposited. The leader's aggregate-fee check
  // catches this: jar delta < SUM of expected fees. Without the leader's
  // sum-then-check, a buyer could pay for one listing and ride the other
  // for free (Class B). Both listings A and B fail.
  let own_tag = utils.compute_output_tag(listing_outref())
  let other_tag = utils.compute_output_tag(other_listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_seller_output(other_tag, 98, test_seller_addr()),
      // Only 2 token of fee deposited — covers ONE listing's fee, not both.
      cnt_jar_output(0, 2),
    ],
  }
  // Invoke the LEADER (listing A — lowest outref). The aggregate check
  // sums fees across both listings (= 4) and finds the jar delta (= 2)
  // insufficient.
  let r = Buy {
    jar_input_index: 3,
    jar_output_index: 2,
    seller_output_index: 0,
  }
  invoke_buy(tx, r)
}

// ============================================================================
// B3: seller-output (address + amount + datum tag)
// ============================================================================

test buy_fails_when_seller_output_to_wrong_address() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_buyer_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_seller_payment_underpays_by_one() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 97, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_seller_overpaid_in_price_token() fail {
  // After variant-D swap: B3 is now strict non-ADA equality. Buyer can no
  // longer pad the seller output with extra price tokens — must ship
  // EXACTLY `seller_amount` (= price - fee). Overpaying the seller is a
  // protocol error (it shifts value-routing in a way the validator hasn't
  // reasoned about); buyers wanting to be generous can send a SEPARATE
  // output to the seller alongside the bound one.
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 150, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_seller_output_carries_extra_token() fail {
  // Variant D's strict non-ADA equality: any extra (non-price, non-ADA)
  // token on the seller output causes B3 to reject. Closes the door on
  // buyer-injected junk that could be used to grief the seller (e.g.
  // dust-attack tokens with unfavorable burn rights).
  let own_tag = utils.compute_output_tag(listing_outref())
  let junk_policy =
    #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  let polluted = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 98)
      |> assets.add(junk_policy, #"ff", 1),
    datum: InlineDatum(own_tag),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [polluted, cnt_jar_output(0, 2)],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_with_wrong_seller_datum_tag() fail {
  // Tag corresponds to a DIFFERENT outref — anti-double-sat binding fails.
  let wrong_tag = utils.compute_output_tag(other_listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(wrong_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_with_no_datum_on_seller_output() fail {
  let bad_seller = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 98),
    datum: NoDatum,
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [bad_seller, cnt_jar_output(0, 2)],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// B4: jar input must be at the configured jar script address
// ============================================================================

test buy_fails_when_jar_input_is_non_jar_script() fail {
  // The "jar" input is at some OTHER script address — B4's payment-credential
  // check rejects.
  let wrong_script_hash =
    #"00000000000000000000000000000000000000000000000000bad000"
  let fake_jar = Input {
    output_reference: jar_outref(),
    output: Output {
      address: Address {
        payment_credential: Script(wrong_script_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(0),
      reference_script: None,
    },
  }
  let fake_jar_out = Output {
    address: fake_jar.output.address,
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 2),
    datum: InlineDatum(0),
    reference_script: None,
  }
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), fake_jar],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      fake_jar_out,
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_jar_input_is_wallet() fail {
  // The "jar" input is at a VerificationKey address — B4 rejects (not a
  // Script credential at all).
  let wallet_input = Input {
    output_reference: jar_outref(),
    output: Output {
      address: test_buyer_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
  let wallet_out = Output {
    address: test_buyer_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 2),
    datum: NoDatum,
    reference_script: None,
  }
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), wallet_input],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      wallet_out,
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// B5: jar continues at its own address (admin can't redirect mid-tx)
// ============================================================================

test buy_fails_when_jar_output_at_different_address() fail {
  // jar_out goes to the buyer's wallet instead of staying at jar_addr.
  let own_tag = utils.compute_output_tag(listing_outref())
  let moved_jar = Output {
    address: test_buyer_addr(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 2),
    datum: InlineDatum(0),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      moved_jar,
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// B6: fee delta >= ceil(price_qty * 2 / 100)
// ============================================================================

test buy_fails_when_fee_short_by_one() fail {
  // price_qty = 100 → expected fee = 2. Ship only 1.
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 1),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_fee_zero() fail {
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 0),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_fails_when_overpaying_fee_token() fail {
  // Strict semantics: jar's value-bag must match `jar_in + Σfees` EXACTLY
  // on the fee-token side. Buyer can't tip the protocol in CNT — the
  // aggregate check is non-ADA strict (assets.match). Tips go via ADA.
  let own_tag = utils.compute_output_tag(listing_outref())
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      cnt_jar_output(0, 5),
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_when_jar_receives_extra_ada() {
  // Counterpart to the test above: tipping is allowed in ADA. The
  // assets.match callback enforces `actual_lovelace >= expected_lovelace`,
  // so a buyer adding extra lovelace to the jar's continuing output (over
  // and above the recreated min-UTxO) is fine.
  let own_tag = utils.compute_output_tag(listing_outref())
  let tipped_jar = Output {
    address: test_jar_addr(),
    value: assets.from_lovelace(3_000_000)
      |> assets.add(test_price_policy, test_price_name, 2),
    datum: InlineDatum(0),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, 98, test_seller_addr()),
      tipped_jar,
    ],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// Fee-ceiling boundary tests:
//   price = 1   → ceil(2/100) = 1
//   price = 49  → ceil(98/100) = 1
//   price = 50  → ceil(100/100) = 1
//   price = 51  → ceil(102/100) = 2

fn run_fee_ceiling_case(price: Int, fee: Int, seller_qty: Int) -> Bool {
  let datum = MarketDatum { ..cnt_datum(), price_qty: price }
  let own_tag = utils.compute_output_tag(listing_outref())
  let listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [
      cnt_seller_output(own_tag, seller_qty, test_seller_addr()),
      cnt_jar_output(0, fee),
    ],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

// Boundary cases: fee = ceil(price * 2 / 100); seller = price - fee.
//   price = 1   → fee 1, seller 0
//   price = 49  → fee 1, seller 48
//   price = 50  → fee 1, seller 49
//   price = 51  → fee 2, seller 49

test fee_ceiling_price_1_needs_1() {
  run_fee_ceiling_case(1, 1, 0)
}

test fee_ceiling_price_49_needs_1() {
  run_fee_ceiling_case(49, 1, 48)
}

test fee_ceiling_price_50_needs_1() {
  run_fee_ceiling_case(50, 1, 49)
}

test fee_ceiling_price_51_needs_2() {
  run_fee_ceiling_case(51, 2, 49)
}

test fee_ceiling_price_51_with_only_1_fails() fail {
  // seller_qty satisfies B3 (49 >= 51 - 2 = 49); B6 fails because fee = 1
  // is short of the required 2.
  run_fee_ceiling_case(51, 1, 49)
}

test fee_ceiling_price_1_with_zero_fee_fails() fail {
  // seller_qty satisfies B3 (0 >= 1 - 1 = 0); B6 fails because fee = 0
  // is short of the required 1.
  run_fee_ceiling_case(1, 0, 0)
}

// Property: for any price in [1, 1_000_000], the canonical tx
// (jar gets ceil(price * 2 / 100), seller gets price - that) passes.
// Strict semantics — `fee_buffer` is intentionally absent here; the
// `buy_fails_when_overpaying_fee_token` unit test pins the non-ADA
// strict-equality rejection separately.
test prop_fee_ceiling(price via fuzz.int_between(1, 1_000_000)) {
  let expected_fee = ( price * 2 + 99 ) / 100
  let seller_qty = price - expected_fee
  run_fee_ceiling_case(price, expected_fee, seller_qty)
}

// ============================================================================
// B2: input lovelace >= datum.accompanying_lovelace
// ============================================================================

test buy_fails_when_listing_underlocks_accompanying_lovelace() fail {
  // Seller declares 5 ADA accompanying_lovelace in the datum but only locks
  // 1.5 ADA in the listing UTxO. Without B2, the seller_out check would
  // require the buyer to fund the 3.5 ADA gap from their own wallet — a
  // hidden surcharge on top of the advertised price_qty. B2 rejects this.
  let mischievous_datum = MarketDatum {
    seller_pkh: test_seller_pkh,
    seller_address: test_seller_addr(),
    price_policy: test_price_policy,
    price_name: test_price_name,
    price_qty: 100,
    accompanying_lovelace: 5_000_000,
  }
  let underlocked_listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(1_500_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(mischievous_datum),
      reference_script: None,
    },
  }
  let own_tag = utils.compute_output_tag(listing_outref())
  // Seller payout sized to honour the over-stated 5 ADA bond — exactly
  // the case B2 prevents (buyer would otherwise top up the 3.5 ADA gap).
  let seller_out = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(5_000_000)
      |> assets.add(test_price_policy, test_price_name, 98),
    datum: InlineDatum(own_tag),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [underlocked_listing, buyer_funding_input(), cnt_jar_input()],
    outputs: [seller_out, cnt_jar_output(0, 2)],
  }
  invoke_buy_with_datum(mischievous_datum, tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// B7: seller-output lovelace >= datum.accompanying_lovelace
// ============================================================================

test buy_fails_when_seller_output_underbonded_by_one_lovelace() fail {
  // Datum requires 1.5 ADA bond on the seller payout; output ships only
  // 1_499_999 lovelace. Fails by a single lovelace.
  let own_tag = utils.compute_output_tag(listing_outref())
  let underbonded_seller = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(1_499_999)
      |> assets.add(test_price_policy, test_price_name, 98),
    datum: InlineDatum(own_tag),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [underbonded_seller, cnt_jar_output(0, 2)],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_for_worthless_token_with_1_5_ada_bond() {
  // Hosky-style: 1_000_000_000 SHIT priced at 1 PRICE token (just to keep
  // fee math obvious), 1.5 ADA accompanying-lovelace bond. Seller payout
  // carries the 1 PRICE token + 1.5 ADA — without the bond there'd be no
  // ADA on the CNT-laden output and Cardano's min-UTxO check would reject
  // the tx outright.
  let worthless_policy =
    #"cafef00d00000000000000000000000000000000000000000000beef"
  let worthless_name = #"53484954"
  // "SHIT"
  let datum = MarketDatum {
    seller_pkh: test_seller_pkh,
    seller_address: test_seller_addr(),
    price_policy: test_price_policy,
    price_name: test_price_name,
    price_qty: 1,
    accompanying_lovelace: 1_500_000,
  }
  let listing = Input {
    output_reference: listing_outref(),
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(1_500_000)
        |> assets.add(worthless_policy, worthless_name, 1_000_000_000),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
  let own_tag = utils.compute_output_tag(listing_outref())
  // Seller payout: 0 PRICE tokens (price=1, fee=1 → seller take is 0) plus
  // the bonded 1.5 ADA flowing through. Min-UTxO comes entirely from the
  // bond — this is exactly the case the accompanying_lovelace field exists
  // for. Add a value-bag entry of 0 is unnecessary (assets.add with qty=0
  // is a no-op), so the output's value is just lovelace.
  let seller_out = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(1_500_000),
    datum: InlineDatum(own_tag),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [listing, buyer_funding_input(), cnt_jar_input()],
    // ceil(1 * 2 / 100) = 1 PRICE token fee
    outputs: [seller_out, cnt_jar_output(0, 1)],
  }
  invoke_buy_with_datum(datum, tx, happy_cnt_buy_redeemer())
}

test buy_succeeds_when_seller_output_overbonded() {
  // Buyer is free to top up the seller payout above the declared bond.
  // 3 ADA on the output, bond declared as 1.5 ADA → 3M >= 1.5M passes.
  let own_tag = utils.compute_output_tag(listing_outref())
  let overbonded_seller = Output {
    address: test_seller_addr(),
    value: assets.from_lovelace(3_000_000)
      |> assets.add(test_price_policy, test_price_name, 98),
    datum: InlineDatum(own_tag),
    reference_script: None,
  }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input(), buyer_funding_input(), cnt_jar_input()],
    outputs: [overbonded_seller, cnt_jar_output(0, 2)],
  }
  invoke_buy(tx, happy_cnt_buy_redeemer())
}

// ============================================================================
// Bulk buy — leader-pattern + per-token aggregate fee check
// ============================================================================
//
// Each bulk test invokes the marketplace spend ONCE PER LISTING with the
// same Transaction, then ANDs the results. On-chain Plutus runs the spend
// for every consumed input in parallel; the tx is valid iff EVERY
// invocation returns True. We simulate that with `&&` here.
//
// Convention: listing A's outref is `listing_outref()` (0x...0010);
// listing B's is `other_listing_outref()` (0x...0020). A has the lower
// outref so A is always the leader.

// A second token + name for mixed-currency bulk tests.
const test_alt_policy =
  #"cafef00dcafef00dcafef00dcafef00dcafef00dcafef00dcafef00d"

const test_alt_name = #"414c54"

// "ALT"

/// Listing input at `oref` carrying the listed NFT + 2 ADA, with a
/// caller-provided MarketDatum. Lets bulk tests mint listings that differ
/// in price denomination or other datum fields.
fn listing_input_with_datum(oref: OutputReference, md: MarketDatum) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: test_marketplace_addr(),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(test_listed_policy, test_listed_name, 1),
      datum: InlineDatum(md),
      reference_script: None,
    },
  }
}

/// Generic seller-output builder. Replaces `cnt_seller_output` when the
/// token isn't the canonical PRICE.
fn seller_output_for_token(
  tag: ByteArray,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
  to: Address,
) -> Output {
  Output {
    address: to,
    value: assets.from_lovelace(lovelace) |> assets.add(p, n, qty),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

/// Invoke the marketplace spend for a specific consumed listing.
fn invoke_bulk_spend(
  datum: MarketDatum,
  own_ref: OutputReference,
  redeemer: MarketRedeemer,
  tx: Transaction,
) -> Bool {
  let d: Data = datum
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(d),
    redeemer,
    own_ref,
    tx,
  )
}

// ---------------------------------------------------------------------------
// 2-listing same-token happy path
// ---------------------------------------------------------------------------

test bulk_buy_succeeds_two_listings_same_token() {
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      // Inputs canonically sorted by outref. A (0x10) < B (0x20).
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      // Seller A (idx 0) and seller B (idx 1) — each tagged to ITS listing.
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_seller_output(tag_b, 98, test_seller_addr()),
      // Jar (idx 2): 2 + 2 = 4 PRICE tokens deposited.
      cnt_jar_output(0, 4),
    ],
  }
  let r_a =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 0 }
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  let a_ok = invoke_bulk_spend(datum, listing_outref(), r_a, tx)
  let b_ok = invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
  a_ok && b_ok
}

// ---------------------------------------------------------------------------
// 2-listing mixed-currency happy path
// ---------------------------------------------------------------------------

test bulk_buy_succeeds_two_listings_mixed_tokens() {
  // Listing A: price 100 PRICE -> fee 2, seller 98.
  // Listing B: price 50 ALT    -> fee 1, seller 49.
  // Jar must gain >= 2 PRICE AND >= 1 ALT. The aggregate check splits per
  // (policy, name) and verifies each.
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum_a = cnt_datum()
  let datum_b =
    MarketDatum {
      seller_pkh: test_seller_pkh,
      seller_address: test_seller_addr(),
      price_policy: test_alt_policy,
      price_name: test_alt_name,
      price_qty: 50,
      accompanying_lovelace: 1_500_000,
    }
  let jar_out_value =
    assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 2)
      |> assets.add(test_alt_policy, test_alt_name, 1)
  let jar_out =
    Output {
      address: test_jar_addr(),
      value: jar_out_value,
      datum: InlineDatum(0),
      reference_script: None,
    }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      listing_input_with_datum(other_listing_outref(), datum_b),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      seller_output_for_token(
        tag_b,
        test_alt_policy,
        test_alt_name,
        49,
        1_500_000,
        test_seller_addr(),
      ),
      jar_out,
    ],
  }
  let r_a =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 0 }
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  let a_ok = invoke_bulk_spend(datum_a, listing_outref(), r_a, tx)
  let b_ok = invoke_bulk_spend(datum_b, other_listing_outref(), r_b, tx)
  a_ok && b_ok
}

// ---------------------------------------------------------------------------
// 3-listing same-token happy path
// ---------------------------------------------------------------------------

test bulk_buy_succeeds_three_listings_same_token() {
  let oref_c =
    OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000030",
      output_index: 0,
    }
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let tag_c = utils.compute_output_tag(oref_c)
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      cnt_listing_input_at(oref_c),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_seller_output(tag_b, 98, test_seller_addr()),
      cnt_seller_output(tag_c, 98, test_seller_addr()),
      // Aggregate fee = 2 + 2 + 2 = 6
      cnt_jar_output(0, 6),
    ],
  }
  let r_a =
    Buy { jar_input_index: 4, jar_output_index: 3, seller_output_index: 0 }
  let r_b =
    Buy { jar_input_index: 4, jar_output_index: 3, seller_output_index: 1 }
  let r_c =
    Buy { jar_input_index: 4, jar_output_index: 3, seller_output_index: 2 }
  let a_ok = invoke_bulk_spend(datum, listing_outref(), r_a, tx)
  let b_ok = invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
  let c_ok = invoke_bulk_spend(datum, oref_c, r_c, tx)
  a_ok && b_ok && c_ok
}

// ---------------------------------------------------------------------------
// Strict semantics: jar overpayment in the FEE TOKEN is rejected on bulk too.
// (Buyers who want to tip the protocol do it in ADA via the assets.match
// callback's `>=` lovelace check.)
// ---------------------------------------------------------------------------

test bulk_buy_fails_when_jar_overpaid_in_fee_token() fail {
  // Aggregate fee required = 4; buyer ships 7. Strict non-ADA equality
  // rejects on the leader's aggregate check.
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_seller_output(tag_b, 98, test_seller_addr()),
      cnt_jar_output(0, 7),
    ],
  }
  // Invoke the LEADER (listing A) — its aggregate check sees the strict
  // mismatch and rejects.
  let r_a =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 0 }
  let a_ok = invoke_bulk_spend(datum, listing_outref(), r_a, tx)
  // Keep the same shape as the original test (AND with a follower) so the
  // `fail` annotation observes the leader rejection.
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  let b_ok = invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
  a_ok && b_ok
}

// ---------------------------------------------------------------------------
// 2-listing mixed-currency, one token's delta is short -> fail
// ---------------------------------------------------------------------------

test bulk_buy_fails_when_alt_token_delta_short() fail {
  // PRICE delta covers listing A (2 PRICE), but ALT delta is 0 — listing B
  // requires 1 ALT. Leader's per-token aggregate check rejects.
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum_a = cnt_datum()
  let datum_b =
    MarketDatum {
      seller_pkh: test_seller_pkh,
      seller_address: test_seller_addr(),
      price_policy: test_alt_policy,
      price_name: test_alt_name,
      price_qty: 50,
      accompanying_lovelace: 1_500_000,
    }
  let jar_out_value =
    // Only PRICE deposited; ALT delta = 0.
    assets.from_lovelace(2_000_000)
      |> assets.add(test_price_policy, test_price_name, 2)
  let jar_out =
    Output {
      address: test_jar_addr(),
      value: jar_out_value,
      datum: InlineDatum(0),
      reference_script: None,
    }
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      listing_input_with_datum(other_listing_outref(), datum_b),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      seller_output_for_token(
        tag_b,
        test_alt_policy,
        test_alt_name,
        49,
        1_500_000,
        test_seller_addr(),
      ),
      jar_out,
    ],
  }
  // Invoke the LEADER (listing A) — its aggregate check sees ALT delta = 0
  // and rejects.
  let r_a =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 0 }
  invoke_bulk_spend(datum_a, listing_outref(), r_a, tx)
}

// ---------------------------------------------------------------------------
// 2-listing, B's seller output underpays -> B's local check fails
// ---------------------------------------------------------------------------

test bulk_buy_fails_when_listing_b_seller_underpaid() fail {
  // Listing B's seller output ships 97 instead of 98 — B's per-spend B3
  // assets.match rejects.
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_seller_output(tag_b, 97, test_seller_addr()),
      cnt_jar_output(0, 4),
    ],
  }
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  // Invoke B specifically — its local check fails.
  invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
}

// ---------------------------------------------------------------------------
// 2-listing, B's seller output tagged for the wrong outref -> B fails
// ---------------------------------------------------------------------------

test bulk_buy_fails_when_listing_b_seller_tag_wrong() fail {
  // B's seller output is tagged with A's compute_output_tag — anti-double
  // -sat binding rejects (B's per-spend B3 datum check).
  let tag_a = utils.compute_output_tag(listing_outref())
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      // ↓ tagged with A's tag instead of B's
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_jar_output(0, 4),
    ],
  }
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
}

// ---------------------------------------------------------------------------
// Non-leader's view: B's spend trusts the leader. Demonstrate that even
// when listing A's aggregate would fail, B's individual spend may STILL
// return True (it's just trusting the leader, which gets re-checked
// separately). This pins the leader-pattern semantics.
// ---------------------------------------------------------------------------

test bulk_buy_listing_b_alone_passes_even_when_aggregate_short() {
  // Jar got only 2 of the required 4 -> aggregate would fail at A. But B's
  // local check (its own seller output) is fine, and B trusts A to do the
  // aggregate. So invoking ONLY B returns True. (A's spend running on the
  // same tx would fail and invalidate the tx in production — that's the
  // leader-detection property at work.)
  let tag_a = utils.compute_output_tag(listing_outref())
  let tag_b = utils.compute_output_tag(other_listing_outref())
  let datum = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [
      cnt_listing_input(),
      cnt_listing_input_at(other_listing_outref()),
      buyer_funding_input(),
      cnt_jar_input(),
    ],
    outputs: [
      cnt_seller_output(tag_a, 98, test_seller_addr()),
      cnt_seller_output(tag_b, 98, test_seller_addr()),
      cnt_jar_output(0, 2),
    ],
  }
  let r_b =
    Buy { jar_input_index: 3, jar_output_index: 2, seller_output_index: 1 }
  invoke_bulk_spend(datum, other_listing_outref(), r_b, tx)
}

// ============================================================================
// Datum handling — Buy needs Some; Cancel uses defensive partial decode
// ============================================================================

test buy_fails_with_no_datum() fail {
  marketplace.marketplace.spend(
    test_jar_script_hash,
    None,
    happy_cnt_buy_redeemer(),
    listing_outref(),
    happy_cnt_buy_tx(),
  )
}

// ============================================================================
// Cancel path
// ============================================================================

test cancel_succeeds_with_seller_sig() {
  let datum: Data = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input()],
    extra_signatories: [test_seller_pkh],
  }
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

test cancel_fails_without_signer() fail {
  let datum: Data = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input()],
    extra_signatories: [],
  }
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

test cancel_fails_with_wrong_signer() fail {
  let datum: Data = cnt_datum()
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input()],
    extra_signatories: [test_other_pkh],
  }
  marketplace.marketplace.spend(
    test_jar_script_hash,
    Some(datum),
    Cancel,
    listing_outref(),
    tx,
  )
}

test cancel_fails_with_no_datum() fail {
  let tx = Transaction {
    ..transaction.placeholder,
    inputs: [cnt_listing_input()],
    extra_signatories: [test_seller_pkh],
  }
  marketplace.marketplace.spend(
    test_jar_script_hash,
    None,
    Cancel,
    listing_outref(),
    tx,
  )
}
