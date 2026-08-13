# Backlog

Findings carried over from sessions where the work shipped under a deadline.

## Triage — 2026-08-13 (fabbrica ticket-owner pass)

The 2026-05-28 `/code-review` findings below were re-verified against current
`dev` (every finding read at its live location, not the stale line number).
Net: **1 ships now, 1 is E5-gated, 1 resolved WONTFIX, the rest defer, none
were stale-deletable.** The backlog was mostly noise — several findings were
already mitigated or defused by later work.

| # | Finding | Verdict | Why |
|---|---------|---------|-----|
| F1 | manifest hydration mismatch | **DEFER (latent)** | Doesn't fire while `manifest.json` is populated — `!!slim` is true on both server+client first render. No DOM divergence today. |
| F2 | `accompanying_lovelace ≥ 0` guard | **FIX — E5-GATED** | Real, but exploit is seller-self-detonation only (no buyer harm). Mainnet-hash-changing → must ride the E5 redeploy, not ship standalone. |
| F3 | `derivationCache` rejection race | **DEFER (benign)** | Waiters legitimately share an in-flight failure; cache self-heals. Deterministic failures → "retry would succeed" premise usually false. |
| F4 | `MarketBrowse` empty-state flash | **FIX — NOW** | Reproduces on every cold load (~50ms alarmist panel). One-file fix. → **Slice A, dispatched 2026-08-13.** |
| F5 | `JarManager` derives from `walletPkh` | **WONTFIX** | Working-as-designed: the page is a *generic per-wallet* jar manager (per its own docstring), not the protocol fee-jar console. Giovanni's call 2026-08-13. |
| F6 | cache/blueprint stale on rebuild | **DEFER (dev-only)** | HMR ergonomics; page reload is the workaround. `loadBlueprint` already fetches `no-cache`. No prod impact. |
| F7 | `submitMarketBulkCancel` no pkh-uniformity check | **DEFER** | Guards a caller that doesn't exist; sole caller pre-filters by `walletPkh`. Trivial to add if an admin sweep-all UI lands. |
| F8 | `MyListings` N metadata queries | **DEFER (low)** | React Query dedupes by queryKey → N subscriptions, one fetch per unit. Hoisting is churn for a small self-list. |
| F9 | `MyListings.selected` unbounded Set | **DEFER (cosmetic)** | Material risk already fixed in-session by `liveKeys`/`effectiveSelected`. Only in-session memory residue remains. |
| F10 | `submitJarBulkCollect` output-index ordering | **DEFER (hypothetical)** | Correct against today's Evolution SDK; guards a future SDK ordering change. Post-build assertion is cheap insurance, not a present defect. |
| F11 | `marketplaceManifest()` re-reads localStorage | **DEFER (low)** | Same root as F1; a `useSyncExternalStore` refactor would close F1+F11 together if ever prioritised. |
| — | Bounty terminology scrub | **PARKED (PLAN E7)** | Comment/naming only, no behavioural change. Tracked as its own epic. |

---

## Findings (detail — verdicts above)

Items retain their original context (file paths, risk, suggested fix); the
**Verdict** line reflects the 2026-08-13 re-verification and the current
file:line where it differs from the original.

### F2 — Marketplace `accompanying_lovelace` not guarded ≥ 0  · **FIX (E5-gated)**

- **Verdict:** Real; guard genuinely absent. **Mainnet-hash-changing** — bundle
  into the next contract redeploy (PLAN E5), never a standalone `plutus.json`
  bump. Slice contract drafted (see PLAN E5). Exploit = seller self-detonates
  own listing; no buyer harm → no urgency.
- **File:** `contracts/validators/marketplace.ak:106` (datum), `:181-182` (B2)
- **Risk:** Datum field is `Int`, not bounded ≥ 0. B2's `>=` check passes
  trivially when `accompanying_lovelace < 0`; the seller_out's required
  lovelace then computes negative and any positive payout from the buyer
  satisfies it.
- **Fix:** add `expect input_datum.accompanying_lovelace >= 0` as B0 or inline
  B2's check. Add a matching `fail` test.

### F1 — `useDerivedMarketplaceManifest` hydration mismatch  · **DEFER (latent)**

- **Verdict:** Anti-pattern real but does not reproduce today — the committed
  `manifest.json` is populated, so `!!slim` is `true` on both server and client
  first render. Latent; revisit only if the committed manifest is ever emptied,
  or fold into a `useSyncExternalStore` refactor with F11.
- **File:** `web/src/lib/market/useDerivedMarketplaceManifest.ts:38`
  (`loading: !!slim`)
- **Fix:** initialise `loading: false` unconditionally, flip to true in
  `useEffect`; or a `useSyncExternalStore`-style pattern for `localStorage`.

### F3 — `derivationCache` rejection race  · **DEFER (benign)**

- **Verdict:** Concurrent waiters legitimately share an in-flight failure; the
  `catch` nulls the cache so the next caller retries. UPLC/fetch failures are
  deterministic, so the "a retry would succeed" premise is usually false.
