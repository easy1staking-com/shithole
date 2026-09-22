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

See `SPEC.md` for the full protocol; design rationale (39 logged decisions) lives in this
repo's Claude project memory — `~/.claude/projects/<slug>/memory/`, where `<slug>` is this
repo's absolute path with `/` replaced by `-` (so it differs per machine; do not hardcode it).

## Tech stack

- **Smart contracts:** Aiken (stdlib 3.1.0+, plutus v3, compiler v1.1.22 — pinned; this is the mainnet-deployed compiler, DO NOT bump)
- **Frontend:** Next.js + Evolution SDK (mobile-first; Eternl → Vespr → Lace wallet priority)
- **Backend:** Java 21 + Spring Boot 3.3.x + Yaci Store + Postgres + Flyway. CCL annotation processor generates Java types from `contracts/plutus.json`. **Gradle (not Maven).**
- **Repo:** polyglot monorepo — `contracts/` (Aiken), `web/` (Next.js), `api/` (Spring Boot). `Makefile` + `compose.yaml` glue. No Turborepo/Nx.

## Commands

Proven on this box (Linux). Last re-proved cold **2026-09-22** (fabbrica-init
schema 2). Run from repo root. Slice-contract Verification sections cite these.

| Command | What | Status (2026-09-22) |
|---|---|---|
| `make web-test` — `cd web && vitest run` | FE unit tests | ✅ 109 pass |
| `cd web && npm run lint` | FE eslint | ✅ 0 errors (5 harmless `exhaustive-deps` warnings) |
| `make web-build` — `next build` | FE build | ✅ pass |
| `make api-test` — `./gradlew test` | BE tests | ✅ 120 pass (`--rerun-tasks`; see gotcha) |
| `make api-build` — `./gradlew build -x test` | BE build | ✅ pass |
| `make contracts-build` — pin check + `aiken build` | blueprint + FE copy | ✅ `plutus.json` byte-identical on **v1.1.22** |
| `make contracts-test` — pin check + `aiken check -D` | Aiken tests | ✅ 174 pass on **v1.1.22** |

### Setup and gotchas

1. **Aiken pin — `aikup install v1.1.22`.** v1.1.22 is the mainnet-deployed
   compiler (provenance); do NOT bump the `aiken.toml` pin. This box has drifted
   twice (v1.0.26-alpha at 2026-08-12 init; **v1.1.21** found active on
   2026-09-22, which rewrote every script hash in `plutus.json`). **`make
   contracts-build` / `contracts-test` now refuse to run unless `aiken --version`
   equals the `aiken.toml` pin** (`make aiken-pin`). A bare `aiken build` inside
   `contracts/` bypasses that guard — always go through `make`.
   - Every build rewrites the etag *timestamp* in `contracts/aiken.lock` (the
     content hash is unchanged). That is noise: `git checkout -- contracts/aiken.lock`,
     never commit it alone.
   - If `make contracts-build` rewrites more than that timestamp and the
     `plutus.json` preamble `compiler` string, STOP — bytecode drifted and the
     full **Contract change checklist** (below) applies.
   - Don't `rm -rf build` (or `make clean`) to "diagnose" — a clean re-resolve can
     pull a mismatched transitive dep (seen once: `fuzz v2.2.0` despite the `v2.1.1`
     pin). Re-run `aikup install v1.1.22` and rebuild instead.
2. **Java.** jenv resolves Java 21 from `api/.java-version`, so `make api-*`
   works with no `JAVA_HOME` (re-verified 2026-09-22). A bare `java` from the
   repo root still fails (`jenv: java: command not found`) — there is no global
   version; `export JAVA_HOME=~/.jenv/versions/21.0.11` if you need one there.
   ⚠ jenv's failure exits **0**: a gradle run that printed "java: command not
   found" did not build. Gradle also caches — `UP-TO-DATE` means no test ran;
   pass `--rerun-tasks` when a test run is the evidence.
3. **Staging.** `web/next.config.ts` and `web/src/lib/market/manifest.json` live
   permanently modified in the working tree and must never be committed. Stage
   by explicit path (no `./` prefix): `git add -A` / `.` / `commit -a` and
   tree-wide `checkout`/`restore .`/`git clean` are denied by the permission
   policy.

## Code review process

