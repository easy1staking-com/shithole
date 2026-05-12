# Shithole

A Cardano dApp giving dead / rugpulled NFT collections a second life via random in-collection swaps. Sarcastic counterpart to Wormhole — wormholes carry value across chains, shithole carries worthlessness in circles within one collection.

## Status

**SPEC.md v0.5** (2026-05-12). Build plan at `/Users/giovanni/.claude/plans/snug-herding-penguin.md`.

- **Phase 2 (Aiken contracts) LOCKED** at 60c1688 (2026-05-11) — 53 tests green.
- **Phase 3 (BE + FE bootstrap) in flight**:
  - `671776b` web: FE plumbing (types, MSW, React Query, two pages).
  - `6fd425a` api: BE plumbing (entities, repos, DTOs, fixture-serving controllers).
  - `7697ece` api: Yaci Store 2.1.0-pre3, CCL 0.8.0-pre4, swap-history lineage table (V1_0_1).
  - `09395b6` api: trustless `POST /api/configs` with CIP-8 admin signature (V1_0_2 drops the candidate_configs FK).
  - `403d782` docs: SPEC §10.2/§10.3 + docs/BACKEND.md realigned for the FE-driven curation pivot.
- **Pivot**: CIP-171 auto-discovery deferred for v1. Curation goes through `POST /api/configs` with a CIP-8 admin signature from the on-chain `admin_pkh`.
- **`9b84ef5` api: listing_script_address derivation via aiken-java-binding (JNI UPLC apply-params).**
- **`e3f3ec5` api: Yaci Store indexer wiring — WatchAddressRegistry + ListingEventsIndexer (genesis/swap/cancel-or-recover) + UtxoRollbackEvent handler. 47 tests green.**
- **`759f2c9` web: admin register-config flow end-to-end — CIP-30 wallet, Evolution SDK config-deploy, byte-identical CIP-8 canonical payload, POST /api/configs.**
- **Next**: Codex pass on `e3f3ec5` + `759f2c9` (both unreviewed). Then end-to-end smoke against a Yaci DevKit / preprod node (the FE tx byte representation hasn't been exercised against a real chain yet). Cancel-vs-recover classification by redeemer (currently both → `spent_unknown`).

## Concept

- A **lister** locks NFTs from a collection at a parameterized spend-script address. Each NFT lives in its own UTxO ("listing UTxO") with a `lister_pkh` datum field that persists for the life of the UTxO.
- A **swapper** sends 1 NFT of the same policy id plus 2 fixed ADA fees (`protocol_fee`, `lister_fee`); the contract returns a deterministically-bucketed NFT from the listing pool.
  - `protocol_fee` → treasury wallet (per-collection config, ≥ 0).
  - `lister_fee` → accrues *on the listing UTxO itself*, claimable by the original lister via cancel-and-relist (per-collection config, ≥ `MIN_LISTER_FEE` = 1 ADA hardcoded floor).
- Listers claim accrued ADA via cancel + relist (no separate refresh path).
- Protocol parameters (M, fees, treasury, admin) live in a per-collection config UTxO guarded by a one-shot state NFT, mutated only by the admin via the same multi-handler validator that mints the NFT.

See `SPEC.md` for the full protocol; memory under `~/.claude/projects/-Users-giovanni-Development-workspace-shithole/memory/` for design rationale (39 logged decisions).

## Tech stack

- **Smart contracts:** Aiken (stdlib 3.1.0+, plutus v3, compiler v1.1.21)
- **Frontend:** Next.js + Evolution SDK (mobile-first; Eternl → Vespr → Lace wallet priority)
- **Backend:** Java 21 + Spring Boot 3.3.x + Yaci Store + Postgres + Flyway. CCL annotation processor generates Java types from `contracts/plutus.json`. **Gradle (not Maven).**
- **Repo:** polyglot monorepo — `contracts/` (Aiken), `web/` (Next.js), `api/` (Spring Boot). `Makefile` + `compose.yaml` glue. No Turborepo/Nx.

## Code review process

**After writing each significant code chunk — a validator, a service class, a non-trivial UI component — run it through Codex via the `codex:rescue` skill before committing.** The review brief should:

- List the relevant files (the chunk + any context files).
- Ask for: bugs, performance issues, idiom violations, missing tests, security concerns.
- Be specific and adversarial — e.g., "find any way to bypass this validator's invariants."

After the review, action the findings (or explicitly reject with rationale), then commit. Codex output goes through Claude for triage; do not action findings blindly.

For Aiken contracts specifically, **also reference the performance tips in `cardano-dev-skills` (skills `optimize-validator`, `write-validator`) before writing**. Validators must be CPU- and memory-efficient — Plutus budgets are tight. Use the local docs at `/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/aiken/` and `aiken-stdlib/` and `aiken-design-patterns/`.

## Cardano-specific constraints (recap from SPEC)

- **No native randomness on Cardano.** Bucket selection is a deterministic hash of `(collection_policy ‖ nb_asset_name ‖ cbor.serialise(UA.outRef))` mod M, where UA is the input that physically holds NB. Bounded grinding accepted (~0.17 ADA per attempt).
- **Same-policy-id enforcement is on-chain;** "dead collection" curation is off-chain (FE/BE).
- **UTxO contention drives parallelism**: one NFT per listing UTxO, config read as CIP-31 reference input (never spent on swap path).
- **Double-satisfaction defenses** via shared `compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))` (matches `jpgstore-sniper`). Applied to treasury inline datum AND listing `update_ref` field.

## Working with this repo

- **Local cardano-dev-skills docs are the primary Cardano reference**, not the Cardano MCP. Path: `/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/`. 42 sources, updated daily. MCP has round-robin loops and truncation issues — fallback only.
- The relevant Cardano dev skills (`cardano-dev-skills:*`) are loaded — `write-validator`, `optimize-validator`, `build-transaction`, `review-contract`, `query-chain`, `design-token` are the most relevant here.
- The `easy1staking-dev-skills:*` plugin is also loaded — `design-process` (this project's workflow) and `cardano-design-patterns` (the architectural patterns we mirror, including jpgstore-sniper's `compute_output_tag` recipe).
- Run formal Codex code review (see "Code review process" above) on every non-trivial code chunk before committing.

## Reference projects (mirror these patterns)

- **Aiken**: `/Users/giovanni/Development/workspace/jpgstore-sniper/src/jpgstore-sniper-onchain/` — `validators/settings.ak` is the multi-handler template for our `config.ak`; `validators/snipe.ak` for our `listing.ak`; `lib/utils.ak` exports `compute_output_tag` and `signed_by` (copy verbatim).
- **BE**: `/Users/giovanni/Development/workspace/ada-watch/` — Spring Boot 3.3.4 + Java 21 + Yaci Store + Postgres + Flyway. Strip telegram/discord/scalus/notification deps for our use; keep Lombok, CCL, CCL annotation processor, Spring Boot starters.
