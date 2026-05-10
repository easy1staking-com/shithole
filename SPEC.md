# Shithole — Protocol Specification

**Status:** **LOCKED v0.3** — clean second Codex adversarial review (no new findings). Ready for plan mode and scaffolding.
**Date:** 2026-05-10.

---

## 1. Overview

Shithole is a Cardano dApp that lets holders of "dead" or rugpulled NFT collections swap their unwanted assets for *other* unwanted assets *from the same collection*. The name is a deliberate play on **Wormhole** (the cross-chain bridge): wormholes carry value across chains, shithole carries worthlessness in circles within one collection.

The protocol's economic premise is the saving grace for several of its design choices: by definition, no individual NFT in a "dead" listing is materially more valuable than any other. This permits trade-offs (bounded grinding on randomness, label injection acceptance) that would be unsuitable for a marketplace handling valuable assets.

Per swap, two fixed lovelace fees are paid (both per-collection-configurable, with one floor):
- `protocol_fee` (≥ 0) → a treasury wallet controlled by the per-collection admin.
- `lister_fee` (≥ `MIN_LISTER_FEE` = 1 ADA, hardcoded floor) → accrued *on the listing UTxO itself*, claimable by the original lister via cancel-and-relist.

There is no global protocol contract, no shared admin, no on-chain registry. Each "dead collection market" is a self-contained per-collection deployment, curated off-chain by the FE/BE.

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Listing UTxO** (well-formed) | A UTxO at the parameterized spend-script address holding exactly one NFT (under the collection policy) plus accrued ADA, with an inline `ListingDatum`. The chain does NOT enforce well-formedness on creation; off-chain curation does. See §10.2 for the indexer filter. |
| **Lister** | The user who created the initial listing UTxO. Their `pkh` is recorded in the listing datum and never changes thereafter; only they can cancel. |
| **Swapper** | A user who deposits an NFT and consumes a listing UTxO, paying the two protocol fees. |
| **Config UTxO** | A UTxO at the **config validator's own address** (same hash that mints the config NFT) holding the per-collection parameters. Read on every swap as a CIP-31 reference input; consumed only by the admin to update parameters. |
| **Config NFT** | A one-shot NFT minted by the config validator's mint handler. Its **policy id is the config validator's hash**; its **asset name is the 28 bytes of the collection policy id** it governs. |
| **`config_nft_policy`** | Policy id of the config NFT. Equal to the config validator's compiled hash. The spend (listing) validator is parameterized at compile-time on this. |
| **NA / NB** | NA is the NFT currently held by the listing being swapped against. NB is the NFT being deposited by the swapper. Both share the same `collection_policy_id`. |
| **UA** | The transaction input that holds NB. Its `OutputReference` (`UA.outRef`) is the per-swap entropy source for the bucket calculation. |
| **Bucket** | An integer in `[0, M)` derived from a hash of `(policy_id ‖ asset_name)` mod `M`. Used for deterministic NFT selection on swap. |
| **M** | The number of buckets; positive integer set per-collection by the admin. Stored in the config datum. Sized roughly as `well_formed_listings / 3` for ~95% non-empty bucket coverage. |
| **outRef** | An `OutputReference` (transaction id + output index). Used as a uniqueness tag for double-satisfaction defenses and as the bucket-seed entropy source. |
| **`compute_output_tag`** | A shared helper: `blake2b_256(cbor.serialise(outRef))`. Returns a fixed 32-byte tag used to bind output uniqueness to consumed input uniqueness. Same convention as `jpgstore-sniper`. |
| **`MIN_LISTER_FEE`** | Compile-time constant in the config validator. 1 ADA (`1_000_000` lovelace). Enforced floor on every config update. |

---

## 3. On-chain components

The protocol consists of two Aiken validators per deployed collection:

### 3.1 Config validator (multi-handler: mint + spend)

A single Aiken `validator` block providing both `mint` and `spend` handlers. Its compiled hash is used as both the policy id (when minting the config NFT) and the script credential of the address holding the config UTxO. This is how the "continuing UTxO" property is guaranteed: only this script can spend the config UTxO, and only its rules let it be re-created.

```aiken
validator config(seed_utxo: OutputReference) {
  mint(_redeemer: Void, policy_id: PolicyId, self: Transaction) { ... }
  spend(datum: Option<ConfigDatum>, _redeemer: Void, self_ref: OutputReference, self: Transaction) { ... }
  else(_) { fail }
}
```

