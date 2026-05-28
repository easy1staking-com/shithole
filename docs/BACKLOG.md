# Backlog

Findings carried over from sessions where the work shipped under a deadline.
Each entry has enough context to act on standalone — file paths, the specific
risk, and a suggested fix. Items at the top are higher priority.

## From /code-review on the marketplace-relocation + B2 + manifest-refactor session (2026-05-28)

Two HIGH-severity bugs were fixed in-session (jar payout min-UTxO in
`submitJarMerge` + `submitJarBulkCollect`); the rest are below.

### Medium — `useDerivedMarketplaceManifest` hydration mismatch

- **File:** `web/src/lib/market/useDerivedMarketplaceManifest.ts:37`
- **Risk:** `useState({ ..., loading: !!slim, ... })` evaluates
  `marketplaceManifest()` during the first render. Server has no
  `localStorage` so slim is null → `loading=false`. Client first render
  reads `localStorage` so slim may be non-null → `loading=true`. React
  fires a hydration mismatch warning on every marketplace page for any
  user with a persisted manifest.
- **Fix:** initialise `loading: false` unconditionally; flip to true in
  `useEffect` after mount. Or use a `useSyncExternalStore`-style pattern
  for `localStorage`.

### Medium — Marketplace `accompanying_lovelace` not guarded ≥ 0

- **File:** `contracts/validators/marketplace.ak:106` (datum), `:182` (B2)
- **Risk:** Datum field is `Int`, not bounded ≥ 0. B2's `>=` check passes
  trivially when `accompanying_lovelace < 0`; the seller_out's required
  lovelace then computes negative and any positive payout from the buyer
  satisfies it. Lister self-detonates the listing; no buyer harm.
- **Fix:** add `expect input_datum.accompanying_lovelace >= 0` as B0 or
  inline B2's check. Add a matching `fail` test.

### Medium — `derivationCache` rejection race

- **File:** `web/src/lib/market/config.ts:187`
- **Risk:** `promise.catch(() => { if (derivationCache?.key === key)
  derivationCache = null })` is a microtask. Caller B that arrives
  between the cache-set and the catch firing receives caller A's
  in-flight rejected promise and surfaces an error in its own UI even
  though a retry would succeed.
- **Fix:** track explicit `{ state: 'pending' | 'resolved' | 'rejected' }`
  and skip rejected entries; or only insert into the cache on resolve.

### Medium — `MarketBrowse` ManifestEmptyState flash

- **File:** `web/src/components/market/MarketBrowse.tsx:164`
- **Risk:** Treats the hook's transient `loading=true, data=null` state
  identically to a permanently-unconfigured manifest. Users with a valid
  persisted manifest still see the alarmist "marketplace not deployed
  yet — head to /market/dev-tools" panel for ~50ms on every cold load.
- **Fix:** branch on `loading` to suppress the empty-state during initial
  derivation: `{!manifest ? (loading ? <Skeleton /> : <ManifestEmptyState />) : ...}`.

### Medium — `JarManager` derives from `walletPkh` not `manifest.adminPkhHex`

- **File:** `web/src/components/admin/JarManager.tsx:57` (and call sites
  at `:100, :126, :155`)
- **Risk:** Asymmetric with the marketplace UI's new derivation path.
  Already hit live this session — a non-admin wallet visiting
  `/admin/jars` silently sees its own (empty) jar address, no error.
- **Fix:** read `manifest.adminPkhHex` via `useDerivedMarketplaceManifest`;
  use `walletPkh` only to (a) gate the create/merge/collect buttons (must
  match admin) and (b) sign txs. Lets any wallet *view* the admin's jar
  state read-only.

### Medium — `derivationCache` + blueprint loader stale on `make contracts-build`

- **File:** `web/src/lib/market/config.ts:160-194`, plus
  `web/src/lib/tx/plutusBlueprint.ts`
- **Risk:** Both caches are module-level singletons. Next.js Fast Refresh
  preserves module state across HMR, so a contract rebuild during a
  long-lived dev session leaves the FE attaching the OLD compiled script
  against the NEW expected hash. Blockfrost script-eval fails with no
  hint. Survives in practice because Next sometimes forces a full reload,
  but not guaranteed.
