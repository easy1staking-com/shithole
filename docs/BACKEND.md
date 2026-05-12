# Backend — operational details

Companion document to `SPEC.md` §10.2. `SPEC.md` covers the *what*; this file covers the *how* (data sources, image pipeline, deployment profiles, secrets, sizing). Updated independently of the protocol spec.

---

## Two deployment profiles

The BE ships as a single artifact. A feature flag (`shithole.rebalancer.enabled`) gates an entire Spring `@Configuration` via `@ConditionalOnProperty`. Public binaries are bit-identical to private — the absence of the env var (and the per-collection allowlist) is what neuters the feature.

| Profile | Where it runs | Admin seed | Rebalancer cron | Tx submission |
|---|---|---|---|---|
| **Public** | Internet-facing, behind a CDN | Not loaded | Disabled | Disabled |
| **Admin-private** | Operator's local / private network | Loaded from env var | Enabled, `@Scheduled` | Enabled |

The seed never appears in source, config files, or logs. Refuses to start if `enabled=true && seed=""`.

---

## Rebalancer service (admin-private profile only)

### Configuration

```yaml
shithole:
  rebalancer:
    enabled: false                # default off — keeps the public binary inert
    seed: ${ADMIN_SEED:}          # 24-word mnemonic, env var only
    collections: []               # config_nft_policy values this admin can sign for
    cron: "0 0 4 * * *"           # daily at 04:00 local
    staleness-threshold: 3.0      # rebalance when current_m / recommended_m > this
    dry-run: false                # log-only mode for preprod testing
    submit:
      provider: blockfrost        # blockfrost | ogmios | yaci
      preprod: false
```

### Behavior

`RebalancerService` is a `@Scheduled` Spring bean. Each run:

1. For each collection in `collections`:
   - Read `current_m` from the indexed config UTxO.
   - Compute `recommended_m = ceil(N / 3)` from the indexed well-formed-listing count.
   - If `current_m / recommended_m > staleness_threshold`, proceed; else skip.
2. Build a config-update tx via CCL:
   - Inputs: the config UTxO.
   - Outputs: same address, updated `ConfigDatum` with new `m`, config NFT preserved.
   - `extra_signatories` includes admin pkh.
3. Sign with the loaded seed.
4. Submit via the configured backend.
5. Log `{collection, old_m, new_m, tx_hash, status}` in structured form.

### Safety properties