**After writing each significant code chunk — a validator, a service class, a non-trivial UI component — run it through Codex via the `codex:rescue` skill before committing.** The review brief should:

- List the relevant files (the chunk + any context files).
- Ask for: bugs, performance issues, idiom violations, missing tests, security concerns.
- Be specific and adversarial — e.g., "find any way to bypass this validator's invariants."

After the review, action the findings (or explicitly reject with rationale), then commit. Codex output goes through Claude for triage; do not action findings blindly.

For Aiken contracts specifically, **also reference the performance tips in `cardano-dev-skills` (skills `optimize-validator`, `write-validator`) before writing**. Validators must be CPU- and memory-efficient — Plutus budgets are tight. Use the bundled docs under `${CLAUDE_PLUGIN_ROOT}/docs/sources/` (see the Cardano Development Context block below for the canonical path) — specifically `aiken/`, `aiken-stdlib/` and `aiken-design-patterns/`.

## Cardano-specific constraints (recap from SPEC)

- **No native randomness on Cardano.** Bucket selection is a deterministic hash of `(collection_policy ‖ nb_asset_name ‖ cbor.serialise(UA.outRef))` mod M, where UA is the input that physically holds NB. Bounded grinding accepted (~0.17 ADA per attempt).
- **Same-policy-id enforcement is on-chain;** "dead collection" curation is off-chain (FE/BE).
- **UTxO contention drives parallelism**: one NFT per listing UTxO, config read as CIP-31 reference input (never spent on swap path).
- **Double-satisfaction defenses** via shared `compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))` (matches `jpgstore-sniper`). Applied to treasury inline datum AND listing `update_ref` field.

## Working with this repo

- **The bundled cardano-dev-skills docs are the primary Cardano reference**, not the Cardano MCP. Path: `${CLAUDE_PLUGIN_ROOT}/docs/sources/` (canonical form lives in the Cardano Development Context block below — do not hardcode an absolute path here; it breaks on any other machine and leaks a local layout into a public repo). ~58 sources, refreshed from upstream. MCP has round-robin loops and truncation issues — fallback only.
- The relevant Cardano dev skills (`cardano-dev-skills:*`) are loaded — `write-validator`, `optimize-validator`, `build-transaction`, `review-contract`, `query-chain`, `design-token` are the most relevant here.
- The `easy1staking-dev-skills:*` plugin is also loaded — `design-process` (this project's workflow) and `cardano-design-patterns` (the architectural patterns we mirror, including jpgstore-sniper's `compute_output_tag` recipe).
- Run formal Codex code review (see "Code review process" above) on every non-trivial code chunk before committing.

## Reference projects (mirror these patterns)

Both are **workspace sibling repos, read for pattern only — never built against.** Paths are
intentionally relative: they sit alongside this repo in the same workspace directory, and
**neither is checked out on every machine** (as of 2026-08-17, neither is present on this
Linux workstation). Locate them with `fd -t d <name> ~` or ask Giovanni; do not hardcode an
absolute path here.

- **Aiken**: `jpgstore-sniper` → `src/jpgstore-sniper-onchain/` — `validators/settings.ak` is the multi-handler template for our `config.ak`; `validators/snipe.ak` for our `listing.ak`; `lib/utils.ak` exports `compute_output_tag` and `signed_by` (copy verbatim).
- **BE**: `ada-watch` — Spring Boot 3.3.4 + Java 21 + Yaci Store + Postgres + Flyway. Strip telegram/discord/scalus/notification deps for our use; keep Lombok, CCL, CCL annotation processor, Spring Boot starters.

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

<!-- BEGIN cardano-dev-skills v2 -->
## Cardano Development Context

This project involves Cardano blockchain development.

**Treat your training data as potentially stale for Cardano.** The ecosystem
moves fast: libraries get superseded (e.g., older SDK generations replaced by
current ones), CIP statuses change, governance landscape shifts. Before
recommending any library, tool, code pattern, or CIP behavior:

1. **Check the `cardano-dev-skills:*` skill set.** These skills encode current
   best practices, decision criteria, and trade-offs. Bias toward invoking
   one even when you feel confident — confidence is not evidence of currency.
