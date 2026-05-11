# Review Findings

No findings.

## Verification Notes

- **[clean] Finding 1 (`M4` / `C2` uniqueness) is correctly fixed.** [`unique_matching_output`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:176>) now replaces `list.find` in both the mint path and spend path ([`config.ak:82`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:82>), [`config.ak:140`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:140>)). The two new tests in [`config.test.ak:366`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.test.ak:366>) and [`config.test.ak:380`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.test.ak:380>) pin the intended rejection case.

- **[clean] `unique_matching_output` is correct, including the `else { acc }` branch.** In [`config.ak:180-195`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:180>), the accumulator is `(count, found)`. On a non-match, returning `acc` is exactly right: it preserves both the prior count and any previously found matching output. On a second match, `found` gets overwritten, but that is harmless because `count` becomes `2` and `expect 1 = count` aborts before the returned output can matter.

- **[clean] Finding 3’s multi-swap regression is testing S10, not accidentally S6.** In [`listing.test.ak:688-744`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:688>), the validator is invoked for input B via `own_ref = other_listing_outref()`. For that invocation:
  - `listing_output_index: 1` points at B’s recreated listing output, which carries `Some(tag_b)`, so S6 passes.
  - `treasury_output_index: 2` points at the only treasury output, which is correctly addressed and correctly funded, so S9 and S11 pass.
  - Its datum is `tag_a`, not `tag_b`, so the failure is S10 at [`listing.ak:145-146`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:145>).

- **[clean] Findings 4 and 5 are adequately covered.** The added wrong-policy / quantity-2 negatives for S2 and S7 in [`listing.test.ak:564-658`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:564>) are aligned with `is_strict_single_nft` in [`listing.ak:166-171`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:166>). The negative and out-of-range `nb_input_index` tests in [`listing.test.ak:665-672`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:665>) correctly pin the `expect Some(ua) = list.at(...)` behavior at [`listing.ak:120`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:120>).

- **[clean] The bonus tests are worthwhile and target the intended paths.** [`config.test.ak:400-410`](</Users/giovanni/Development/workspace/shithole/contracts/validators/config.test.ak:400>) closes the spend-side protocol-fee floor gap. [`listing.test.ak:753-761`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:753>) correctly pins the `expect Some(input_datum) = datum` failure at [`listing.ak:32`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:32>).

- **[accepted] Finding 2 (`S12`) remains unproven by unit tests, but the deferral is reasonable.** The code path is unchanged and still looks correct in [`listing.ak:149-156`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:149>) and [`listing.ak:175-194`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:175>). The gap is now explicitly documented in [`listing.test.ak:762-773`](</Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:762>). I would still want a golden before mainnet-grade signoff, but I would not block this commit on it given the current scope and the fact that this pass was about verifying the earlier fixes rather than changing the bucket code.

## Overall Verdict

Ready to commit.

Source inspection says the five original findings are addressed as intended, I do not see a new regression from these fixes, and the S12 deferral is acceptable for this commit as long as the documented integration-level golden remains scheduled. I did not rerun `aiken check -D` in this read-only sandbox, so that part is based on your reported state rather than an independent execution.
