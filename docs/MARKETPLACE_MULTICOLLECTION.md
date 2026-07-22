# Marketplace — multi-collection, multi-token, per-collection history

> Handoff spec / implementation prompt. Preprod-first. All design decisions below are **locked**
> (resolved in the requirements dialogue). Scope is the **Marketplace** (jpg.store-style buy/sell
> listings) — NOT the Pit swap flow.
>
> **The original spec (Objective → Out of scope) is preserved below as reference detail.**
> **The living plan is the STATUS section immediately below — start there.**

---

# STATUS & EXECUTION PLAN — updated 2026-07-15

## ⚠️ Correction: mainnet needs NO minting
Gnomeskies / Snekkies / Hosky 10k are **real, existing mainnet collections** (we scraped their
metadata *from* mainnet by policy id). SNEK / HOSKY / USDM are **real mainnet tokens**. The
**minting was preprod-only** — mimics, because the real assets don't exist on preprod and we
needed test data there. **Mainnet cutover = a pure data change**: add the real mainnet policy ids
to `MAINNET_COLLECTIONS` + seed `marketplace_collections.csv` with the real policies. Marketplace
is a singleton script → **no deploy, no mint.**

## Done
- **M0 ✓** (`1a89140`, dev) — `.local` fixture scrapes + `MintFromFixtureTool` / `preprodMintFromFixture`;
  minted Gnomeskies / Snekkies / Hosky 10k (24 each) + SNEK/HOSKY/USDM mimics on preprod. (T1–T2 ✓)
- **M3 partial ✓ — B1, B2** (`1a89140`, dev) — 3 collections + SNEK in the FE registries;
  `ListDrawer` collection selector + per-collection default-token pre-fill.