- **File:** `web/src/lib/market/config.ts:189-192`
- **Fix:** track explicit `{ state: 'pending' | 'resolved' | 'rejected' }`; or
  only insert into the cache on resolve.

### F4 — `MarketBrowse` ManifestEmptyState flash  · **FIX — Slice A (in flight)**

- **Verdict:** Reproduces — hook returns `data=null, loading=true` on cold load
  and the empty-state panel renders during the derive window. Isolated one-file
  fix. **Slice A dispatched 2026-08-13**; remove this entry once landed+audited.
- **File:** `web/src/components/market/MarketBrowse.tsx:43` (ignores `loading`),
  `:201`
- **Fix:** branch on `loading` to suppress the empty-state during initial
  derivation (neutral scanning/skeleton state while deriving).

### F6 — `derivationCache` + blueprint loader stale on `make contracts-build`  · **DEFER (dev-only)**

- **Verdict:** Dev-only HMR ergonomics; page reload is the workaround.
  `loadBlueprint` already uses `cache:"no-cache"` at the fetch layer. No prod
  impact.
- **File:** `web/src/lib/market/config.ts:163-193`, `web/src/lib/tx/plutusBlueprint.ts:34-56`
- **Fix:** include a `blake2b(plutus.json.preamble)` / validator hash in the
  cache key; or expose `resetDerivationCache()` + `resetBlueprintCache()` wired
  to a Next.js HMR `accept` callback in dev.

### F7 — `submitMarketBulkCancel` doesn't check seller pkh uniformity  · **DEFER**

- **Verdict:** Guards a caller that does not exist; sole caller (`MyListings`)
  pre-filters by `walletPkh`. Add when/if an admin sweep-all UI lands.
- **File:** `web/src/lib/tx/marketCancel.ts:81-83` (length check only)
- **Fix:** `if (!targets.every(t => t.datum.sellerPkhHex.toLowerCase() ===
  sellerPkhHex.toLowerCase())) throw new Error("bulk cancel requires all UTxOs
  to share the same seller pkh")`.

### F8 — `MyListings` fires N `useNftMetadata` queries  · **DEFER (low)**

- **Verdict:** React Query dedupes by queryKey, so N subscriptions collapse to
  one fetch per unit. Hoisting to `useQueries` is churn for a seller's own
  (small) list.
- **File:** `web/src/components/market/MyListings.tsx:338` (ListingRow)
- **Fix:** hoist a single `useQueries` at MyListings; pass meta+traits down.

### F9 — `MyListings.selected` Set grows unbounded  · **DEFER (cosmetic)**

- **Verdict:** The material risk (phantom selections) is **already fixed** by
  the in-session `liveKeys`/`effectiveSelected` read-time filtering
  (`MyListings.tsx:104-108`). Only cosmetic in-session memory growth remains.
- **File:** `web/src/components/market/MyListings.tsx:60`
- **Fix (optional):** prune `selected` in `refresh()`'s success branch; drop the
  separate `liveKeys`/`effectiveSelected` derivations.

### F10 — `submitJarBulkCollect` output-index ordering fragile to SDK upgrade  · **DEFER (hypothetical)**

- **Verdict:** Verified correct against today's Evolution SDK. Guards a future
  SDK output-ordering change. Post-build assertion is cheap insurance, not a
  present defect.
- **File:** `web/src/lib/tx/jarCollect.ts:194-227`
- **Fix:** add a post-build assertion walking the assembled outputs verifying
  `outputs[i].address === jar.address` for i in 0..N-1.

### F11 — `marketplaceManifest()` re-reads localStorage on every render  · **DEFER (low)**

- **Verdict:** Low cleanup, same root as F1. Not a hotspot; the cross-tab race
  is theoretical. A `useSyncExternalStore` refactor closes F1+F11 together.
- **File:** `web/src/lib/market/useDerivedMarketplaceManifest.ts:32` →
  `web/src/lib/market/config.ts:81-95`
- **Fix:** module-scope cache busted by `resetDerivationCache`; or
  `useSyncExternalStore` subscribed to the `storage` event.

## From earlier sessions (still open)

### Bounty terminology scrub — contracts + BE + docs  · **PARKED (PLAN E7)**

- **Scope:** `contracts/validators/wanted_listing.ak`,
  `contracts/lib/shithole/types.ak`, `api/docs/P2P_MATCHER.md`, BE
  matcher/auto-fulfiller Java comments + local-var names.
- **Why deferred:** FE-side scrub shipped 2026-05-28; contracts + BE parts
  didn't fit the production push window.
- **Notes:** keep on-chain `min_seller_compensation` constant name — it's
  anchored across layers. Comment/naming only; no behavioural change. Contract
  *comment* edits do not change bytecode, but bundling with any `.ak` logic edit
  is wasteful — keep parked as its own epic.
