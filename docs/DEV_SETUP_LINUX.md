# Dev setup — running Shithole locally on this Linux server (preprod)

> Runbook for bringing the stack up in dev mode on **this machine**
> (`/home/giovanni/Development/workspace/shithole`, Linux, jenv-managed Java).
> Target network: **preprod** — see "Why preprod, not preview" below.
> Written 2026-07-13 after migrating the checkout + secrets from the Mac.
> Status: **not yet run end-to-end here** — this is the prep checklist so we
> can get it up next session.

---

## Why preprod, not preview

Everything is already deployed on **preprod**: the minted fixture NFTs
(Gnomeskies / Snekkies / Hosky 10k, policy ids baked into
`web/src/lib/market/supportedCollections.ts`), the SNEK/HOSKY/USDM token
mimics (`supportedPriceTokens.ts`), and the configured indexer start slot
(`SHITHOLE_INDEXER_START_SLOT=124312466`). `PROTOCOL_MAGIC=1` = preprod.

Switching to **preview** (magic 2) would mean re-minting all collections +
tokens and re-deriving everything. Don't, unless there's a reason. Stick
with preprod.

---

## Toolchain status on this server

Checked 2026-07-13:

| Tool | Needed for | Status here |
|------|-----------|-------------|
| **Java 21** | api (Spring Boot) | ✅ jenv-managed; `api/.java-version` pins `21` |
| **Gradle** | api build/run | ✅ wrapper `api/gradlew` (8.5) — no system gradle needed |
| **Node 20 + npm** | web (Next.js) | ✅ node v20.20.2, npm 10.8.2 (web uses **npm**, `package-lock.json`) |
| **Python 3 + jq** | mint/fixture scripts | ✅ py 3.14.4, jq 1.8.1 |
| **Docker + Compose** | local Postgres (`compose.yaml`) | ✅ Docker 29.6 + Compose v5.3; user in `docker` group (no sudo) |
| **Postgres / psql** | api database | ✅ **runs in Docker** (compose) — no host install needed |
| **make** | `Makefile` convenience targets | ✅ GNU Make 4.4.1 |
| **aiken** | rebuilding contracts | ❌ missing — **only needed if editing `contracts/`**; `plutus.json` is committed, so not required just to run |