- **Fix:** include a `blake2b(plutus.json.preamble)` (or the validator's
  hash itself) in the cache key; or expose a `resetDerivationCache()` +
  `resetBlueprintCache()` and call them from a Next.js HMR `accept`
  callback in dev.

### Medium — `submitMarketBulkCancel` doesn't defensively check seller pkh uniformity

- **File:** `web/src/lib/tx/marketCancel.ts:73`
- **Risk:** Trusts the docstring claim. Today the only caller (MyListings)
  pre-filters by `walletPkh` so it's fine. A future caller (admin
  sweep-all UI) could pass mixed sellers; tx builds + wallet signs + then
  Blockfrost script-eval fails with the opaque "script evaluation failed"
  error.
- **Fix:** `if (!targets.every(t => t.datum.sellerPkhHex.toLowerCase() ===
  sellerPkhHex.toLowerCase())) throw new Error("bulk cancel requires all
  UTxOs to share the same seller pkh")`.

### Low — `MyListings` fires N `useNftMetadata` queries (one per row)

- **File:** `web/src/components/market/MyListings.tsx:308` (ListingRow)
- **Risk:** Each row independently subscribes to React Query. For a
  seller with 20 listings that's 20 separate subscriptions + 20
  concurrent metadata fetches on cache miss. MarketBrowse already
  batches via `useQueries`.
- **Fix:** hoist a single `useQueries` at MyListings; pass meta + traits
  down as props to ListingRow.

### Low — `MyListings.selected` Set grows unbounded across single-cancels

- **File:** `web/src/components/market/MyListings.tsx:51`
- **Risk:** `selected` is filtered at read time via `effectiveSelected`
  but never pruned. Across a long admin session with many single-cancels,
  the underlying Set accumulates stale keys. Cosmetic for now; a future
  "spent listings" tab reusing the same key shape would surface phantom
  selections.
- **Fix:** prune `selected` in `refresh()`'s success branch
  (`setSelected(s => new Set([...s].filter(k => liveKeys.has(k))))`);
  drop `liveKeys`/`effectiveSelected` as separate derivations.

### Low — `submitJarBulkCollect` output-index ordering fragile to SDK upgrade

- **File:** `web/src/lib/tx/jarCollect.ts:170` (after the fix lands at
  `:185-195`)
- **Risk:** Redeemers hard-code `output_index = i` and rely on Evolution
  SDK preserving `payToAddress` insertion order AND appending change
  outputs at the end. Verified correct against today's SDK (Pay.js
  appends, build.js puts change last). A future Evolution change
  (e.g., CIP-95-style canonical output ordering for coin selection) would
  silently break the per-input binding.
- **Fix:** add a post-build assertion that walks the assembled outputs
  and verifies `outputs[i].address === jar.address` for i in 0..N-1.
  Or build it as a Pay-pre-finalise hook if Evolution exposes one.

### Low (cleanup) — `marketplaceManifest()` re-reads localStorage on every render

- **File:** `web/src/lib/market/useDerivedMarketplaceManifest.ts:31`
- **Risk:** Each consumer's render synchronously reads + parses
  localStorage. Not a perf hotspot today, but interacts oddly with
  cross-tab manifest mutation (other tab's `persistManifestLocally` is
  visible mid-session, which can re-derive against new addresses
  mid-tx-build).
- **Fix:** module-scope cache busted by the same `resetDerivationCache`
  path; or `useSyncExternalStore` so React subscribes to the
  `storage` event.

## From earlier sessions (still open)

### Bounty terminology scrub — contracts + BE + docs

- **Scope:** `contracts/validators/wanted_listing.ak`,
  `contracts/lib/shithole/types.ak`, `api/docs/P2P_MATCHER.md`, BE
  matcher/auto-fulfiller Java comments + local-var names.
- **Why deferred:** FE-side scrub shipped 2026-05-28; contracts + BE
  parts didn't fit the production push window.
- **Notes:** keep on-chain `min_seller_compensation` constant name —
  it's anchored across layers. Bounty mentions in code comments only;
  no behavioural change.
