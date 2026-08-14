# Shithole

A Cardano dApp giving dead / rugpulled NFT collections a second life via random in-collection swaps. Sarcastic counterpart to Wormhole — wormholes carry value across chains, shithole carries worthlessness in circles within one collection.

## Status

**SPEC.md v0.5** (2026-05-12). Live epic-level view: **`PLAN.md`** (repo root,
untracked — public repo). Refreshed 2026-08-13.

- **LIVE ON MAINNET.** The full lister → swap → cancel path plus the singleton
  marketplace are deployed and working on mainnet. Any `.ak` edit changes the
  deployed script hashes → see the **Contract change checklist** below; treat
  the mainnet hashes as sacred (this is why the aiken pin stays v1.1.22).
- **Phase 2 (Aiken contracts) LOCKED** — the compiled `plutus.json` is the
  mainnet provenance; 174 aiken scenarios green on the pinned v1.1.22.
- **Phase 3 (BE + FE) shipped.** FE plumbing, Yaci Store indexer
  (WatchAddressRegistry + ListingEventsIndexer), trustless CIP-8 admin
  `POST /api/configs`, listing-address derivation via aiken-java-binding, and
  the admin register-config end-to-end flow are all in. Two commits shipped
  **unreviewed** — `e3f3ec5` (indexer wiring) + `759f2c9` (register-config);
  the Codex pass on both is parked under PLAN **E1**, to run when E1 activates.
- **"The dump" 3D gallery — SHIPPED to `main` and iterating.** Walkable
  marketplace with arcade cabinets (BREAKOUT, FLAPPY HOSKY live) and a Stage-0
  rat kill-counter. Polish threads are demand-gated (PLAN **E3**, currently
  cold — no rat kills reported yet).
- **Pivot (historical):** CIP-171 auto-discovery deferred for v1; curation goes
  through `POST /api/configs` with a CIP-8 admin signature from the on-chain
  `admin_pkh`.
- **Open epics live in `PLAN.md`** — E1 (integration/smoke harness, deferred to
  next big thing), E2 (marketplace hardening backlog, triaged 2026-08-13),
  E4 (IPFS resilience), E5 (mainnet 3-collection cutover, held), E6 (toolchain
  baseline), E7 (bounty terminology scrub).

## Concept

- A **lister** locks NFTs from a collection at a parameterized spend-script address. Each NFT lives in its own UTxO ("listing UTxO") with a `lister_pkh` datum field that persists for the life of the UTxO.
- A **swapper** sends 1 NFT of the same policy id plus 2 fixed ADA fees (`protocol_fee`, `lister_fee`); the contract returns a deterministically-bucketed NFT from the listing pool.
  - `protocol_fee` → treasury wallet (per-collection config, ≥ 0).
  - `lister_fee` → accrues *on the listing UTxO itself*, claimable by the original lister via cancel-and-relist (per-collection config, ≥ `MIN_LISTER_FEE` = 1 ADA hardcoded floor).
- Listers claim accrued ADA via cancel + relist (no separate refresh path).
- Protocol parameters (M, fees, treasury, admin) live in a per-collection config UTxO guarded by a one-shot state NFT, mutated only by the admin via the same multi-handler validator that mints the NFT.

See `SPEC.md` for the full protocol; memory under `~/.claude/projects/-Users-giovanni-Development-workspace-shithole/memory/` for design rationale (39 logged decisions).

## Tech stack

- **Smart contracts:** Aiken (stdlib 3.1.0+, plutus v3, compiler v1.1.22 — pinned; this is the mainnet-deployed compiler, DO NOT bump)
- **Frontend:** Next.js + Evolution SDK (mobile-first; Eternl → Vespr → Lace wallet priority)
- **Backend:** Java 21 + Spring Boot 3.3.x + Yaci Store + Postgres + Flyway. CCL annotation processor generates Java types from `contracts/plutus.json`. **Gradle (not Maven).**
- **Repo:** polyglot monorepo — `contracts/` (Aiken), `web/` (Next.js), `api/` (Spring Boot). `Makefile` + `compose.yaml` glue. No Turborepo/Nx.

## Commands

Proven on this box (Linux; init 2026-08-12, greened 2026-08-13). Run from
repo root unless noted. Slice-contract Verification sections cite these.
`make build` and `make test` both pass end-to-end once the two setup steps
below are done.

| Command | What | Status |
|---|---|---|
| `make web-test` — `cd web && vitest run` | FE unit tests | ✅ 80 pass |
| `cd web && npm run lint` | FE eslint | ✅ 0 errors (5 harmless `exhaustive-deps` warnings) |
| `make web-build` — `next build` | FE build | ✅ pass |
| `make api-test` / `api-build` — `./gradlew` | BE | ✅ pass — **needs `JAVA_HOME`** (below) |
| `make contracts-build` — `aiken build` | blueprint + FE copy | ✅ pass on the pinned **v1.1.22** |
| `make contracts-test` — `aiken check` | Aiken tests | ✅ 174 scenarios pass on the pinned **v1.1.22** |

### Setup a fresh box needs BEFORE the build runs cold

1. **Java on `PATH`.** jenv is installed but selects no global version, so a
   bare `./gradlew` dies with `jenv: java: command not found`. Java 21
   (matching `api/.java-version`) lives at `~/.jenv/versions/21.0.11`.
   Export it: `export JAVA_HOME=~/.jenv/versions/21.0.11`.
