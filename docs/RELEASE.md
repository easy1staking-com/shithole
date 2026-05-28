# Release checklist

How to push a Shithole release to mainnet without orphaning UTxOs,
breaking the indexer, or shipping a verbose-trace contract.

Distilled from the 2026-05-28 marketplace release. Update when you find
something this missed.

---

## 0 — Decide what you're actually shipping

Before anything else, classify the release. Each row has a different
risk profile:

| Type | Risk | Deploy gates |
|---|---|---|
| **FE-only** (UI, copy, new pages) | Low | Vercel push-to-deploy |
| **BE-only** (new endpoint, schema migration, indexer config) | Medium | k8s helm + DB migration |
| **Contract change** (any `.ak` edit) | **HIGH** | Walk the `CLAUDE.md` "Contract change checklist" — hashes change → on-chain UTxOs become orphans |
| **New contract** (new validator, no existing UTxOs at it) | Low | Same as FE-only — the script address is unused on mainnet |
| **New feature** (e.g. marketplace 2026-05-28) | Mixed | Probably FE + new-contract; sometimes BE if indexed |

Most of the rest of this checklist is the **highest-risk path** (contract
change). Skip steps that obviously don't apply for lower-risk releases.

---

## 1 — Pre-flight (~10 min)

### Wallets + ADA
- [ ] Admin wallet ready (same private key you'll connect with on prod).
      Its payment pkh is the jar / config parameter — derived addresses
      depend on it.
- [ ] Enough mainnet ADA for whatever on-chain ops the release needs
      (jar creation: ~30 ADA for 3 seeded jars; config deploy: ~5 ADA;
      buffer for fees).

### Env vars on Vercel (prod)
- [ ] `NEXT_PUBLIC_CARDANO_NETWORK=mainnet`
- [ ] `NEXT_PUBLIC_BLOCKFROST_PROJECT_ID=<mainnet project id>` — NOT the
      preprod one. Check daily quota isn't being eaten by something else
      (we hit 403s on preprod during the 2026-05-28 session because the
      shared key was over quota).
- [ ] `NEXT_PUBLIC_API_BASE_URL=<prod BE origin>`
- [ ] Feature flags for any work shipping "stealth": e.g.
      `NEXT_PUBLIC_FEATURE_MARKETPLACE` unset = invisible. Routes 404
      AND nav hides. Flip on after the on-chain prep is done.

### Env vars on the BE (k8s / Helm)
- [ ] `SHITHOLE_CORS_ALLOWED_ORIGINS=<prod FE origin>` — without this,
      browsers block `/api/*` cross-origin requests. Default is
      localhost only.
- [ ] `OPERATOR_PKHS=<comma-separated lowercase hex>` — pkhs whose
      `POST /api/configs` submissions auto-promote to curated. Empty =
      no curation (registrations land in `configs` table only).
- [ ] `BLOCKFROST_PROJECT_ID`, `REMOTE_NODE_URL`, `REMOTE_NODE_PORT` —
      mainnet values, NOT preprod.

---

## 2 — Verify contract bytecode (HIGH-risk releases only)

### Are existing on-chain hashes preserved?

Mainnet bytecode is the source of truth. Compare `git show main:contracts/plutus.json`
to `git show <release-branch>:contracts/plutus.json`:

```bash
git show main:contracts/plutus.json | python3 -c "
import json, sys
b = json.load(sys.stdin)
for v in b['validators']:
    if v['title'].endswith('.spend') or v['title'].endswith('.mint'):
        print(f'{v[\"title\"]:40s} {v[\"hash\"]}  bytes={len(v[\"compiledCode\"])//2}')
"
```

For every validator with existing live mainnet UTxOs, the hash MUST be
identical to mainnet. If it differs:

- Check `git log main..<release-branch> -- contracts/` to see what
  touched contracts.
- Even an edit to a `lib/` dependency can flow through and change
  `compiledCode` of unrelated validators.
- Decide: revert the upstream change, or coordinate a migration (see
  CLAUDE.md "Contract change checklist").

### Is it compact-traced, not verbose?

Memory says we use `aiken build` (compact) per the policy pinned in
commit `68982d7` ("aiken v1.1.21 -> v1.1.22, build compact"). Sanity-check:

- Config validator: ~1.7 KB compact, ~5+ KB verbose
- Listing: ~2.5 KB compact, ~7+ KB verbose

If a validator's `compiledCode` length doubles vs the last release with
no source change, someone built with `-t verbose` and committed by
accident. Rebuild with plain `make contracts-build` and re-commit.

### Memory may lie

Memory entries with old hashes get out of date silently. **Trust `git
show main:contracts/plutus.json` over any memory entry.** Update the
relevant memory file when memory drifts (the 2026-05-28 session caught
the `project_mainnet_live.md` claim of `c01f1473…` was stale; actual
mainnet listing hash is `79574e15…`).

---

## 3 — Populate FE state (manifest, env)

### `web/src/lib/market/manifest.json`

The slim manifest carries only `{network, adminPkhHex, deployedAt}`.
Derived hashes/addresses are recomputed at runtime from this + bytecode.

For prod:
1. Connect admin wallet to dev FE (or a local build), switch to mainnet.
2. Go to `/market/dev-tools` → click **set as admin from connected wallet**.
3. Copy the slim JSON (the "copy JSON" button if needed) and paste into
   the committed `web/src/lib/market/manifest.json`.
4. Verify `network: "mainnet"` and the pkh matches your prod admin.

### Other persisted FE state

- `web/src/lib/market/supportedPriceTokens.ts` — mainnet HOSKY + USDM
  entries are already canonical (CF registry subjects). Add new
  price tokens to BOTH `PREPROD_PRICE_TOKENS` and `MAINNET_PRICE_TOKENS`
  or call out the asymmetry explicitly.
- `web/src/lib/market/supportedCollections.ts` — whitelist of policy
  ids the marketplace UI surfaces (filter for known-good).

---

## 4 — Branch sequence (avoid the conflict trap)

Working pattern that survived 2026-05-28:

```bash
# 1. Sync dev with main BEFORE merging dev → main
git checkout dev && git pull
git merge main                    # NOT rebase — dev is shared on origin
# resolve conflicts on dev; test there
git push origin dev

# 2. THEN fast-forward main to dev
git checkout main && git pull
git merge --ff-only dev
git push origin main              # triggers Vercel auto-deploy
```

Anti-pattern: `git merge dev` directly onto main with conflicts. Vercel
deploys conflict-resolution commits straight to prod — no checkpoint.

### Flyway migration version collisions

Two parallel feature branches both adding `V1_0_7__*.sql` → Flyway will
reject. When this happens during a merge:
- Either renumber the loser to the next free version
- Or, if one supersedes the other (port-from-main scenario), DELETE the
  redundant one.

### Lockfile conflicts

Take main's version then re-run `npm install` against the merged
`package.json`. Don't try to hand-resolve `package-lock.json` line by
line.

---

## 5 — Deploy sequence

### FE-only release

1. Push to main → Vercel deploys.
2. If shipping behind a flag: flip the flag in Vercel env vars + redeploy.

### BE release

1. Bump the BE image tag (or push to a branch that triggers the
   k8s pipeline).
2. Helm upgrade with the new tag.
3. Flyway runs new migrations automatically at boot.
4. Watch logs for `ConfigRegistrationService: operator-pkhs configured
   count=N` to confirm OPERATOR_PKHS loaded.
5. Curl `/actuator/health` from inside the cluster + `/api/curated`
   from outside (CORS sanity).

### Contract release (when a new validator is going live)

NB: this is NOT "redeploy the contract" — Plutus scripts don't get
deployed, they're parameters of a pay-to-script address. The address
exists the moment someone pays to it. The "deploy" step is whatever
the FE / admin needs to do to start using the new address.

For the marketplace 2026-05-28 release this was:
1. Merge contract source + plutus.json to main.
2. Push FE (Vercel auto-deploys with marketplace flag OFF).
3. Admin visits `/admin/jars` (admin nav surfaces by path, even with
   the marketplace flag off).
4. Click **create** with N=3 (default seed: 10 ADA per jar). Submits a
   mainnet tx that creates 3 UTxOs at the jar script address.
5. After confirmation, flip `NEXT_PUBLIC_FEATURE_MARKETPLACE=on` in
   Vercel + redeploy. Marketplace routes + nav go live.

### Config registration (for a new collection)

1. Admin mints the per-collection config NFT (one-shot policy).
2. Admin deploys the config UTxO via `/admin/register-config` —
   builds the on-chain tx + signs CIP-8 attestation.
3. BE indexer picks up the new listing-script address from the
   `ConfigRegisteredEvent` and starts watching.

---

## 6 — Post-deploy verification (~15 min)

### Smoke tests on the live FE

- Connect a fresh wallet, browse the new feature.
- Run one full happy-path tx (e.g., for marketplace: list a low-value
  NFT, buy with a second wallet, cancel from `/me`).
- Confirm the fee math: did the jar receive the expected fee? Did the
  seller receive the expected amount?

### BE sanity

- `/api/curated` returns the expected collections.
- `/api/p2p/pools` returns the expected pool catalog (12 pools post the
  Hosky migration).
- Logs: no `Failed to apply migration` or `Blockfrost backend
  unavailable` errors.

### Indexer cursor

If you bumped `SHITHOLE_INDEXER_START_SLOT` (rare in prod), clear
`cursor_` so the indexer starts fresh. **Don't** do this casually on
prod — you lose historical event tracking.

### Memory bookkeeping

Update memory entries when reality drifts from what's recorded:
- `project_mainnet_live.md` — current bytecode hashes (cite the actual
  values from `git show main:contracts/plutus.json`).
- Any "current cursor" / "current slot" entries — drop or refresh.

---

## 7 — Rollback plan

For each shipped change, know the answer:

| Change | How do we undo it? |
|---|---|
| FE-only behind a feature flag | Flip the flag off in Vercel + redeploy. |
| FE-only NOT behind a flag | Revert the merge commit on main, push. |
| BE deploy | Roll back to the previous Helm release tag. |
| BE schema migration | Generally not reversible — write a follow-up migration. |
| Contract change with orphaned UTxOs | NOT trivially reversible. Document the orphans + plan a Rescue path. |

If the rollback story for a change is "we can't", flag it in the PR /
release notes BEFORE shipping. Don't discover it under fire.

---

## 8 — Things this checklist won't catch

These bit us once and aren't fully covered above. Add to backlog if you
touch them:

- The Vercel manifest doesn't auto-bump when bytecode changes — runtime
  derivation handles this for the marketplace flow, but anywhere else
  that stores a parameterized hash (BE Flyway data? committed
  addresses?) needs manual bumping. See `feedback_contract_rebuild_checklist.md`.
- Eternl's catalog `urlBridge` is pinned — apex/www 307 redirects
  silently kill the CIP-30 handshake. See `project_eternl_bridge_redirect_gotcha.md`.
- Blockfrost quota is shared across preprod + mainnet keys if you only
  have one project. The first 403 is usually quota, not auth.
