Summary: `critical 0`, `high 0`, `medium 1`, `low 2`, `informational 3`. I could not write `/tmp/codex-shithole-findings.md` because the sandbox is read-only; the Markdown document follows.

```markdown
# Adversarial Review of Shithole SPEC v0.2

## Overall
No critical or high-severity exploit fell out of the current spec. The main real risk is poisoned listing UTxOs caused by open creation and by the swap path validating only one designated successor output. The randomness section also understates the real grinding surface, and the bucket-math table is not numerically correct as written.

## 1. Missing invariants

### Finding 1
- **Severity**: medium
- **Title**: Listing well-formedness is not globally enforced, so attackers can create poisoned or permanently unspendable “listings”
- **Description**: The spec repeatedly describes a listing UTxO as “exactly one NFT plus accrued ADA” (`SPEC.md:26`, `SPEC.md:182`, `SPEC.md:233-238`), but that is only enforced when a listing is later *spent* and only for the single `out_listing` selected by the redeemer. Initial listing creation is plain pay-to-script with no validator run (`SPEC.md:176-185`), and the swap path does not forbid additional outputs at the same script address. This means arbitrary junk UTxOs can exist at the listing address: wrong datum shape, wrong policy, multiple assets, datum-hash-only outputs, or outputs intentionally made uneconomic to swap. The protocol may still be safe on-chain, but indexers, FE discovery, and users can be trapped into interacting with UTxOs that can never satisfy S2/S6/S7.
- **Attack scenario**: An attacker submits a plain pay-to-script tx creating many outputs at the listing address, each with a collection-looking NFT but malformed datum or extra tokens. Later, they can also submit a legitimate swap and piggyback extra malformed outputs at the same script address, because S3-S7 only validate the designated `listing_output_index`. If the FE/indexer treats “UTxO at script address” as a listing without strict shape checks, users will see listings that always fail on swap.
- **Recommended fix**: Treat strict off-chain filtering as a protocol requirement, not an implementation detail: index only UTxOs with inline `ListingDatum`, exactly one non-ADA asset under the collection policy, and no extra assets. If you want this guaranteed on-chain, add an authenticated creation path or tighten swap/update rules so no extra listing-shaped outputs may be emitted in swap txs.

No other direct missing invariant produced a stronger exploit than the poisoned-listing surface above. In particular, I did not find a path that bypasses S4/S5/S9/S11 as written.

## 2. Attack vectors

### Finding 2
- **Severity**: informational
- **Title**: Grinding surface is broader and cheaper than the spec claims
- **Description**: The spec says the only controllable seed axes are `nb_asset_name` and “funding UTxOs” (`SPEC.md:281-288`), but the seed actually depends on `tx.inputs[0].outRef`, i.e. the lexicographically first *regular input* of the whole transaction (`SPEC.md:242-245`). That includes wallet inputs, other script inputs, and mixed cancel+swap transactions. A swapper who already owns listings can include a `Cancel` input for one of their own listings and, if needed, recreate it in the same tx via plain pay-to-script, giving themselves an extra first-input axis without the “UTxO split cost” the spec emphasizes. This does not invalidate the accepted bounded-grinding risk, but it materially weakens the stated cost model.
- **Attack scenario**: The attacker wants a specific bucket hit for `NB`. Instead of manufacturing many ADA funding UTxOs, they include one of their own listing UTxOs as a `Cancel` input and select whichever owned UTxO sorts first, retrying with existing wallet/script inputs until the seed matches the desired bucket.
- **Recommended fix**: Clarify the threat model: the controllable axis is “the lexicographically first regular input,” not “funding UTxOs.” If you want to narrow this, seed from something more tightly scoped to the swap itself, though that is a protocol redesign.

No exploitable failure was found in the stated ref-input substitution defense, assuming the config NFT is truly unique under `config_nft_policy` and datum decoding failure causes validation failure. I also did not find a way to consume the config UTxO and avoid recreating it if C2 is implemented exactly.

### Finding 3
- **Severity**: low
- **Title**: `treasury_addr` being any `Address` can make swaps unspendable or operationally inconsistent
- **Description**: The datum type allows `treasury_addr: Address`, including script credentials (`SPEC.md:63`, `SPEC.md:92`, `SPEC.md:356`), but S8-S10 only require that the treasury output be sent there with the tagged inline datum and enough lovelace (`SPEC.md:239-241`). A malicious or careless admin can point treasury at a script that rejects this datum shape, requires a different staking/payment structure, or otherwise makes fee outputs operationally useless. This is not a theft vector against users beyond admin misconfiguration, but it is a real footgun and contradicts the overview’s “treasury wallet” framing.
- **Attack scenario**: Admin updates config so `treasury_addr` is a third-party script address that cannot later spend tagged one-output payments, or an address the UI/backend cannot reason about. Swaps still validate, but protocol fees are stranded or the collection becomes practically unusable.
- **Recommended fix**: Either constrain `treasury_addr` to a payment key address/base address, or explicitly document that script treasuries are allowed only if they accept the exact tagged-output shape required by S9.

### Finding 4
- **Severity**: informational
- **Title**: Asset-name-as-policy-id is only length-checked, so curation must validate semantics off-chain
- **Description**: M3 enforces only `length(asset_name) == 28` (`SPEC.md:76`, `SPEC.md:322`), which is enough for byte-shape but not enough to prove the bytes correspond to a meaningful NFT collection policy. A malicious deployer can create a config whose asset name is an arbitrary 28-byte string and then market it as a collection. On-chain this is not forgeable under the *same* config policy, but off-chain components must not assume “28 bytes” means “real curated collection policy with actual NFTs.”
- **Attack scenario**: A deployer mints a config NFT whose asset name is arbitrary 28-byte garbage, adds a theme/slug off-chain, and tries to get it curated. Users see a market that either has no valid listings or listings only for attacker-controlled junk assets under that byte string.
- **Recommended fix**: Add an explicit curation requirement: before surfacing a config, the backend must verify that the config NFT asset name matches a real observed policy with the expected NFT population.

## 3. Math errors

### Finding 5
- **Severity**: informational
- **Title**: The bucket-coverage table mixes an approximation with incorrect “avg per non-empty bucket” values
- **Description**: The exact expected non-empty-bucket fraction is `1 - (1 - 1/M)^N`; `1 - e^(-N/M)` is the standard large-`N` approximation. That approximation is fine here, but the third column in `SPEC.md:296-304` is not correct if it means “per non-empty bucket”: for `M = N/2`, `N/3`, `N/5`, the conditional averages are about `2.31`, `3.16`, and `5.03`, not `2`, `3`, and `5`. If the intent was “average per bucket overall,” then the column label is wrong.
- **Recommended fix**: Change the text to “coverage is approximately `1 - e^(-N/M)` for large `N`,” and either relabel the third column to “avg per bucket” or replace it with the correct conditional values above.

## 4. Ambiguous semantics

### Finding 6
- **Severity**: low
- **Title**: The spec overstates what is guaranteed on-chain about listings
- **Description**: Several sections speak as if “a listing UTxO” is always a well-formed protocol object (`SPEC.md:26-27`, `SPEC.md:182`, `SPEC.md:196`, `SPEC.md:206`), but the chain only guarantees that for a consumed input satisfying S2 and for one designated successor output satisfying S3-S7. Everything else at the script address is just a UTxO. This matters because FE/BE implementers may read the prose as a stronger invariant than the validator actually enforces.
- **Recommended fix**: Add a sentence in §5.3/§6.3 stating that the listing address is permissionless and may contain malformed UTxOs; discoverability depends on strict off-chain filtering.

No additional ambiguity produced a distinct validator-breaking exploit. The config reference-input story is slightly under-specified on address/datum-shape authentication, but uniqueness of the config NFT appears sufficient in practice.

## 5. Missing transaction patterns

### Finding 7
- **Severity**: low
- **Title**: There is no supported path for listers to refresh or manage a listing without full cancel-and-relist
- **Description**: The protocol supports create, swap, cancel, and admin config update, but not “edit listing,” “claim accrued lister fees without withdrawing the NFT,” or “replace the currently held NFT while keeping queue position/history.” Given that lister fees accrue on the listing UTxO itself, a lister who wants the ADA but still wants to stay listed must fully cancel and relist. This is not a security bug, but it is a real missing flow that affects UX and indexer semantics.
- **Recommended fix**: Either document cancel-and-relist as the intended management flow, or add a lister-authorized “refresh” redeemer that preserves `lister_pkh` while allowing controlled value withdrawal / asset replacement.

## Explicit no-findings notes

- **Double-satisfaction**: I did not find a transaction that breaks S5 + S9 as stated, including multi-swap atomic txs and mixed cancel+swap txs, assuming `compute_output_tag` collision resistance.
- **Ref-input substitution**: I did not find a way to substitute a fake config under a different policy, because the listing validator is parameterized by `config_nft_policy` and the config NFT is one-shot.
- **Config continuing-UTxO**: I did not find a way to consume the config UTxO without recreating exactly one successor with the NFT, if C2 is implemented literally.
- **MIN_LISTER_FEE circumvention**: I did not find a way to get a successful swap that leaves the designated successor listing with less than `input.lovelace + cfg.lister_fee`.
```