- **Public BE has zero admin power** by construction (no env var → no beans → no signing).
- **Per-collection allowlist** — even on the private BE, if a curated config has a different admin pkh than the loaded key, the service skips it (won't waste effort on txs that will fail validation).
- **Asymmetric threshold** matches the protocol's failure mode: `current_m > 3 × recommended_m` (only triggers on pool shrinkage; growth is benign).
- **Dry-run for preprod** — logs the would-be tx without submitting.
- **Idempotent on retry** — if a config-update tx for this collection landed in this period, skip.
- **No silent retries** — submit failures are logged and the next cron run reconsiders.

### Metrics

Prometheus counters (`shithole_rebalancer_runs_total`, `shithole_rebalancer_txs_submitted_total`, `shithole_rebalancer_errors_total`) tagged by collection.

---

## NFT metadata pipeline

### Source: Blockfrost `/assets/{unit}`

We do **not** parse mint-tx metadata ourselves. Yaci Store is scoped to contract addresses only (per Giovanni's "keep Yaci lean" call), so the mint tx is not necessarily in our local DB.

Blockfrost returns parsed CIP-25/CIP-68 metadata in one call:

```json
{
  "asset": "...",
  "policy_id": "a5bb0e5b...",
  "asset_name": "484f534b59...",
  "fingerprint": "asset186z9cr...",
  "quantity": "1",
  "initial_mint_tx_hash": "ab47a352...",
  "onchain_metadata": {
    "name": "HOSKY C(ash Grab)NFT 327628",
    "image": "ipfs://QmeuGDMskJ4dJpoiBU7xzrEsuSygEjobWwQBK2bFajdeb3",
    "-----Traits-----": [{ "Background": "GN" }, ...]
  },
  "onchain_metadata_standard": "CIP25v1",
  "onchain_metadata_extra": null
}
```

Tested against Hosky #327628 on mainnet — HTTP 200, parsed cleanly, image URL recovered. Free tier (~50k req/day mainnet) covers cold-cache backfill of the curated collections plus trickle.

### Endpoint

```
GET https://cardano-mainnet.blockfrost.io/api/v0/assets/{asset_hex}
Headers:
  project_id: $BLOCKFROST_PROJECT_ID
```

Asset format: `policy_id_hex + asset_name_hex` (no separator).

### Caching

Each metadata result cached in Postgres (`nft_metadata` table). The on-chain metadata is immutable once minted, so cache-once-forever is correct. Re-fetch only on `permanent_failure` retry windows (see image pipeline below).

### Alternatives surveyed

- **Koios** `/asset_info` — functional equivalent, similar pricing. Considered as a fallback if Blockfrost has an outage.
- **NMKR API** — minting-platform-only. `GetNftDetailsById` works on NMKR-minted assets only; no generic Cardano-asset lookup. **Rejected for our use.**
- **Self-parse mint-tx via Yaci Store** — would require lifting Yaci's "scoped-to-contract-addresses" constraint. **Rejected for our use** (DB-size blowup).

---

## Image pipeline

### Source: public IPFS gateway fan-out

Blockfrost's IPFS gateway (`ipfs.blockfrost.io`) is a **paid add-on product** — returns 403 with the standard asset-API key. Verified against Giovanni's mainnet key.

We use public IPFS gateways with fan-out and short timeout:

1. **`https://ipfs.io/ipfs/{cid}`** — Cloudflare-backed, currently 200-with-immutable-cache for Hosky CIDs (verified: 479 KB PNG, `cache-control: public, max-age=29030400, immutable`).
2. **`https://dweb.link/ipfs/{cid}`** — Protocol Labs.
3. **`https://w3s.link/ipfs/{cid}`** — Web3.Storage (NFT.Storage successor).
4. **`https://gateway.pinata.cloud/ipfs/{cid}`** — Pinata's free gateway.

Per-gateway timeout: ~3 seconds. Race or sequential; race is faster but uses more bandwidth on success. Sequential is the default — try in order until one returns.

Gateway list is **config-driven**; admin can swap if any becomes unreliable:

```yaml
shithole:
  ipfs:
    gateways:
      - "https://ipfs.io/ipfs/"
      - "https://dweb.link/ipfs/"
      - "https://w3s.link/ipfs/"
      - "https://gateway.pinata.cloud/ipfs/"
    timeout-ms: 3000
    retry-policy:
      schedule: "1h, 6h, 24h, 168h"  # exponential backoff
      max-attempts: 4                # then permanent_failure
```

### Process: thumbnails

For each successful fetch:

1. Generate three thumbnails: **64×64, 256×256, 1024×1024** (JPEG, quality 85).
2. Library: **Thumbnailator** (single Java dep, ~50 KB, no native dependencies).
3. Do not store the original full-res — we never display it. Storing the original would 4-5× the size for marginal benefit.

### Store: Postgres BYTEA

| Tier | Avg size per thumbnail | Notes |
|---|---|---|
| 64×64 | ~5 KB | Used for list/grid cells |
| 256×256 | ~30 KB | Default product views |
| 1024×1024 | ~200 KB | Detail / share-card source |

Per-NFT total: ~235 KB.

| Collection scale | Postgres BYTEA budget |
|---|---|
| Hosky (~10k NFTs) | ~2.4 GB |
| 10 curated collections × 10k | ~24 GB |
| Worst-case ceiling for v1 (50k unique NFTs across all collections) | ~12 GB |

Postgres handles this without breaking a sweat on a TB-class disk. Switch to object storage (S3/MinIO) only if we ever hit ~100 GB or pgbench shows BYTEA-serving as a bottleneck.

### Serve

```
GET /api/nft/{unit}/image?size=64|256|1024
Cache-Control: public, max-age=31536000, immutable
Content-Type: image/jpeg
```

The unit→image mapping never changes after first resolution, so the cache header is aggressive. Edge CDN (Cloudflare in front of the public BE) handles repeat hits without touching Postgres at all.

### Failure UX

When all gateway retries exhaust within the retry schedule, the metadata row is marked `permanent_failure`. The image endpoint returns **404**. FE renders the joke-y placeholder ("this NFT could not be retrieved from the mud") — matches the brand. Admin can manually trigger re-fetch via an authenticated endpoint if pinning is restored.

### Optional v1.5 escalation: self-pinning

If real-world cache-miss rates show CIDs lapsing for curated collections, escalate to one of:

- **Blockfrost IPFS add-on subscription** (~$X/month — separate from the asset API key). Their gateway + their pinning infrastructure.
- **Dedicated Pinata / NFT.Storage account** for curated collections only. Background job pins all discovered CIDs to our account; CIDs stay reachable independent of the original pinner.
- **Self-hosted IPFS node (kubo)** on the same private network as the admin BE. Pin discovered CIDs locally. Heaviest ops surface but full control.

Defer until v1 metrics show this is needed.

---

## Secrets posture

All secrets live in environment variables, never in source/config files/logs:

| Secret | Env var | Profile that needs it |
|---|---|---|
| Blockfrost API key | `BLOCKFROST_PROJECT_ID` | Both (mainnet/preprod, scoped) |
| Admin wallet seed (rebalancer) | `ADMIN_SEED` | Admin-private only |
| Postgres connection password | `DATABASE_PASSWORD` (or `JDBC_URL`-embedded) | Both |
| Pinata / IPFS pinning key (v1.5) | `PINATA_JWT` | Admin-private only, if v1.5 lands |

`@Value("${BLOCKFROST_PROJECT_ID:}")` with empty default; service refuses to start if the value is empty AND the feature that needs it is enabled.

Logs scrubber: log redaction filter for the literal seed bytes and API key prefix. Default Spring Boot setup with `org.springframework.web.filter.RequestLoggingFilter` configured to never log auth headers.

---

## Free-tier reality check (mainnet)

For a single curated collection of ~10k NFTs:

| Operation | Volume | Free-tier cost |
|---|---|---|
| Backfill metadata (one-time) | ~10k `GET /assets/{unit}` calls | Well under 50k/day Blockfrost free |
| Trickle (new NFTs entering pool) | ~1-100/day after backfill | Trivial |
| Image fetch (cold cache) | ~10k IPFS gateway hits, distributed across 4 gateways | Public gateways have no per-key limits; rate-limit per IP is generous |
| Image serve (warm cache) | All from Postgres + CDN | Zero external cost |

Free tier is comfortable for v1 and probably v1.5 for one collection. If we scale to 10+ collections or onboard a very large one (50k+ NFTs), bump to Blockfrost's Build tier ($29/mo, 1M req/day) — still far below our ceiling.

---

## Updates to this document

When this file changes, bump the SPEC pointer in `SPEC.md` §10.2 only if a *protocol* concern surfaces. Day-to-day operational changes (new gateway, retry tuning, threshold values) land here directly.
