agent messages: 5
  item_0 — 272 chars
  item_9 — 224 chars
  item_15 — 288 chars
  item_25 — 241 chars
=== final (item_28, 10519 chars) ===
# Review Findings

## 1. `config` does not enforce the “exactly one continuing config output” part of `C2` / `M4`
- **Severity**: medium
- **Title**: Config validator accepts extra outputs at the config script address
- **Location**: `/Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:78-97`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:133-145`
- **Description**: Both the mint path (`M4`) and spend path (`C2`) use `list.find`, which proves only that at least one matching output exists. The spec requires a single config UTxO at the script address; the current code allows an additional junk output at the same address, as long as one output carries the config NFT. This is not an immediate theft vector, but it weakens the “single continuing UTxO” invariant the rest of the protocol assumes and makes state hygiene depend on off-chain behavior. The current tests also never try to create a second output at the config address, so this gap is not pinned.
- **Recommended fix**: Replace `list.find` with a uniqueness check over outputs and require exactly one match.
```aiken
fn unique_matching_output(outputs: List<Output>, pred: fn(Output) -> Bool) -> Output {
  let (count, found) =
    list.foldl(outputs, (0, None), fn(o, acc) {
      let (n, keep) = acc
      if pred(o) {
        (n + 1, Some(o))
      } else {
        acc
      }
    })

  expect 1 = count
  expect Some(output) = found
  output
}
```
Use that helper in both `spend` and `is_mint_output_valid`, and add failing tests with two outputs at the config address.

## 2. `S12` is not meaningfully tested
- **Severity**: medium
- **Title**: Bucket equation coverage is effectively absent because all swap fixtures use `m = 1`
- **Location**: `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:70-78`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:509-518`
- **Description**: The validator does enforce `S12` correctly in code, using `ua.output_reference` and `cbor.serialise(ua_outref)` exactly as the spec requires. But the tests never exercise a real bucket comparison because `valid_config_datum()` hardcodes `m: 1`, making every modulo comparison trivially true. That means a broken hash input order, wrong CBOR seed, or wrong entropy source would not be caught by the current unit suite. For a protocol whose swap selection depends on this invariant, that is too large a blind spot.
- **Recommended fix**: Add at least one positive and one negative unit test with `m >= 2` using hard-coded `(na, nb, ua_outref)` fixtures whose buckets are precomputed off-chain. Concretely:
  - Add `valid_config_datum_m3()`.
  - Add `swap_succeeds_with_real_bucket_match()`.
  - Add `swap_fails_with_bucket_mismatch()`.

