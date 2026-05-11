**Findings**

1. **[low] `SPEC.md` v0.4 is still stale in three places and no longer matches shipped behavior**
   - [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:90) still states C2 as “Exactly one output” at the config address, but the shipped validator explicitly accepts extra junk outputs via `list.expect_find` in [config.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/config.ak:25) and the test suite codifies that acceptance in [config.test.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/config.test.ak:372).
   - [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:102) still shows the listing spend signature as `datum: Option<ListingDatum>`, while code now uses `Option<Data>` in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:35).
   - [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:454) claims every swap invariant S1-S10 has positive and negative unit coverage and [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:459) claims bucket goldens, but the shipped tests explicitly document that S10 is not meaningfully unit-tested because `m = 1` in all fixtures in [listing.test.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:579).
   - This is not a validator bug, but it is a spec/code mismatch in the exact areas you asked me to verify.

2. **[informational] The cancel-path recovery guarantee is narrower than some comments imply**
   - `extract_first_bytearray_field` in [utils.ak](/Users/giovanni/Development/workspace/shithole/contracts/lib/shithole/utils.ak:44) succeeds only if the datum is a `Constr` whose first field is a bytestring. `un_constr_data`, `head_list`, or `un_b_data` will fail for root `Data` shapes like `Int`/`List`/`Map`, for an empty constructor field list, or for a non-bytes first field.
   - So the code does recover from a corrupt second field exactly as intended, and the current regression test in [listing.test.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:717) is meaningful. But “lister can always reclaim” in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:58) and [utils.ak](/Users/giovanni/Development/workspace/shithole/contracts/lib/shithole/utils.ak:40) is slightly too broad unless read as “for `Constr [bytes, ...]` datums”.

**Verification Notes**

- `validate_swap` does enforce S1-S10 as implemented in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:91). S4’s whole-datum equality in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:144) fully subsumes old “same `lister_pkh`” plus “`update_ref == Some(own_tag)`”.
- The `own_ref` seed removes the old per-attempt manipulation axis. A swapper can vary only:
  - which listing they target, which fixes `self.outRef`;
  - which owned NFT they deposit, which fixes `nb_asset_name`.
  Reordering inputs, changing funding UTxOs, paying different fees, or adding unrelated ref inputs does not change S10 in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:172).
- Double-satisfaction defenses still hold:
  - treasury side via S8 in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:167);
  - listing recreation side via S4 in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:155).
- The reverted `list.expect_find` in config is self-injurious only at the protocol level. Without a second config NFT, a second config-address output cannot impersonate the real config UTxO. The only plausible “benefit” is against a broken off-chain indexer that ignores the config NFT and scans by address alone; that would be an off-chain bug, not an on-chain exploit.
- `assets.has_any_nft_strict` and `assets.has_nft_strict` do implement strict-single-NFT semantics on the documented stdlib definitions in [assets.ak](/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/aiken-stdlib/cardano/assets.ak:183) and [assets.ak](/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/aiken-stdlib/cardano/assets.ak:299): empty value, ADA-only, multiple policies, multiple asset names, or quantity other than `1` all fail.
- `Option<Data>` is fine here. The swap branch immediately re-casts to `ListingDatum` in [listing.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.ak:45); the cancel branch intentionally stays at raw `Data`. That is a normal Plutus/Aiken pattern.
- Test coverage:
  - S1-S9 and K1 are covered with meaningful negatives.
  - S10 is still intentionally unproven at unit level because all tests use `m = 1`.
  - `multi_swap_blocked_by_treasury_tag_binding` still tests what it says after the redeemer simplification: it fails B on treasury tag mismatch, not on the removed UA logic, in [listing.test.ak](/Users/giovanni/Development/workspace/shithole/contracts/validators/listing.test.ak:594).
  - `cancel_succeeds_with_corrupt_update_ref_field` is a good test as written; `Constr [bytes, int]` is the right minimal shape to prove “bad second field tolerated”.

**Overall verdict**: further changes needed.

The validator refactor itself looks sound and I did not find a new protocol or security bug. What still needs fixing before commit is the v0.4 documentation/test-strategy alignment in `SPEC.md`, and optionally tightening the cancel-path comments so they describe the actual recovery envelope precisely.