2. **Install the pinned Aiken: `aikup install v1.1.22`.** This box shipped
   with an ancient `aiken v1.0.26-alpha` that can't parse the repo's
   validator syntax — that's the only reason contracts commands failed at
   init. With the pinned v1.1.22, both `aiken build` AND `aiken check` are
   green against the committed deps (`stdlib v3.1.0`, `fuzz v2.1.1`).
   **Do NOT bump the `aiken.toml` compiler pin** — v1.1.22 is the
   mainnet-deployed compiler (provenance); `aiken build` reproduces
   `plutus.json` byte-identical to the committed one.
   - Gotcha learned the hard way: don't `rm -rf build` to "diagnose" — a
     clean re-resolve can transiently pull a mismatched transitive dep
     (seen once: `fuzz v2.2.0` despite the `v2.1.1` pin) and break
     `aiken check`. If that happens, just re-run `aikup install v1.1.22`
     and rebuild; the pinned versions are fine.

If `make contracts-build` ever rewrites more than `plutus.json`'s preamble
`compiler` string, STOP — bytecode drifted and the full **Contract change
checklist** (below) applies.

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

## Contract change checklist (READ BEFORE TOUCHING `contracts/`)

ANY edit to a `.ak` validator changes its compiled bytecode and therefore
its script hash. Every layer that derives an address, script hash, or
parameterized hash from that bytecode is now stale. Walk through this
list whenever you change a validator:

1. **Recompile**: `make contracts-build` — regenerates `contracts/plutus.json`
   and copies it to `web/public/contracts/plutus.json` (FE reads this at
   runtime via `loadBlueprint()`).
2. **Rebuild AND restart BE**: `cd api && ./gradlew build` regenerates
   `JarSpendValidator.COMPILED_CODE` / `MarketplaceSpendValidator.COMPILED_CODE`
   / etc. via the CCL annotation processor from `plutus.json`. Required
   on **ANY** bytecode change, not just datum/redeemer shape changes —
   `MarketplaceScriptAddressDeriver` UPLC-applies those constants at
   startup, so a stale `COMPILED_CODE` produces a stale derived
   address and the indexer watches a phantom. Then **kill and relaunch**
   any running `./gradlew bootRun` — gradle compilation alone doesn't
   help if the JVM is holding the old class files in memory (this bit
   us on 2026-05-29). On boot, watch for the `ChainAddressManifest`
   banner — it prints every unparameterized hash next to its applied
   address, making drift instantly visible. If the boot banner's
   `jar.spend` / `marketplace.spend` hashes don't match
   `jq '.validators[].hash' contracts/plutus.json`, the BE is stale.
3. **Recompute parameterized hashes**: parameterized scripts
   (marketplace ← jar_script_hash, listing ← config_nft_policy, etc.)
   have new applied hashes even when the parameter is unchanged. Anywhere
   the OLD hash was persisted is now wrong:
   - **`web/src/lib/market/manifest.json`** (jar + marketplace addresses)
     — the dev-tools page persists a fresh manifest in localStorage; the
     committed JSON has to be re-exported after a redeploy.
   - **`api/src/main/resources/p2p/pools.json.gz`** — built by
     `p2pBuildPoolMerkle`; doesn't depend on contract bytes, safe.
   - **Per-collection `configs.config_nft_policy`** in the BE DB — the
     config NFT policy id == config validator's script hash. Old rows
     point at the previous hash and won't match new on-chain configs.
4. **Existing on-chain UTxOs become orphans**: anything locked at the
   OLD script address (listings, jars, configs) can ONLY be spent by the
   OLD compiled validator. The FE now compiles to the NEW hash, so it
   builds txs that attach the NEW script — Blockfrost script eval fails
   with "script hash mismatch / evaluation failed". On preprod just
   redeploy fresh + abandon the orphans. On mainnet this is a migration.
5. **Re-register, re-deploy**:
   - Configs: re-run `/admin/register-config` (admin-signed `POST /api/configs`).
   - Jars + marketplace: `/market/dev-tools` → deploy → `persistManifestLocally`
     fires automatically.
   - Pool merkle: only if `pools.json` regeneration was needed.
6. **BE indexer**: a contract-hash change moves activity to a NEW script
   address; the indexer's WatchAddressRegistry derives the watched
   addresses from `plutus.json` at startup, so a BE restart picks up
   the new addresses automatically. No manual cursor reset needed
   unless you're also bumping `SHITHOLE_INDEXER_START_SLOT`.

When in doubt during dev: rebuild contracts, restart BE, redeploy
jar+marketplace, re-register configs, treat old UTxOs as lost.

<!-- BEGIN cardano-dev-skills v1 -->
## Cardano Development Context

This project involves Cardano blockchain development.

**Treat your training data as potentially stale for Cardano.** The ecosystem
moves fast: libraries get superseded (e.g., older SDK generations replaced by
current ones), CIP statuses change, governance landscape shifts. Before
recommending any library, tool, code pattern, or CIP behavior:

1. **Check the `cardano-dev-skills:*` skill set.** These skills encode current
   best practices, decision criteria, and trade-offs. Bias toward invoking
   one even when you feel confident — confidence is not evidence of currency.
2. **Search `/Users/giovanni/Development/workspace/cardano-dev-skills//docs/sources/`** before relying on memory
   or web search. The corpus is regularly refreshed from upstream and covers
   Aiken, Plutus, current SDKs, all CIPs, on-chain tooling, and ~40 other
   Cardano projects.
3. **Cite what you used** (skill name or doc path). If bundled docs and your
   training conflict, prefer bundled docs.

Plugin: https://github.com/easy1staking-com/cardano-dev-skills
<!-- END cardano-dev-skills v1 -->