- **Done *outside* the original plan (shipped to main):**
  - **Marketplace-first landing** (`25a55a4`) — hero + live per-collection NFT strips
    (`CollectionStrip`, wallet-free `makeReadClient` + `useMarketListings`) + subordinate Pit/P2P band
    + `isMarketplaceEnabled()` kill-switch. **This partly supersedes B3** (per-collection strips
    already exist; what's left of B3 is a tab/filter on `/market` itself).
  - **Messaging / error system** (`ed27bcd`) — `classifyError` + severity `Notice` + `ErrorView`,
    React error boundaries, global network-mismatch banner.
  - **Fixes on main** — jar sweep min-UTxO fix; marketplace pre-buy balance guard (guard itself
    still parked uncommitted on dev — see Housekeeping).

## Remaining work — ordered phases

### Phase 1 — BE data foundation  ✅ DONE (dev) — (orig. M1 · Workstream A1, A2, A4, A5, A6)
- **V1_0_11 migration:** `curated_collections.config_nft_policy` → nullable; add
  `default_price_policy/name/decimals`, `price_token_label`, `surface` (pit|marketplace|both);
  `marketplace_events` + `collection_policy_id BYTEA` + index `(collection_policy_id, slot DESC)`;
  **backfill** existing `marketplace_events` from `substring(listed_nft_unit for 28)`.
- **MarketplaceEventsIndexer:** populate `collection_policy_id` on create/buy/cancel.
- **`marketplace_collections.csv` seeding** (+ env override) — mirror the `curated_collections` CSV loader.
- **Repos:** `findByCollectionPolicyId(policy, pageable)`; per-user `findAllByPkhAndConfigNftPolicy(...)`.
- **Resolution:** `collection_policy_id ↔ slug`; make `/api/collections/{slug}` work for config-less
  (marketplace-only) rows (it currently 404s when there's no config).
- BE tests (H2).

### Phase 2 — BE activity + price oracle  ✅ DONE (dev) — (orig. M2 · A3, A7)
- **PriceOracleService** — Minswap (primary) + GeckoTerminal (fallback) token→ADA, CoinGecko ADA→USD,
  scheduled ~60s, cached, behind a swappable interface.
- **`GET /api/collections/{slug}/activity`** — public, marketplace-only, token-aware, paginated,
  `{event, nft_unit, price, ada_estimate, usd_estimate, wallet, ts}`.
- **`GET /api/collections/{slug}/stats`** — 24h volume, sale count, floor, unique traders (native + ada + usd).
- **Per-user `/me` history collection filter** — optional `?collection={slug|policy}`.
- BE tests (oracle math mocked upstream; activity pagination; stats aggregation).

### Phase 3 — FE per-collection surfaces  ✅ DONE (dev) — (orig. M4 · B3-reconciled, B4, B5, B6)
- **B3 (reconciled):** landing strips already cover per-collection browse. Remaining: a collection
  **tab/filter on `/market`** itself (`MarketBrowse` currently mixes all whitelisted collections;
  it still hardcodes "HOSKY CashGrab only" copy — fix that too), driven by `/api/curated`.
- **B4:** public per-collection **activity feed + stats strip** (a collection page, e.g. `/market/[collection]`),
  consuming Phase-2 endpoints; token-aware formatting + "≈ estimated" ADA/USD.
- **B5:** per-user `/me/history` optional collection filter (tag marketplace rows w/ `collection_policy_id`).
- **B6:** theme the new collections (accent/background/mascot) from curated metadata — also feeds the
  landing strips + `CollectionStrip` tint chips + the `PitP2pBand` chips.
- FE tests (vitest + MSW curated fixtures for the 3 collections).

### Phase 4 — Preprod E2E, then mainnet cutover  (orig. M5 + cutover)
- **Preprod E2E (T3/T4):** list/buy/cancel per collection; assert activity/stats/history.
- **Mainnet cutover — DATA ONLY (no mint, no deploy):** add real mainnet policy ids to
  `MAINNET_COLLECTIONS`; seed `marketplace_collections.csv` with the real mainnet policies; SNEK/HOSKY
  already in `MAINNET_PRICE_TOKENS`. Flip on → the landing's extra strips + activity light up on prod.

## Housekeeping / cleanup (don't forget)
- **Land parked → main:** the `coinSelection` pre-buy balance guard (tested on preprod, uncommitted on dev).
- **Reconcile dev ↔ main:** dev holds the messaging/landing commits locally (now also on main via
  cherry-pick, *different hashes*) + the dev-only `1a89140` groundwork + preprod `manifest.json`/env
  working-tree changes. Rebase dev onto `origin/main` (git drops the patch-equivalent dupes, keeps
  `1a89140`); **stash the preprod working-tree changes first**, and keep the preprod
  `manifest.json` + `.env*` **dev-only, never on main**.
- **Messaging polish (deferred from the audit):** jar disabled-button hint ("nothing to sweep" /
  "below 5 ADA floor"); `update-config` zod validation (mirror `register-config`); remaining a11y
  `role`/`aria-live` on inline error `<p>`s + loading regions; delete the dead `babelProbeError` state
  in `ListingDetail`.
- **Preprod CashGrab whitelist:** the whitelisted preprod CashGrab (`ca53618b…`) is one of several
  mimic mint runs — verify it's the policy you're actively listing under when testing.
- **Commit `docs/DEV_SETUP_LINUX.md`** (untracked) and the dev-only `.gitignore` `._*`/`.DS_Store` change. ✓

## Test-plan status
T1 (fixtures) ✓ · T2 (preprod mint) ✓ · T3 (BE bring-up), T4 (E2E), T5 (automated) — per phase above.

---

# ORIGINAL SPEC (reference detail)

## Objective
Extend the Marketplace to:
1. Support multiple NFT collections beyond Hosky CashGrab — launch with **Snekkies**,
   **Gnomeskies**, and **Hosky 10k**, with a data-only path to add "all other Hosky collections".
2. Support **per-collection default pricing tokens** (Snekkies→SNEK, Hosky-ecosystem→HOSKY),
   pre-selected in the list form but **seller-overridable**. ADA stays the universal default.
3. Add a **public, per-collection activity feed** (marketplace only: listed / cancelled / purchased,
   token-aware, with ADA + USD *estimates*) so anyone can see how a collection is performing;
   and add an **optional collection filter to the existing per-user history** (`/me/history`,
   which already merges pit + p2p + marketplace).

## Locked decisions
- **Surface:** Marketplace only. The Pit is unchanged and gets no new collections here.
- **Pricing:** per-collection **default** token, seller can override at list time.
- **History split:**
  - *Public, per-collection* = **marketplace events only** (listed/cancelled/purchased).
    No public pit/p2p swap feed — nobody's asking for global swap history yet.
  - *Private, per-user* = existing unified `/me/history` (pit + p2p + marketplace), **+ optional
    collection filter**. No new public per-collection pit/p2p surface.
- **Stats:** all metrics (24h volume, sale count, floor, unique traders), per collection,
  normalized **token → ADA → USD** and shown as **"≈ estimated"**.
- **Canonical collection key across surfaces:** `collection_policy_id` (the NFT policy id).
  Marketplace events derive it from the sold NFT's policy; pit/p2p (where present) join
  `config_nft_policy → collection_policy_id` via `curated_collections`.
- **Marketplace is a singleton script** — adding a marketplace collection requires **no on-chain
  deploy**, just whitelisting the policy id + seeding curated metadata.
- **Testnet:** preprod.

## Target collections (mainnet policy ids — source of truth for the metadata scrape)
- Gnomeskies: `ec77283fe87b1ccd7e5e8eb963de4c90abc8488e1e090b16b7f70a50`
- Snekkies:   `b558ea5ecfa2a6e9701dab150248e94104402f789c090426eb60eb60`
- Hosky 10k:  `3bc4864351b565dd028218255f55239c7c6b6f2bb238f113872fb8fa`
  (reference art/metadata at `wayup.io/collection/<policy>`)

## Pricing tokens
- **ADA** — already registered (unit `""`, decimals 6).
- **HOSKY** — already registered (verify unit; decimals 0).
- **SNEK** — CONFIRMED via Cardano token registry v2
  (`tokens.cardano.org/metadata/279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b`):
  name "Snek", ticker "SNEK", **decimals 0**. Mainnet unit
  `279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b`.
- **Preprod:** mint token-mimics (real ticker/decimals, testnet policy) via `preprodMintFungible`
  and register those in the preprod token registry.

## Price oracle (for the estimated ADA/USD stats)
CoinGecko only denominates in USD, and thin-token→USD compounds two noisy legs. Instead price
**token → ADA** on a native Cardano DEX, then apply one **ADA → USD**.

`PriceOracleService` (BE, scheduled poll ~60s, cached, values swappable behind one interface):
- **token → ADA — Minswap (primary):** `GET https://api-mainnet-prod.minswap.org/v1/assets/{unit}/metrics`
  → `price` field; returns ADA when no `currency` param is given. Public, no key, rate-limited (429 → backoff).
- **token → ADA — GeckoTerminal (fallback):** free DEX API, Cardano network, pool base/quote (ADA).
  Use when Minswap 429s or has no pool.
- **ADA → USD — CoinGecko:** `GET /simple/price?ids=cardano&vs_currencies=usd` (the one leg CG does reliably).
- Endpoints return `{ native_qty, ada_estimate, usd_estimate }`; UI renders with an "≈ estimated" qualifier.
- Zero browser-side price calls (ADA/USD is one global number — must be server-cached, not per-user).

---

## Current-state map (files to touch)

### FE (`web/`)
- `src/lib/market/supportedCollections.ts` — per-network policy-id whitelist (HOSKY only today).
  `MarketBrowse` filters on `isSupportedCollection()`.
- `src/lib/market/supportedPriceTokens.ts` — per-network token registry `{label,ticker,unit,decimals}`
  (ADA/HOSKY/USDM). Add SNEK here.
- `src/lib/tx/coinSelection.ts` — `tokenAwareLargestFirst()` (already token-aware).
- `src/lib/tx/marketDatum.ts` — datum carries `pricePolicyHex/priceNameHex/priceQty` (already multi-token).
  `src/lib/tx/marketBuy.ts` — buy flow.
- `src/components/market/ListDrawer.tsx` — **hardcodes `supportedCollections()[0]`**; needs a
  collection selector + per-collection default-token pre-fill.
- `src/components/market/MarketBrowse.tsx` / `FilterBar.tsx` — browse + currency filter; add collection filter/tabs.
- `src/app/market/*` — `/market`, `/market/[unit]`, `/market/new`, `/market/me`, `/market/dev-tools`.
- History: `src/lib/me/historyEvents.ts`, `src/components/me/historyShared.tsx` (`useHistoryFeed(pkh)`),
  `src/components/me/HistoryBoard.tsx`, page `/me/history`. `WalletHistoryEvent` already has `configNftPolicy?`.
- Curated data: `useCurated()` → `GET /api/curated`; `CollectionState` in `src/types/api.ts`;
  theme `{background_url, accent_color, mascot_image_url}`.
- Mocks: `src/mocks/fixtures/api/*`, `handlers.ts`, `fixtureLoader.ts`.

### BE (`api/`)
- `entity/CuratedCollectionEntity.java` — slug, config_nft_policy, collection_policy_id, display_name,
  theme, display_order, listing_script_address.
- `entity/MarketplaceEventEntity.java` + `db/store/shithole/V1_0_10__marketplace_events.sql` —
  price_policy/price_name/price_qty; **no collection dimension today**.
- `indexer/MarketplaceEventsIndexer` (+ env `SHITHOLE_MARKET_ADMIN_PKH`).
- `listing_events` (V1_0_1/V1_0_6), `wanted_listing_events` (V1_0_5/V1_0_6) — carry `config_nft_policy`,
  `lister_pkh`/`swapper_pkh`, `buyer_pkh`/`fulfiller_pkh`. (Used by per-user history only.)
- Endpoints: `GET /api/curated`, `/api/collections/{slug}`, `/api/collections/{slug}/listings`,
  `/api/market/listings/by-pkh/{pkh}`, `/api/listings/by-pkh/{pkh}`, `/api/p2p/listings/by-pkh/{pkh}`,
  `/api/listings/{outref}/history`.
- Seeds: `api/configs.csv`, `api/curated_collections.csv`.
- Preprod tools (`api/build.gradle.kts`, `tools/preprod/*`): `preprodMintCollection`
  (MINT_PREFIX, MINT_IMAGE_URL(S_FILE)), `preprodMintFungible`, `preprodMintHoskyMimic`
  (reads `.local/*-mainnet.json`), `preprodListNft`, `preprodSwap`, `preprodDeriveAddress`, `preprodCheckBalance`.

---

## Workstream A — Backend
A1. **Migration V1_0_11:**
   - `curated_collections`: `config_nft_policy` → **nullable**; add `default_price_policy BYTEA`,
     `default_price_name BYTEA`, `default_price_decimals INT`, `price_token_label TEXT`,
     `surface TEXT NOT NULL DEFAULT 'marketplace'` (pit | marketplace | both).
   - `marketplace_events`: add `collection_policy_id BYTEA`; index
     `marketplace_events_by_collection (collection_policy_id, slot DESC)`.
   - (No new pit/p2p per-collection indexes — no public pit/p2p feed.)
A2. **MarketplaceEventsIndexer:** populate `collection_policy_id` from the listed NFT's policy id
   (first 28 bytes of the asset unit) on create/buy/cancel.
A3. **PriceOracleService:** as specified above (Minswap + GeckoTerminal fallback + CoinGecko ADA/USD),
   scheduled + cached, behind a swappable interface.
A4. **Marketplace-only curated registration:** seed from a committed `api/marketplace_collections.csv`
   (slug, collection_policy_id, display_name, theme, default_price_policy/name/decimals, price_token_label,
   surface) with env override `SHITHOLE_MARKETPLACE_COLLECTION_POLICIES`. No admin endpoint for v1.
   Loader mirrors the existing curated_collections CSV seeding.
A5. **Repositories:** `MarketplaceEventRepository.findByCollectionPolicyId(policy, pageable)`;
   `findAllByPkhAndConfigNftPolicy(...)` on listing/wanted repos (for the per-user collection filter).
A6. **Collection resolution:** `collection_policy_id ↔ slug` for both pit-backed and marketplace-only
   collections; `curated_collections` is the registry.
A7. **Endpoints (additive; existing global ones unchanged):**
   - `GET /api/collections/{slug}/activity?cursor=` — **public, marketplace-only** feed
     (listed/cancelled/purchased), token-aware, newest-first, paginated. Each row:
     `{ event, nft_unit, price: {native_qty, token_label, decimals}, ada_estimate, usd_estimate, wallet, ts }`.
   - `GET /api/collections/{slug}/stats` (or extend `/collections/{slug}`) — per collection:
     24h volume, sale count, floor, unique traders; native + ada_estimate + usd_estimate.
   - Per-user: extend `/me` history hook / endpoints with optional `?collection={slug|policy}` filter
     (no new public surface).

## Workstream B — Frontend
B1. Add the 3 collections to `supportedCollections.ts` (preprod + mainnet); add SNEK to `supportedPriceTokens.ts`.
B2. `ListDrawer.tsx`: replace `supportedCollections()[0]` with a **collection selector**; on select,
   pre-fill currency with that collection's **default pricing token** (from curated metadata), overridable.
B3. `MarketBrowse.tsx` + `FilterBar.tsx`: collection tabs/filter driven by `/api/curated` (not just the
   static whitelist); currency filter already exists.
B4. **Public per-collection activity + stats:** collection page/tab rendering `/activity` + a stats strip
   from `/stats`. Token-aware price formatting; "≈ estimated" on ADA/USD figures.
B5. **Per-user history:** extend `useHistoryFeed`/`HistoryBoard` with an optional collection filter;
   tag marketplace rows with `collection_policy_id`; keep the pit/p2p/market source tabs.
B6. Theme new collections (accent/background/mascot) from curated metadata.

## Workstream C — On-chain
None. Marketplace is a singleton script; datum is already multi-token. (A new collection getting its own
Pit would be a separate config registration — out of scope.)

---

## Test plan (preprod-first)

**T1 — Realistic fixtures (do first).** For each collection, scrape a few dozen real assets from
**mainnet** (Blockfrost by policy id): asset name bytes, CIP-25 (or CIP-68 where used) `name`, `image`
(IPFS URI), `traits`. Save `.local/<slug>-mainnet.json` mirroring `.local/hosky-cashgrab-mainnet.json`.
**Generalize the mint tool:** `MintCollectionTool` names by `MINT_PREFIX+index` — add a mode / new
`preprodMintFromFixture` task consuming `.local/<slug>-mainnet.json`, minting with the REAL asset names +
IPFS images + traits, preserving the source metadata standard (CIP-25 vs CIP-68), reusing the existing
time-locked one-shot policy pattern.

**T2 — Mint on preprod.** ~24–36 NFTs per collection (3 collections). Mint token-mimics:
`preprodMintFungible SNEK <supply> 0 SNEK` (+ others); register in the preprod token registry.

**T3 — BE bring-up.** Seed `marketplace_collections.csv` (marketplace-only: null config,
`surface='marketplace'`, default token per collection, theme). Run V1_0_11; boot BE against preprod
(`APP_NETWORK=preprod`, `PROTOCOL_MAGIC=1`, `SHITHOLE_MARKET_ADMIN_PKH=<wallet pkh>`). Confirm the
indexer populates `collection_policy_id`; confirm `PriceOracleService` fetches Minswap + CoinGecko.

**T4 — E2E per collection.** List priced in the collection's default token (verify pre-fill + override);
buy from a 2nd wallet (token-aware coin selection, babel-fee if applicable); cancel. Assert
`/collections/{slug}/activity` shows listed→purchased/cancelled with correct token/price + ADA/USD
estimates; `/stats` aggregates per token. Assert `/me/history` filters by collection.

**T5 — Automated tests.**
- Contracts: unchanged; keep `make contracts-test` green.
- BE (`make api-test`, H2): indexer sets `collection_policy_id`; new repo queries; activity pagination;
  stats aggregation; oracle conversion math (mock upstream); marketplace-CSV seeding + env override.
- FE (`make web-test`, vitest + MSW): add curated fixtures for the 3 collections + token-registry entries;
  test default-token pre-fill, collection filter, activity feed + estimated-price formatting. Update MSW
  handlers/fixtures under `web/src/mocks/fixtures/api/`.

## Milestones  (superseded by the STATUS section at top — kept for the A/B task mapping)
- **M0 ✓** — Fixtures + generalized mint tool (T1) → mint 3 collections + tokens on preprod (T2).
- **M1** *(Phase 1)* — BE: V1_0_11, indexer `collection_policy_id`, marketplace-CSV seeding, repos, resolution (A1–A2, A4–A6).
- **M2** *(Phase 2)* — BE: PriceOracleService + activity/stats endpoints + per-user collection filter (A3, A7); unit tests (T5-BE).
- **M3 (B1, B2 ✓)** — FE: registries + collection selector + default-token pre-fill. **B3 partly done by the marketplace-first landing.**
- **M4** *(Phase 3)* — FE: `/market` collection tab/filter + public per-collection activity/stats + per-user collection filter (B3-remainder, B4–B6).
- **M5** *(Phase 4)* — Full preprod E2E (T3–T4), then FE/BE test pass (T5), then mainnet data cutover.

## Out of scope
- Pit expansion / new on-chain configs for the new collections.
- Any listing-validator changes (datum already multi-token).
- Mainnet **minting or deploy** — NOT needed. The collections + tokens already exist on mainnet;
  cutover is a **data-only** whitelist + CSV seed (see STATUS ⚠️ at top). Marketplace is a singleton.
- Public pit/p2p swap history feed (per-user only for now).
