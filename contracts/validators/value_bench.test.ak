use aiken/collection/dict
use cardano/assets.{
  AssetName, PolicyId, Value, ada_asset_name, ada_policy_id, lovelace_of,
  quantity_of,
}

// ============================================================================
// Value-check benchmark — comparing implementations of the marketplace's
// seller-output value invariant: "value has >= qty of (price_policy,
// price_name) AND >= lovelace ADA".
//
// All five variants produce identical results on a canonical seller output
// (1.5 ADA + 98 PRICE tokens, the happy-path shape). Variants B/C/D/E
// enforce STRICT non-ADA equality (the value must carry ONLY the price
// token, no extras) — a defensible tightening of marketplace semantics
// over A's permissive `>= quantity_of` lookup. The bench tells us what we
// pay for either choice.
//
// Aiken reports per-test `mem` and `cpu` (`PASS [mem: ..., cpu: ...]`).
// Compare the numbers across the five variants below to pick the winner.
// The cheapest variant — measured in lower CPU AND lower mem — is the one
// to bake into `marketplace.ak`'s `validate_buy`.
// ============================================================================

const test_policy =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const test_name = #"50524943"

const test_qty: Int = 98

const test_lovelace: Int = 1_500_000

/// Canonical seller-output value: 1.5 ADA + 98 PRICE. Built fresh per test
/// so its cost is included in each measurement uniformly.
fn test_value() -> Value {
  assets.from_lovelace(test_lovelace)
    |> assets.add(test_policy, test_name, test_qty)
}

// ----------------------------------------------------------------------------
// Variant A — two direct lookups (current marketplace.ak shape).
//
// Semantics: `>=` on the price token; `>=` on lovelace. Extra non-ADA assets
// on the value are TOLERATED (not enforced absent).
// ----------------------------------------------------------------------------

fn check_a(
  v: Value,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
) -> Bool {
  and {
    quantity_of(v, p, n) >= qty,
    lovelace_of(v) >= lovelace,
  }
}

test bench_a_quantity_of_plus_lovelace_of() {
  check_a(test_value(), test_policy, test_name, test_qty, test_lovelace)
}

// ----------------------------------------------------------------------------
// Variant B — build expected via `assets.add`, compare with `assets.match`.
//
// Semantics: STRICT non-ADA equality (value must carry exactly `qty` of the
// price token and nothing else under any non-ADA policy); `>=` on lovelace.
// ----------------------------------------------------------------------------

fn check_b(
  v: Value,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
) -> Bool {
  let expected = assets.from_lovelace(lovelace) |> assets.add(p, n, qty)
  let expected_data: Data = expected
  assets.match(v, expected_data, fn(actual, expected_) { actual >= expected_ })
}

test bench_b_match_via_assets_add() {
  check_b(test_value(), test_policy, test_name, test_qty, test_lovelace)
}

// ----------------------------------------------------------------------------
// Variant C — build expected via `dict.from_ascending_pairs`, compare with
// `assets.match`. Matches the pattern listing.ak uses for its swap-output
// check.
//
// Semantics: same as B (strict non-ADA, >= lovelace), but the expected is
// constructed as a bare `Dict` (no `Value` wrapper) — Aiken implicitly
// upcasts to Data via assets.match's `right: Data` parameter.
// ----------------------------------------------------------------------------

fn check_c(
  v: Value,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
) -> Bool {
  let expected_dict =
    dict.from_ascending_pairs(
      [
        Pair(ada_policy_id, dict.singleton(ada_asset_name, lovelace)),
        Pair(p, dict.singleton(n, qty)),
      ],
    )
  assets.match(v, expected_dict, fn(actual, expected_) { actual >= expected_ })
}

test bench_c_match_via_dict_ascending() {
  check_c(test_value(), test_policy, test_name, test_qty, test_lovelace)
}

// ----------------------------------------------------------------------------
// Variant D — strict-eq on the without-ADA slice + `lovelace_of >=`.
//
// Semantics: STRICT non-ADA equality (constructed via `from_asset`,
// which yields a Value with ONLY the price token entry); `>=` on lovelace.
// Same semantics as B/C but uses a different machinery (no `assets.match`
// — two independent comparisons).
// ----------------------------------------------------------------------------

fn check_d(
  v: Value,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
) -> Bool {
  let expected_non_ada = assets.from_asset(p, n, qty)
  and {
    assets.without_lovelace(v) == expected_non_ada,
    lovelace_of(v) >= lovelace,
  }
}

test bench_d_without_lovelace_strict_eq() {
  check_d(test_value(), test_policy, test_name, test_qty, test_lovelace)
}

// ----------------------------------------------------------------------------
// Variant E — `assets.expect_match` (fail-fast variant of B).
//
// Same semantics and build path as B; `expect_match` aborts on bad-shape
// `right` instead of returning `False`, which the stdlib doc calls
// "slightly more efficient". Quantifying the delta is the point of this
// test.
// ----------------------------------------------------------------------------

fn check_e(
  v: Value,
  p: PolicyId,
  n: AssetName,
  qty: Int,
  lovelace: Int,
) -> Bool {
  let expected = assets.from_lovelace(lovelace) |> assets.add(p, n, qty)
  let expected_data: Data = expected
  assets.expect_match(
    v,
    expected_data,
    fn(actual, expected_) { actual >= expected_ },
  )
}

test bench_e_expect_match_via_assets_add() {
  check_e(test_value(), test_policy, test_name, test_qty, test_lovelace)
}