#### Config datum

```aiken
type ConfigDatum {
  m: Int,
  protocol_fee: Int,         // lovelace; >= 0
  lister_fee: Int,           // lovelace; >= MIN_LISTER_FEE
  treasury_addr: Address,    // standard Aiken Address (base or script credentials, see note below)
  admin_pkh: VerificationKeyHash,
}
```

`collection_policy_id` is **not** a datum field — it lives as the config NFT's asset name, fixed forever at mint.

**Note on `treasury_addr`.** The type allows a script credential, but in practice this should always be a base/payment-key address (a wallet — possibly hardware). If an admin ever sets a script credential, that script **must** accept payments with our tagged inline datum and not require any other signatures or datum fields. Otherwise protocol fees become stranded. Recommended off-chain hygiene: the BE refuses to surface or update a config whose `treasury_addr` is a script credential unless explicitly opted into.

#### Mint handler — the one-shot

| # | Invariant |
|---|---|
| M1 | `seed_utxo` (compile-time parameter) appears in `tx.inputs`. Guarantees one-shot. |
| M2 | `tx.mint` contains exactly one entry under `policy_id`, with quantity `+1`. (No burning is allowed; the policy mints exactly once and the NFT exists forever.) |
| M3 | The minted asset name is exactly 28 bytes long. (Defensive: enforces "asset name = collection policy id" by length. The bytes themselves are not verifiable on-chain — see §10.3 for off-chain curation requirement.) |
| M4 | A single output exists at `Address(ScriptCredential(policy_id))` containing the minted NFT and an inline `ConfigDatum` satisfying §3.1's spend-side validation rules below (M ≥ 1, fees within floors). |

#### Spend handler — admin updates

A single redeemer (`Void`); every spend re-runs all checks. There is no "Retire" path — the config NFT is permanent.

| # | Invariant |
|---|---|
| C1 | `tx.extra_signatories` contains `input.datum.admin_pkh`. |
| C2 | Exactly one output at `input.address` (same script credential), containing the same config NFT (policy + asset name preserved). Call this `out_cfg`. |
| C3 | `out_cfg.datum.m >= 1`. |
| C4 | `out_cfg.datum.protocol_fee >= 0`. |
| C5 | `out_cfg.datum.lister_fee >= MIN_LISTER_FEE`. |
| C6 | If `out_cfg.datum.admin_pkh != input.datum.admin_pkh`, `tx.extra_signatories` also contains `out_cfg.datum.admin_pkh`. |

`treasury_addr` mutates freely (subject to the off-chain hygiene note above). `collection_policy_id` is unchangeable because it's an asset-name property.

### 3.2 Spend validator — listings (parameterized)

```aiken
validator listing(config_nft_policy: PolicyId) {
  spend(datum: Option<ListingDatum>, redeemer: ListingRedeemer, self_ref: OutputReference, self: Transaction) { ... }
  else(_) { fail }
}
```

The address is deterministic in the `config_nft_policy` parameter — each config produces a unique spend-script address.

#### Listing datum

```aiken
type ListingDatum {
  lister_pkh: VerificationKeyHash,
  update_ref: Option<ByteArray>,   // Some(compute_output_tag(prior_outRef)) post-swap; None at initial creation
}
```

#### Listing redeemer

```aiken
type ListingRedeemer {
  Swap {
    na_asset_name: AssetName,
    nb_asset_name: AssetName,
    nb_input_index: Int,            // index into tx.inputs of the UTxO containing NB (called UA below)
    listing_output_index: Int,      // index into tx.outputs of the new listing UTxO
    treasury_output_index: Int,     // index into tx.outputs of the protocol-fee payment
  }
  | Cancel
}
```

All three index hints turn O(N) scans into O(1). Wrong hints cause downstream equality checks to fail; no security cost. The swapper / FE is responsible for computing them after Cardano's deterministic input/output ordering is applied.

---

## 4. Datum and tag schemas (canonical forms)

| Where | Type | Purpose |
|---|---|---|
| Config UTxO | `ConfigDatum` (5 fields, see §3.1) | Per-collection parameters, read as ref input on every swap. |
| Listing UTxO | `ListingDatum` (`lister_pkh`, `update_ref: Option<ByteArray>`) | Persistent lister identity + double-satisfaction binding for the next swap. |
| Treasury output (per swap) | Inline `ByteArray` | `compute_output_tag(input.outRef)` of the listing UTxO consumed in this swap. Double-satisfaction binding for the protocol-fee output. |