## 3. Double-satisfaction defenses are untested in the multi-input shape they are meant to protect
- **Severity**: low
- **Title**: No atomic multi-swap regression test for “two listings, one treasury/listing output”
- **Location**: `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:116-156`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:172-518`
- **Description**: The implementation of `S6` and `S10` is correct: each consumed listing computes `own_tag` from its own `own_ref`, so the check is per input, not once per transaction. I do not see a code bug there. But the tests only cover single-listing transactions, so the actual double-satisfaction threat model from SPEC §8.1 is not regression-tested. Given how subtle this class of bug is, the missing test is material.
- **Recommended fix**: Add a test that invokes the validator twice in the same synthetic transaction, consuming two listing inputs but providing only one treasury output and/or one recreated listing output. One input should be satisfiable; the second must fail because its `own_tag` differs.

## 4. Strict single-NFT enforcement is correct, but the negative test coverage is too narrow
- **Severity**: low
- **Title**: `S2` and `S7` only test one malformed-value shape each
- **Location**: `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:166-171`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:248-258`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:384-409`
- **Description**: `is_strict_single_nft` is correct: `assets.without_lovelace(value) == assets.from_asset(policy, asset_name, 1)` rejects empty values, extra assets, wrong policy, wrong asset name, and quantity other than `1`. I do not see a bypass in the helper. The weakness is test coverage: `S2` only has a “wrong asset name” negative, and `S7` only has an “extra asset” negative. There is no regression test for wrong policy or quantity `!= 1`, which are exactly the edge cases the spec calls out.
- **Recommended fix**: Add four failing tests:
  - input has correct asset name under wrong policy
  - input has quantity `2`
  - output listing has correct asset name under wrong policy
  - output listing has quantity `2`

## 5. `nb_input_index` safety is fine in code, but boundary behavior is not pinned by tests
- **Severity**: informational
- **Title**: Negative and out-of-range `nb_input_index` cases are not unit-tested
- **Location**: `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:119-122`, `/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:264-267`
- **Description**: I do not see an abuse path here. `list.at` returns `None` for negative and out-of-range indices, and the validator uses `expect Some(ua)`, so both cases fail safely; the stdlib confirms `at([..], -1) == None`. An index pointing to an input that holds `NB` plus other assets is also acceptable under the locked spec, because `S3` only requires that UA physically contains `(collection_policy, nb_asset_name) x 1`. The gap is purely that the suite tests only one wrong index shape.
- **Recommended fix**: Add failing tests for `nb_input_index = -1` and `nb_input_index = 99`.

# Invariant Cross-Check

| Invariant | Enforced in code | Test status |
|---|---|---|
| `M1` | Yes | positive + negative |
| `M2` | Yes | positive + negative |
| `M3` | Yes | positive + negative |
| `M4` | Partial: datum floors and NFT presence enforced, but “single output” exactness is not | positive + partial negative |
| `C1` | Yes | positive + negative |
| `C2` | Partial: same-NFT continuing output required, but uniqueness at address not enforced | positive + partial negative |
| `C3` | Yes | positive + negative |
| `C4` | Yes | positive only on spend path; negative covered only on mint path |
| `C5` | Yes | positive + negative |
| `C6` | Yes | positive + negative |
| `S1` | Yes | positive + negative |
| `S2` | Yes | positive + one negative only |
| `S3` | Yes | positive + one negative only |
| `S4` | Yes | positive + negative |
| `S5` | Yes | positive + negative |
| `S6` | Yes | positive + negative |
| `S7` | Yes | positive + one negative only |
| `S8` | Yes | positive + negative |
| `S9` | Yes | positive + negative |
| `S10` | Yes | positive + negative |
| `S11` | Yes | positive + negative |
| `S12` | Yes | no meaningful positive, no negative |
| `K1` | Yes | positive + negative |

# Category Notes

## A. Aiken-specific bugs and idioms
No findings beyond the test gaps above.

- UA anchoring is correct: the code uses `ua = list.at(inputs, nb_input_index)` and then `ua.output_reference`, not `tx.inputs[0]` or `list.head` in [`listing.ak`](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:119).
- Double-satisfaction defense is applied per consumed input via `own_ref` in both `S6` and `S10`, with `compute_output_tag` computed once and reused in [`listing.ak`](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:116).
- `expect` is used appropriately for single-variant destructuring throughout.
- I did not find the red-flag hot-path stdlib calls you named.
- `extra_signatories` is used, not on-chain signature verification.
- `compute_output_tag` matches the mirrored reference helper and uses `cbor.serialise(oref)` consistently, so I do not see an on-chain CBOR mismatch source.

## C. Listing strict-shape enforcement
No code bug found.

`assets.without_lovelace(value) == assets.from_asset(policy, asset_name, 1)` correctly rejects:
- multiple non-ADA assets
- the right asset with quantity other than `1`
- the right asset name under a different policy
- empty non-ADA sets

The issue is only missing negative test breadth.

## D. `nb_input_index`
No exploit found.

Negative and out-of-range indices fail because `list.at` returns `None`. An input containing `NB` plus other assets is allowed by the spec and by the current code.

## E. Configurations and rotations
Mostly correct.

- output config UTxO preservation is only partially enforced because of the uniqueness gap in finding `out_cfg`
- config NFT preservation is enforced strongly enough for realistic chain behavior
- datum floors are enforced
- admin rotation requires both old and new signatures
- `treasury_addr` is freely mutable
- `collection_policy_id` remains effectively immutable because it is carried by the config NFT asset name

## F. Missing tests
Additional missing tests beyond the formal findings:
- malformed `NoDatum` listing spend should fail explicitly
- batch cancel with multiple listing inputs signed by the lister
- spend-path negative for `protocol_fee < 0`

## G. Performance
No significant performance findings.

- `S12` is last, which is the right place for the two hashes
- common subexpressions are extracted (`own_input`, `own_address`, `input_lovelace`, `own_tag`)
- `compute_output_tag(own_ref)` is computed once and reused
- the only ordering tweak I would consider is delaying `out_listing` datum decoding until after the cheap address check, but that is minor

# Overall Verdict

These contracts are not ready to commit as-is for Giovanni-side review.

The main code issue to fix first is the missing uniqueness enforcement for the config output in `M4` / `C2`. After that, the next priority is test quality: `S12` is currently unproven by unit tests, and the multi-swap double-satisfaction case that motivated `compute_output_tag` is not covered. The listing validator logic itself looks sound, and I did not find a direct swap-theft path in the implemented invariants.