2. **Search `${CLAUDE_PLUGIN_ROOT}/docs/sources/`** before relying on memory
   or web search. The corpus is regularly refreshed from upstream and covers
   Aiken, Plutus, current SDKs, all CIPs, on-chain tooling, and ~50 other
   Cardano projects.
3. **Cite what you used** (skill name or doc path). If bundled docs and your
   training conflict, prefer bundled docs.

Plugin: https://github.com/cardano-foundation/cardano-dev-skills
<!-- END cardano-dev-skills v2 -->

## Constitution

**Purpose.** Give dead / rugpulled Cardano NFT collections a second life via random
in-collection swaps, plus the singleton NFT marketplace and the walkable 3D gallery
("the dump") around it. **Live on mainnet** — every boundary below exists because
real user assets sit at deployed script addresses. Needing more than this section
grants is an escalation to Giovanni, never a judgment call.

**Modules.** `contracts/` (Aiken, plutus v3, compiler pinned v1.1.22) · `api/` (Java 21,
Spring Boot 3.3.x, Yaci Store, Postgres, Flyway, Gradle — never Maven) · `web/`
(Next.js, Evolution SDK). Glue is `Makefile` + `compose.yaml`; no Turborepo/Nx.

**Hard invariants.**
1. `contracts/plutus.json` is the single source of truth for both other modules (FE
   reads the copied blueprint at runtime; the BE generates types and `COMPILED_CODE`
   from it at build time).
2. No slice is ever scoped to `contracts/` alone: any `.ak` edit moves script hashes,
   orphans live UTxOs, and drags the full **Contract change checklist** above.
   Contract changes ride a planned redeploy, never ship standalone.
3. The aiken pin is mainnet provenance — never bumped (guarded in the `Makefile`).
4. `web/next.config.ts` (local dev origin) and `web/src/lib/market/manifest.json`
   (local deploy manifest) stay permanently modified and are never committed. The
   manifest is a static build-time import: a preprod copy on `main` would go live.
5. `main` auto-deploys to Vercel — a push/merge to `main` IS a production release.

**Allowed technologies.** As per the module list. Adding to a module's stack is an
escalation. New runtime dependencies need justification (UI that plain React can
do gets no new npm dep).

**Allowed service dependencies.** Blockfrost (primary chain provider, FE + BE) ·
Yaci Store + Postgres + Flyway · public IPFS gateways (known fragile behind DNS
filters) · Koios (incidental). Anything else — e.g. a paid pinning service — is an
escalation.

**Reference repos (read for pattern, never built against):** `jpgstore-sniper`,
`ada-watch`, `cardano-dev-skills`.

**Boundaries.** Belongs here: the swap protocol, the marketplace, their FE/BE
support, curation tooling. Split seams, flagged not proposed: the **3D gallery /
arcade** (self-contained surface, own asset pipeline) and the **p2p / wanted-listing**
subsystem (own validators, matcher and merkle pools).

## Hand-offs across machines

This repo is public, so the factory's working state (`PLAN.md`, `WORKLOG.md`,
`.fabbrica/`, the generated `.claude/settings.json` / `.codex/`) is **untracked and
local to one machine**. It does not travel with a clone. Anything a different
machine or a fresh clone must read — a hand-off, a lead, the current head, how to
reproduce — goes in a **tracked** doc (`docs/`, or this file), never only in the
worklog.

<!-- fabbrica:begin -->
## La Fabbrica
This repo is factory-operated (fabbrica plugin). Non-trivial requests go through
`intake` (never straight to code); tickets run as slice contracts with the
worker/auditor pair; before ending any significant work, run `distill` — "close
the circle" — even if Giovanni forgets to ask. Ticket substrate: plan.
Fabbrica init schema: 2.
Authority class: 2 partner-profile (ours, but public + mainnet + `main` auto-deploys)
— branches and `dev` push freely; `main` only through a PR Giovanni merges.
Factory floor: standard — the lowest `Lane:` any slice here may carry (`model-routing`);
`critical` where Giovanni rules it at onboarding. A slice may raise, never lower.
State lives in WORKLOG.md plus the substrate (PLAN.md, or GitHub Issues where the
substrate is github — factory trail stays out of public issues), plus the local
`.fabbrica/` state-owning checkout. An open slice forbids switching or deleting it.
<!-- fabbrica:end -->