`compute_output_tag` is shared across both bindings — one shared utility, applied uniformly.

```aiken
pub fn compute_output_tag(oref: OutputReference) -> ByteArray {
  oref |> cbor.serialise |> blake2b_256
}
```

---

## 5. Transaction patterns

The protocol supports four distinct transaction types. All pre/post conditions are enforced by validators or by the chain itself.

### 5.1 Deploy a config

| Item | Detail |
|---|---|
| Signers | Deployer (anyone) |
| Inputs | `seed_utxo` (the deployer's UTxO that will parameterize the config validator) plus any funding |
| Outputs | 1× config UTxO at `Address(ScriptCredential(config_nft_policy))` holding `min_ADA + 1× config NFT (asset name = collection_policy_id, 28 bytes)`, with inline `ConfigDatum` satisfying C3-C5 |
| Mints | +1 of `config_nft_policy::collection_policy_id_28_bytes` |
| Reference inputs | None |
| Validators | Config validator's `mint` handler |

### 5.2 Update a config (admin)

| Item | Detail |
|---|---|
| Signers | Admin (`input.datum.admin_pkh`); plus new admin if rotating |
| Inputs | The current config UTxO |
| Outputs | 1× new config UTxO at the same address with updated datum, preserving the config NFT |
| Mints | None |
| Reference inputs | None |
| Validators | Config validator's `spend` handler |

### 5.3 Create a listing (open)

| Item | Detail |
|---|---|
| Signers | Lister |
| Inputs | Funding UTxO(s) holding the NFT |
| Outputs | 1× listing UTxO at the spend-script address, holding `min_ADA + 1 NFT`, with inline `ListingDatum { lister_pkh, update_ref: None }` |
| Mints | None |
| Reference inputs | None required by chain. FE may include the config UTxO as a ref input for atomicity / discoverability. |
| Validators | None (plain pay-to-script) |

Multiple listings in one tx → one output per NFT.

**Important caveat:** because creation is plain pay-to-script with no validator run, **the spend-script address is permissionless and may contain malformed UTxOs** (wrong datum shape, multiple non-ADA assets, no NFT, NFT under a different policy, etc.). Such UTxOs cannot satisfy the swap invariants and are effectively un-swappable, but they exist on-chain. Off-chain discovery is responsible for filtering them out — see §10.2.

### 5.4 Swap

| Item | Detail |
|---|---|
| Signers | Swapper |
| Inputs | 1× listing UTxO (consumed); the input UA holding NB; any other swapper-funding UTxOs |
| Reference inputs | The config UTxO (CIP-31 ref input). May be among other ref inputs from composability. |
| Outputs | (a) NA → swapper's wallet; (b) new listing UTxO at the spend-script address holding `NB + (input.value.lovelace + lister_fee)` with datum `{ lister_pkh: input.lister_pkh, update_ref: Some(compute_output_tag(self.outRef)) }`; (c) `protocol_fee` lovelace → `treasury_addr` with inline datum = `compute_output_tag(self.outRef)` |
| Mints | None |
| Validators | Spend validator's `Swap` redeemer |

UA and the listing input may be the same UTxO only if the swapper had previously listed NB themselves and is doing `Cancel + Swap` in one tx — in that case UA is a script input being consumed via the listing validator's `Cancel` path.

### 5.5 Cancel

| Item | Detail |
|---|---|
| Signers | Lister (`input.datum.lister_pkh`) |
| Inputs | 1+ listing UTxOs at the spend-script address belonging to the lister |
| Outputs | NFT(s) + accrued ADA → lister's wallet |
| Mints | None |
| Reference inputs | None required |
| Validators | Spend validator's `Cancel` redeemer (per listing input) |

Cancel is unaffected by `update_ref`. The validator only checks `lister_pkh` signature.

**Lister fee management:** there is no separate "claim accrued fees" or "refresh listing" path. To extract accrued ADA, the lister cancels (recovering the current NFT + all accrued ADA) and creates a fresh listing (§5.3). For UX this should be presented as a single "claim" operation in the FE that bundles cancel-then-relist into one logical action (two transactions, or one if the lister wallet is also building both txs in sequence).

---

## 6. Validator invariants

### 6.1 Config validator — mint handler

See §3.1. Invariants M1-M4.

### 6.2 Config validator — spend handler

See §3.1. Invariants C1-C6.

### 6.3 Spend validator — `Swap`

For input `self` at outRef `self.outRef` with datum `input_datum`:

| # | Invariant |
|---|---|
| S1 | **At least one** ref input has a value containing an asset under policy_id == `config_nft_policy` (the script's compile-time parameter). Linear search via `list.find`. Call its asset name `collection_policy_id` (= 28 bytes by §3.1 M3) and its datum `cfg`. |
| — | *(No self-swap check. A self-swap costs the swapper `protocol_fee + lister_fee` for nothing — accepted.)* |
| S2 | `input.value` contains exactly one non-ADA asset, equal to `(collection_policy_id, na_asset_name)` quantity 1. |
| S3 | Let `ua = tx.inputs[redeemer.nb_input_index]`. `ua.value` contains `(collection_policy_id, nb_asset_name)` quantity 1. *(Pins UA — the input that physically holds NB — for the bucket-seed computation.)* |
| S4 | Let `out_listing = tx.outputs[redeemer.listing_output_index]`. `out_listing.address == self.address`. |
| S5 | `out_listing.datum.lister_pkh == input_datum.lister_pkh`. |
| S6 | `out_listing.datum.update_ref == Some(compute_output_tag(self.outRef))`. *(Double-satisfaction defense for Case 2 — listing recreation.)* |
| S7 | `out_listing.value` contains exactly one non-ADA asset, equal to `(collection_policy_id, nb_asset_name)` quantity 1. |
| S8 | `out_listing.value.lovelace >= input.value.lovelace + cfg.lister_fee`. |
| S9 | Let `out_treasury = tx.outputs[redeemer.treasury_output_index]`. `out_treasury.address == cfg.treasury_addr`. |
| S10 | `out_treasury.datum == InlineDatum(compute_output_tag(self.outRef))`. *(Double-satisfaction defense for Case 1 — fee payment.)* |
| S11 | `out_treasury.value.lovelace >= cfg.protocol_fee`. |
| S12 | Bucket equation: `from_bytearray_big_endian(blake2b_256(collection_policy_id ‖ na_asset_name)) % cfg.m == from_bytearray_big_endian(blake2b_256(collection_policy_id ‖ nb_asset_name ‖ cbor.serialise(ua.outRef))) % cfg.m`. |

The validator does **not** constrain the count, value, address, or datum of *other* outputs at `self.address`. Junk outputs at the listing address can exist (and may be created by malicious swappers piggybacking onto a swap tx), but the chain only guarantees correctness of the designated `out_listing`. This is a deliberate trade-off: enforcing "no extra outputs at self.address" would make multi-swap atomic txs impossible. Off-chain discovery handles junk filtering — see §10.2.

### 6.4 Spend validator — `Cancel`

| # | Invariant |
|---|---|
| K1 | `tx.extra_signatories` contains `input_datum.lister_pkh`. |

The validator does not constrain output count, value distribution, or address — the lister is trusted to construct a sensible tx since they're the only beneficiary.

---

## 7. Randomness model

### 7.1 Mechanism

Each NFT in a well-formed listing UTxO has a deterministic bucket:

```
bucket_self = from_bytearray_big_endian(blake2b_256(collection_policy ‖ asset_name)) % M
```

On swap, the validator computes the target bucket the swapper is hitting:

```
seed_bytes    = collection_policy ‖ nb_asset_name ‖ cbor.serialise(ua.outRef)
hash_bytes    = blake2b_256(seed_bytes)        // 32 bytes
hash_int      = from_bytearray_big_endian(hash_bytes)
bucket_target = hash_int % M
```

`from_bytearray_big_endian` (in `aiken/primitive/int`) treats the input bytes as an unsigned big-endian integer. The resulting `Int` is then reducible modulo `M`. `cbor.serialise` (in `aiken/cbor`) gives the canonical byte form of `ua.outRef`.

The validator requires `bucket_self == bucket_target`. When multiple well-formed listing UTxOs share the target bucket, the dApp UI picks one — on-chain doesn't care which.

### 7.2 Seed inputs and grinding analysis

The seed has two swapper-controllable axes:

1. **`nb_asset_name`** — bounded by NFTs of this collection the swapper owns.
2. **`ua.outRef`** — bounded by the *physical UTxO* in which NB currently resides. Manufacturing a different `ua.outRef` requires a real on-chain transaction: spending the current NB-holding UTxO to produce a new one. Cost ~0.17 ADA per attempt.

Total grinding surface ≈ (#NFTs of the collection the grinder holds) × (#NB-relocations the grinder is willing to pay for). Bounded but not eliminated. Each grinding step has a real, non-amortized on-chain cost.

This design intentionally avoids using `tx.inputs[0].outRef` (the lex-first input of the entire tx) as the entropy source. That earlier choice would give the grinder a *free* axis: vary which funding UTxOs the tx includes, change which one sorts first, no cost. Anchoring to UA (the input that physically holds NB) forces every grinding attempt through a real wallet operation.

Edge case: if the swapper had previously listed NB themselves and is doing `Cancel + Swap` in one tx, UA is a script input being consumed via the listing validator's `Cancel` path. This is normal — UA is "the input that contains NB" regardless of whether it comes from a wallet or another script.

### 7.3 Why this is acceptable

By the protocol's premise the collections are dead — no individual NFT is materially more valuable than any other. The economic incentive to grind toward a specific target is small. This trade-off is explicit and protocol-defining; it is **not** suitable for a marketplace handling valuable assets.

### 7.4 Bucket coverage math

With N items distributed across M buckets (balls-in-bins), the expected non-empty-bucket fraction is exactly `1 − (1 − 1/M)^N`, well-approximated for large N by `1 − e^(−N/M)`. The expected number of items per *non-empty* bucket is approximately `N/M / (1 − e^(−N/M))`:

| M | Coverage `1 − e^(−N/M)` | Avg per non-empty bucket |
|---|---|---|
| N/2 | ~86% | ~2.31 |
| **N/3** | **~95%** | **~3.16** |
| N/5 | ~99.3% | ~5.03 |

Recommended default: **`M ≈ N/3`** where N is the count of *well-formed* listings (see §10.2 — malformed UTxOs at the listing address must be excluded from N). Admin sets `M` per-collection in the config datum and tunes via spend (§5.2) if pool size drifts significantly.

### 7.5 Dynamic rebalancing

As listings are swapped, the NFT inside each listing UTxO changes, so its bucket changes. Bucket distribution naturally rebalances as activity proceeds — no admin tuning required as long as the *total* well-formed listing count remains roughly stable.

---

## 8. Threat model

### 8.1 Defended

| Attack | Defense |
|---|---|
| **Lister-pkh rewrite + cancel theft.** Swapper writes their own pkh into the new listing datum, then cancels to take accrued ADA. | Invariant S5 — `out_listing.lister_pkh == input.lister_pkh`. |
| **Cross-collection deposit.** Swapper deposits an unrelated NFT to corrupt a listing. | Invariants S2, S3, S7 — NA, the input UA holding NB, and the output's NB must all be under the `collection_policy_id` derived from the config NFT's asset name. |
| **NB-input substitution.** Swapper claims `nb_input_index` points at an unrelated input. | Invariant S3 — that input's value must contain `(collection_policy_id, nb_asset_name) × 1`. Lying causes failure. |
| **Wrong-config substitution.** Swapper provides a malicious zero-fee config UTxO as ref input. | Invariant S1 — ref input must contain an asset under `config_nft_policy` (the *parameterized* policy), which is fixed at script-compile time. The validator address itself is `Address(ScriptCredential(config_nft_policy))`, so the only place a config-policy-id-tagged asset can live with a `ConfigDatum` is the legitimate config UTxO. |
| **Double-mint of config NFT.** | One-shot mint M1, M2: `seed_utxo` consumed, exactly +1 minted. The seed UTxO is gone after first mint, so no second mint is possible. |
| **Asset-name spoofing on config mint.** Deployer mints a config with an asset name that isn't 28 bytes. | M3 — the mint handler enforces `length(asset_name) == 28`. The bytes themselves are not validatable on-chain; off-chain curation (§10.3) verifies semantic correspondence to a real collection. |
| **Double-satisfaction Case 1 (treasury).** One protocol-fee output satisfies multiple swap inputs. | Invariant S10 — treasury output's inline datum must equal `compute_output_tag(self.outRef)`. Each swap input demands a uniquely-tagged treasury output. |
| **Double-satisfaction Case 2 (listing recreation).** One new listing output satisfies multiple consumed listing inputs. | Invariant S6 — `out_listing.update_ref == Some(compute_output_tag(self.outRef))`. Each swap input demands a uniquely-bound listing output. |
| **Hostile admin replacement.** Old admin tries to install a malicious successor unilaterally. | Invariant C6 — admin rotation requires both old and new admin signatures. |
| **Lister-fee shrinkage by hostile admin.** Admin lowers `lister_fee` to drain incentive. | Invariant C5 — `lister_fee >= MIN_LISTER_FEE` (compile-time floor of 1 ADA). Admin can never go below this. |
| **Bucket-mod-by-zero.** Admin sets `M = 0`. | Invariant C3 — `m >= 1` enforced on every config update. |
| **Free seed grinding via input-set choice.** Earlier seed used `tx.inputs[0].outRef`, lettings swappers vary funding UTxOs at no cost. | UA-based seed in S12: the entropy is anchored to the input physically holding NB; varying it requires a real wallet operation (~0.17 ADA per attempt). |

### 8.2 Accepted (with rationale)

| Risk | Why accepted |
|---|---|
| **Self-swap.** Swapper deposits the same asset name they "took" (`na == nb`). | They pay `protocol_fee + lister_fee` for nothing in return. Accepted as a free donation; not worth a validator check. |
| **Bounded swapper grinding on seed.** | Dead-collection premise: no NFT is materially more valuable than others. Cost barrier (~0.17 ADA per attempt to relocate NB) limits surface; full mitigation would require commit-reveal (UX cost) or oracle (trust cost). |
| **Junk outputs at listing address.** Anyone can pay-to-script with malformed UTxOs; swap txs may also piggyback junk outputs at `self.address`. | The validator only certifies the designated successor in a swap. Malformed UTxOs are un-swappable (they fail S2-S7). Off-chain filtering (§10.2) hides them from the FE; the indexer excludes them from the count of N used to size M. |
| **CIP-27/68 reserved-label injection.** A swapper deposits a CIP-68 reference token (label `100`) or CIP-27 royalty token (label `500`) as `NB`. | Only hurts the resulting lister (who pulls a useless asset on cancel). Not exploitable against other users. Filtering today doesn't future-proof against new label standards; revisit if a future label lands. |
| **Permissionless config minting.** Anyone can deploy a competing config for a collection. | Curation is an off-chain problem (FE shows only the curated set). Admin-keyed minting would centralize the protocol unnecessarily. |
| **Asset name semantics not on-chain-verifiable.** Mint handler enforces 28-byte length; nothing more. A deployer could mint a config with arbitrary 28 bytes. | Off-chain curation verifies the asset name corresponds to a real, populated NFT collection (§10.3). |
| **`treasury_addr` script-credential footgun.** Admin sets a script that doesn't accept the tagged-output shape; fees become stranded. | Off-chain hygiene only (§3.1 note). On-chain, the admin chose it. |
| **No on-chain dead-collection check.** A "live" collection could be marketed as dead. | Off-chain curation; users see only the curated list. |
| **No CIP-27 royalty payments on swap.** | Collections are dead; royalty receivers are commonly defunct entities. Honoring royalties would imply trust in the original creator's address. |
| **No "claim accrued fees without cancel" path.** | Cancel-and-relist is the intended flow. FE bundles the two as one user-facing action. Adding a separate `Refresh` redeemer adds validator surface for no security gain. |

### 8.3 Out-of-scope

- Mempool / front-running. The protocol is fundamentally a "first to land" race for any specific listing UTxO; this is inherent to eUTxO and not protocol-specific.
- Wallet compromise. If the swapper's keys leak, all bets are off — same as any Cardano protocol.
- Off-chain metadata spoofing. The BE caches metadata from CIP-25/68 sources; if those sources are corrupted, displayed names/images may be wrong. On-chain transfer is unaffected.

---

## 9. Economic parameters

| Parameter | Floor / type | Notes |
|---|---|---|
| `protocol_fee` | `≥ 0` lovelace | Admin can set 0 to skim no fee. |
| `lister_fee` | `≥ MIN_LISTER_FEE` (= 1 ADA, hardcoded) | Compile-time guarantee for listers. Admin can raise; never lower below 1 ADA. |
| `M` | `≥ 1` integer | Admin sets at deploy and tunes via update. Recommended: `M ≈ well_formed_listings / 3`. |
| Listing min-UTxO | ~1.5-1.7 ADA | Determined by Cardano protocol params; lister supplies on initial creation. |
| Treasury-output min-UTxO | ~0.95 ADA (with 32-byte inline datum) | Comfortably under `protocol_fee = 1 ADA` typical. If admin sets `protocol_fee = 0`, the treasury output still needs min-ADA — this means a 0-protocol-fee config still requires the swap tx to attach min-ADA to the tagged treasury output. (No protocol issue; just a UX detail.) |

These are **per-collection defaults**, not protocol-wide. Different collections can have different fee tiers — popular dead collections may warrant higher fees, the truly worthless lower ones.

---

## 10. Off-chain expectations

### 10.1 Frontend (Next.js + Evolution SDK)

- **Wallet integration:** CIP-30 via Eternl, Vespr, Lace. Mobile-first.
- **Browse-first:** users can view listings without connecting a wallet.
- **Curated list:** the FE only surfaces collection markets whose `config_nft_policy` is in the curated list (fetched from BE).
- **Tx building:** the FE constructs all transactions client-side using Evolution SDK. The BE is queried only for indexed state (listings, prices, metadata) and the curated list.
- **Suspense reveal:** swap animations begin on tx submission (deterministic outcome already known) rather than confirmation. ~99.9% of submitted txs land; the rare failure case freezes the animation with an error.
- **Lister "claim accrued fees" UX:** presented as a single button that triggers cancel-then-relist. Users see one logical operation.
- **Metaphor:** users throw NFTs into a mud pit; another rises out. See `project_brand.md` and `project_frontend.md` in memory.

### 10.2 Backend (Java 21 + Spring Boot + Yaci Store + Postgres)

- **Indexer:** track all UTxOs at curated spend-script addresses + their config UTxOs + relevant mint events. Custom Yaci Store processors filter for the parameterized policies.
- **Strict listing-shape filter (load-bearing):** the spend-script address is permissionless. The indexer treats a UTxO as a *valid listing* only if **all** of:
  - Inline datum decodes as a `ListingDatum`.
  - Value contains exactly one non-ADA asset.
  - That asset's policy id equals the corresponding config's `collection_policy_id` (= the config NFT's asset name).
  - That asset has quantity 1.
  - No other non-ADA assets present.
  - Lovelace ≥ Cardano min-UTxO for the output shape.

  Anything failing this filter is a junk UTxO: ignored by the FE, not counted in N when sizing M, and not surfaced as a swap target. Junk cannot be grouped into the bucket distribution because it cannot satisfy the swap invariants — its presence on-chain is harmless to swappers but visually noisy if exposed.
- **Metadata cache:** resolve and cache CIP-25 (label-less, on-chain JSON in tx metadata) and CIP-68 (label-prefixed reference tokens) metadata for every NFT touching the system. Multi-tier thumbnails (64 / 256 / 1024 px).
- **Stats:** swap volume per collection, listing age, accrued ADA per listing.
- **Curation registry:** authoritative list of `(slug, config_nft_policy, theme)` consumed by the FE. The collection_policy_id is derived from the config NFT's asset name; need not be stored separately.
- **Datum/redeemer model generation:** use the Cardano Client Lib (CCL) **blueprint** module with annotation processors to generate Java model classes from Aiken's compiled `plutus.json` blueprint output. Avoids hand-maintained Java mirrors of `ConfigDatum`, `ListingDatum`, and `ListingRedeemer`. Build via Gradle (not Maven).

### 10.3 Curation lifecycle

A new dead collection joins by:
1. Someone (typically the protocol operator) deploys a config UTxO via the one-shot mint path (§5.1).
2. The operator verifies that the config NFT's asset name corresponds to a real on-chain collection with active or historical NFT activity. The 28-byte length check on-chain is necessary but not sufficient — this off-chain semantic check is what stops malicious garbage from being surfaced.
3. The operator adds the new `(slug, config_nft_policy, theme)` to the BE curation list and redeploys.
4. The FE picks up the new collection on its next API fetch.

No "retire" path exists on-chain. To stop surfacing a collection, simply remove it from the BE curation list. The on-chain config and any outstanding listings remain spendable in perpetuity (cancel by lister always works).

---

## 11. Versioning and migration

The protocol is **deliberately non-upgradeable in place** — both validators are parameterized (config validator on `seed_utxo`, spend validator on `config_nft_policy`), so any change to either yields a new compiled hash and breaks the binding. Migrations work by:

1. Operator deploys a new config under a new `seed_utxo` (hence new `config_nft_policy`) with updated parameters and/or upgraded contracts (§5.1).
2. Operator updates the BE curation list to point at the new `config_nft_policy` and the corresponding new spend-script address.
3. Listers cancel their old listings (always allowed) and relist under the new config.

The old config UTxO and its listings remain on-chain and remain spendable forever — they just stop appearing in the FE.

### 11.1 Triggers that warrant migration

- A new label standard (post-CIP-68) that listers want filtered out of their listings.
- A bug or vulnerability discovered post-deployment.
- A change in protocol-level constants (e.g., `MIN_LISTER_FEE`) that is hardcoded.
- A change in fee structure that the admin can't make via spend-update (e.g., adding a third fee recipient).

---

## 12. Test strategy

### 12.1 Unit tests (Aiken)

- **Config validator — mint handler:** positive (correct seed consumed, +1 minted, asset name == 28 bytes, well-typed datum); negative (no seed, double-mint attempt, wrong asset name length, datum violates floors).
- **Config validator — spend handler:** positive (admin signs, NFT preserved, datum within floors); negative (missing admin sig, NFT missing on output, M = 0, lister_fee below floor, rotation without new admin sig).
- **Spend validator — Swap:** every invariant S1-S12 with at least one positive and one negative test. Especially:
  - Double-satisfaction multi-swap atomic txs (must fail).
  - Wrong `nb_input_index` (UA index pointing at an input that doesn't contain NB).
  - Junk outputs at `self.address` co-existing with a valid swap (must succeed; junk is ignored).
- **Spend validator — Cancel:** with/without lister sig.
- **Bucket math:** golden tests pinning specific `(collection_policy, asset_name, ua.outRef)` → bucket values across a few `M` values.

### 12.2 Integration tests (Yaci DevKit)

End-to-end transaction flows on a local devnet:
- Deploy → list → swap → swap → cancel.
- Multi-swap atomic txs (deliberately attempt double-satisfaction; must fail).
- Admin update (no rotation, with rotation).
- Lister claim-via-cancel-and-relist.
- Junk-UTxO injection at the listing address (verify indexer filters them out).

### 12.3 Property-based tests

- Bucket equation symmetry: for any fixed `(policy, m, ua.outRef)`, the function from asset_name to bucket is well-defined and stable.
- For the swap path, the on-chain validator's bucket equality is true if and only if the off-chain computation says so. (Catches type/encoding mismatches between validator and off-chain.)

### 12.4 Adversarial review

- Codex pass on this specification before any contract code is written. **Done for v0.2 → v0.3 (2026-05-10).** Optional second pass on v0.3.
- Manual security review of the compiled validators before mainnet deployment.

### 12.5 Dependency posture

- **Aiken stdlib:** `3.1.0` minimum, follow upstream as it advances.
- **Yaci Store / Yaci DevKit:** latest pre-release at scaffold time (we are happy testing pre-releases ahead of an imminent stable cut).
- **Cardano Client Lib (CCL):** latest pre-release at scaffold time. Used for blueprint-driven model generation in the BE.
- **Evolution SDK:** latest stable at scaffold time.
- **Build tooling:** Gradle (not Maven) for the BE.

Concrete version numbers will be pinned in `contracts/aiken.toml`, `api/build.gradle.kts`, and `web/package.json` during the scaffold step.

---

## 13. Open items

None at the time of this draft. All items in `project_open_questions.md` are resolved. The remaining input is an optional second Codex adversarial review pass — this draft is its target.

---

## Appendix A — Glossary of memory references

| Memory document | Authority on |
|---|---|
| `project_overview.md` | High-level project framing |
| `project_architecture.md` | UTxO topology, datum/redeemer shapes, validator invariants |
| `project_randomness.md` | Bucket math, seed derivation, grinding analysis |
| `project_brand.md` | Tone, name origin, visual metaphor |
| `project_frontend.md` | FE design, routes, wallet support, suspense flow |
| `project_backend.md` | BE stack, indexer scope, curation registry, CCL blueprint usage |
| `project_repo_layout.md` | Polyglot monorepo structure |
| `project_open_questions.md` | Decision tracker |
| `feedback_cardano_docs.md` | Use local cardano-dev-skills docs over MCP |