Postgres runs via the committed `compose.yaml` (Docker) — no native install.
`aiken` stays optional (contracts don't need recompiling for dev).

---

## Mac→Linux copy gotchas — BOTH RESOLVED ✅

### 1. `api/.env.preprod` node host — RESOLVED
The env points node/ogmios at `panic-station`:
```
REMOTE_NODE_URL=panic-station
REMOTE_NODE_PORT=30010
OGMIOS_URL=http://panic-station:31347
```
That host lives at **192.168.1.37** on the LAN. It didn't resolve from this
server, so we added an `/etc/hosts` entry:
```
192.168.1.37  panic-station
```
Verified: resolves + both ports (30010 n2c, 31347 ogmios) OPEN. **The indexer
can run** (`SHITHOLE_INDEXER_ENABLED=true`, as configured) with live preprod
sync. If `panic-station` ever goes away, the fallback is to disable the
indexer (`SHITHOLE_INDEXER_ENABLED=false`, `YACI_SYNC_AUTO_START=false`,
`SHITHOLE_P2P_*_ENABLED=false`) for FE/BE-only dev, or repoint the three vars
at another preprod node.

### 2. `web/.env.local` was the MAINNET PROD config — RESOLVED
The copied file wired the local FE to prod BE + mainnet Blockfrost. Fixed:
- Original mainnet-dev config backed up to **`web/.env.mainnet`** (git-ignored).
  To use it: `cd web && npx next dev --env-file .env.mainnet`.
- `web/.env.local` now holds local-preprod values: `API_BASE_URL=http://localhost:8080`,
  `CARDANO_NETWORK=preprod`, preprod Blockfrost id (reused from `api/.env.preprod`),
  marketplace on, **babel-fee off** (FluidTokens tanks are mainnet-only).

> Note: to actually *sign preprod txs* in the browser you also need your
> wallet (Eternl/Vespr/Lace) switched to **preprod** with a funded preprod
> address. Fund from the faucet: https://docs.cardano.org/cardano-testnets/tools/faucet

---

## Postgres — pick one (no Docker on this box)

The BE expects Postgres at `jdbc:postgresql://localhost:5433/shithole`
(db/user/pass all `shithole`). `compose.yaml` maps container `5432 → host
5433`. Options, easiest first:

### Option A — install Docker/Podman, use the committed compose file
```
# Docker Engine (Debian/Ubuntu):
#   https://docs.docker.com/engine/install/
# then:
cd /home/giovanni/Development/workspace/shithole
docker compose up -d          # starts postgres on host :5433
docker compose down           # stop
```
Podman works too (`podman compose up -d`, or `podman-compose`). This is the
zero-config path — matches the `DB_URL` as-is.

### Option B — install Postgres natively
Install postgresql-16 (or any 15/16), then create the role + db and point
`DB_URL` at the port it listens on:
```
sudo -u postgres psql -c "CREATE USER shithole WITH PASSWORD 'shithole' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE shithole OWNER shithole;"
```
A native install usually listens on **5432**, so set in `api/.env.preprod`:
```
DB_URL=jdbc:postgresql://localhost:5432/shithole
```
(Flyway migrations `V1_0_1 … V1_0_10` run automatically at BE startup — no
manual schema setup.)

> Recommendation: **Option A (Docker)** if you're OK installing it — it's the
> path the repo is built around and keeps port :5433 consistent with the
> committed `DB_URL`.

---

## Run order (three terminals)

Assumes Postgres is up (Option A or B) and the two env gotchas above are fixed.

### 1. Postgres
```
cd /home/giovanni/Development/workspace/shithole
docker compose up -d            # Option A;  or ensure native pg is running
```

### 2. Backend (Spring Boot, port 8080 — binds 0.0.0.0)
The API reads config from the environment — you **source** the env file, then
run the gradle wrapper. Run **detached** so it survives the shell/agent session:
```
cd /home/giovanni/Development/workspace/shithole
export JENV_VERSION=21                       # Java 21 for this process
set -a; source api/.env.preprod; set +a
LOG=/tmp/be.log
setsid nohup ./gradlew -p api bootRun > "$LOG" 2>&1 < /dev/null & disown
```
Spring/Tomcat binds `0.0.0.0:8080` by default (no `server.address` set), so it's
reachable from other machines at **http://192.168.1.22:8080**. Watch the boot
log for the **`ChainAddressManifest`** banner — its `jar.spend` /
`marketplace.spend` hashes must match `jq '.validators[].hash' contracts/plutus.json`
(verified 2026-07-13: they match). Health check:
```
curl -s http://localhost:8080/api/curated | jq .      # [] until collections seeded (M1)
```

### 3. Frontend (Next.js dev, port 3000 — bind 0.0.0.0 for remote access)
```
cd /home/giovanni/Development/workspace/shithole/web
npm install                                  # first run only
LOG=/tmp/fe.log
setsid nohup npm run dev -- -H 0.0.0.0 -p 3000 > "$LOG" 2>&1 < /dev/null & disown
```
`-H 0.0.0.0` is required for a **remote browser** to reach the dev server at
**http://192.168.1.22:3000/market**. Note: launching Next via a *tracked*
background/`exec` wrapper was killed with exit 144 in this environment — the
plain `setsid nohup … & disown` form above is what works reliably.

---

## Remote agentic dev server (this box: 192.168.1.22)

This checkout runs on a headless Linux box driven by a Claude Code agent; a
developer reaches the running app from **another machine's browser** over the
LAN. That changes three things vs. laptop-local dev — all already applied:

1. **Bind to 0.0.0.0.** BE binds all interfaces by default; FE must be started
   with `-H 0.0.0.0` (see Run order §3). Postgres (compose) already binds `0.0.0.0:5433`.
2. **`NEXT_PUBLIC_API_BASE_URL` must be the LAN IP, not `localhost`.** It's
   resolved in the *remote* browser, so `localhost` would point at the viewer's
   own machine. Set to `http://192.168.1.22:8080` in `web/.env.local`.
3. **CORS + Next dev-origin allowlists** must include the remote FE origin:
   - `api/.env.preprod`: `SHITHOLE_CORS_ALLOWED_ORIGINS=http://192.168.1.22:3000,http://localhost:3000`
     (binds to `shithole.cors.allowed-origins`, default was localhost-only).
   - `web/next.config.ts`: `allowedDevOrigins: ["192.168.1.22"]` — Next 16 blocks
     cross-origin HMR/`_next` fetches otherwise (page loads, live-reload breaks).

**Config deltas applied on 2026-07-13 first bring-up:**

| File | Change | Why |
|------|--------|-----|
| `api/.env.preprod` | `DB_URL` port `5432→5433` | Mac used host-level pg on 5432; our compose pg is on 5433 → was "connection refused" |
| `api/.env.preprod` | added `SHITHOLE_CORS_ALLOWED_ORIGINS` | allow remote FE origin |
| `web/.env.local` | `API_BASE_URL localhost→192.168.1.22`, network preprod, babel off | remote browser + preprod |
| `web/next.config.ts` | `allowedDevOrigins: ["192.168.1.22"]` | Next 16 remote HMR |
| `/etc/hosts` | `192.168.1.22  panic-station` | node/ogmios hostname resolution |

**Stop / restart:**
```
pkill -f 'next dev'                       # FE
pkill -f 'bootRun'; pkill -f 'GradleWrapperMain'   # BE (or kill the java pid)
docker compose down                       # Postgres (add -v to wipe the volume)
```
**Log locations (detached runs):** `/tmp/fe.log`, `/tmp/be.log` (or the
scratchpad paths the agent uses). `docker compose logs -f postgres` for the DB.

See **"Starting the Marketplace on preprod"** below for why `/market` is empty
out of the box and the exact steps to make it live.

## Starting the Marketplace on preprod

**There is no on-chain "deploy".** The marketplace + jar are pure spend
validators; their addresses are *derived* by UPLC-applying the current bytecode
against an `admin_pkh` parameter (jar ← admin_pkh, marketplace ← jar_script_hash).
So "starting" the marketplace = pointing the FE at a preprod manifest + seeding
one jar UTxO. Verified data flow (2026-07-14):

- **Browse/list/buy are FE ↔ Blockfrost, not FE ↔ BE.** `MarketBrowse` calls
  `fetchMarketListings(client, marketplaceAddress)` — one Blockfrost call for
  every UTxO at the FE-derived marketplace address — then filters by the
  `supportedCollections` whitelist. `marketList` pays the NFT to that same
  derived `marketplaceAddress`. **The BE is not in the v1 loop.**
- Why `/market` is empty now: the committed `web/src/lib/market/manifest.json`
  is a **mainnet** manifest, and `marketplaceManifest()` has no network guard —
  on a preprod FE it still returns the mainnet manifest, so the FE derives a
  *mainnet* marketplace address. Nothing you list on preprod lands there.

### Prerequisites (one-time, in order)

1. **Point the FE manifest at preprod.** Connect the test wallet (on **preprod**)
   → open **`/market/dev-tools`** → click **"set as admin (localStorage)"**. This
   stages `{ network: "preprod", adminPkhHex: <connected pkh> }` in the browser's
   localStorage, which `marketplaceManifest()` prefers over the committed JSON.
   The page then shows the derived preprod `jarAddress` + `marketplaceAddress`.
   - localStorage is **per-browser** — each dev browser stages its own. For a
     durable/shared setup, paste the slim JSON into
     `web/src/lib/market/manifest.json` and commit — but **do NOT overwrite the
     committed mainnet manifest on `main`/prod**; only do that on a dev branch,
     or prod would derive the wrong address.
2. **Seed one jar UTxO.** Open **`/admin/jars`**, connect the same wallet, create
   **1** jar (FE button → `submitJarCreate`, default **5 ADA** + inline `JarDatum`
   sentinel `update_ref=0x00`). No cardano-cli needed. This is required for
   **Buy** (the fee deposit target); List/Cancel/browse work without it.
3. **Already satisfied on this box:** a tradeable token (preprod HOSKY-mimic
   `4956a820…` held by the test wallet), a whitelisted collection you hold
   (Hosky 10k / Gnomeskies / Snekkies), and `NEXT_PUBLIC_FEATURE_MARKETPLACE=on`.

### Then the loop works
List a held whitelisted NFT via **`/market/new`** (price in ADA or HOSKY) →
it shows in **`/market`** (Blockfrost, whitelist-filtered) → **Buy** from a 2nd
preprod wallet → **Cancel** returns the 2 ADA bond.

### Separate / optional — BE indexing (only for the M1/M2 activity feed)
The BE watches the marketplace address derived from `SHITHOLE_MARKET_ADMIN_PKH`
(currently `893ca99d…`), which **does not match** the dev-tools admin
(`dfc194b5…`, the connected test wallet). That mismatch is **irrelevant to the
v1 FE demo** (FE↔Blockfrost). It only matters once the BE-backed per-collection
activity feed exists (M1/M2) — at which point set
`SHITHOLE_MARKET_ADMIN_PKH` = the same admin pkh and restart the BE so its
indexer watches the address the FE actually lists to.

> Canonical marketplace bring-up runbook: `scripts/marketplace/README.md`
> (this section is the preprod-on-this-server condensed version).

## Command cheat-sheet (since `make` isn't installed)

| Intent | `make` target | Raw command |
|--------|--------------|-------------|
| Start DB | `make compose-up` | `docker compose up -d` |
| Stop DB | `make compose-down` | `docker compose down` |
| Run BE | `make api-run` | `set -a; source api/.env.preprod; set +a; cd api && ./gradlew bootRun` |
| BE tests | `make api-test` | `cd api && ./gradlew test` |
| Run web | `make web-dev` | `cd web && npm run dev` |
| Web tests | `make web-test` | `cd web && npm test` |
| Web build | `make web-build` | `cd web && npm run build` |
| Contracts build | `make contracts-build` | needs `aiken` — not installed; skip unless editing `contracts/` |

(Installing `make` — `sudo apt install make` — would let you use the short
targets. Optional.)

---

## Verify it's actually working

1. **DB reachable**: `docker compose ps` shows `shithole-postgres` healthy
   (Option A), or `pg_isready -h localhost -p <port>`.
2. **BE up**: `curl -s http://localhost:8080/api/curated | jq .` returns JSON
   (not a connection refused).
3. **BE ↔ DB**: BE startup log shows Flyway applying/validating migrations
   with no errors.
4. **FE ↔ BE**: load `http://localhost:3000/market` — collections render
   (data comes from `/api/curated` + `/api/collections/*`), no CORS/refused
   errors in the browser console.
5. **Indexer** (only if you chose node option (b)/(c)): BE log shows Yaci
   Store syncing blocks from slot `124312466`; on option (a) it's silent by
   design.

---

## Bring-up state (2026-07-13)

**Ready to run.** All blockers cleared:
- ✅ Docker + Compose usable (no sudo); Postgres runs via `compose.yaml`.
- ✅ make, Java 21, Node/npm, Gradle wrapper present.
- ✅ `panic-station` → 192.168.1.37 in `/etc/hosts`; node + ogmios reachable.
- ✅ `web/.env.local` = local-preprod; mainnet config saved to `web/.env.mainnet`.
- ✅ `api/.env.preprod` populated (indexer on, points at panic-station).

Next session: run the 3-terminal sequence below and work through any startup
errors. Still open / optional:

- **First BE boot** — hasn't been run here yet; watch Flyway + the
  `ChainAddressManifest` banner for issues.
- **aiken** — install only if we'll edit `contracts/` (rebuild + follow the
  "Contract change checklist" in `CLAUDE.md`). Not needed to run.
- **AI memory** — the `~/.claude/projects/-home-giovanni-…/memory/` dir is
  empty; the 40+ decision memories haven't been copied from the Mac. Copy the
  **files** into that dir (the folder name differs from the Mac's
  `-Users-giovanni-…` slug — drop the contents in, don't nest the old folder).
- **Feature work** — per `docs/MARKETPLACE_MULTICOLLECTION.md`, code is at
  **M0** (fixtures/mint tooling + FE list slice). Next milestone is **M1**
  (BE: migration `V1_0_11`, indexer `collection_policy_id`, marketplace-CSV
  seeding, repos).

---

## References
- `docs/MARKETPLACE_MULTICOLLECTION.md` — the multi-collection/multi-token feature spec.
- `CLAUDE.md` — project framing, contract-change checklist, code-review process.
- `README.md` — original (Mac-oriented) quick start + full prerequisites.
- `compose.yaml` / `Makefile` — infra + orchestration definitions.
- `api/.env.preprod.example`, `web/.env.preprod.example` — annotated env templates.
