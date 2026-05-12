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

## Swap-history lineage tracking

Listings are not just live UTxOs — each listing has a *lineage* from genesis (initial pay-to-script) through any number of swaps to a terminal action (cancel or recover). The lister + a curious observer should be able to see the full timeline of a listing: when it was created, every swap that hit it (NA → NB, who initiated, when), and how it ended.

### Data model

One append-only `listing_events` table holds every listing UTxO ever observed at any curated spend-script address. The live listings are the rows where `spent_action IS NULL`; the history of any listing is its lineage chain ordered by `swap_index`.

```sql
CREATE TABLE listing_events (
  tx_hash              BYTEA NOT NULL,
  output_index         INT   NOT NULL,
  initial_tx_hash      BYTEA NOT NULL,        -- the pay-to-script that started this lineage
  initial_output_index INT   NOT NULL,
  swap_index           INT   NOT NULL,        -- 0 = genesis; 1+ = result of swap N
  config_nft_policy    BYTEA NOT NULL,
  lister_pkh           BYTEA NOT NULL,
  nft_unit             BYTEA NOT NULL,        -- NFT currently in this UTxO
  lovelace             BIGINT NOT NULL,
  update_ref_hash      BYTEA,                 -- null on genesis; compute_output_tag(prev_outref) on swaps
  created_at_slot      BIGINT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  spent_at_slot        BIGINT,                -- null = still active
  spent_at             TIMESTAMPTZ,
  spent_by_tx_hash     BYTEA,
  spent_action         VARCHAR(16),           -- 'swap' | 'cancel' | 'recover' | NULL (= active)
  PRIMARY KEY (tx_hash, output_index),
  FOREIGN KEY (initial_tx_hash, initial_output_index)
    REFERENCES listing_events(tx_hash, output_index)
);

CREATE INDEX listing_events_active
  ON listing_events (config_nft_policy, lister_pkh)
  WHERE spent_action IS NULL;

CREATE INDEX listing_events_lineage
  ON listing_events (initial_tx_hash, initial_output_index, swap_index);

CREATE INDEX listing_events_by_update_ref
  ON listing_events (update_ref_hash)
  WHERE update_ref_hash IS NOT NULL;
```

Same pattern as ada-watch's identity-by-initial-outref approach.

### Indexer behavior

On every block at/after the configured `start-slot`:

1. **Genesis case** — a tx outputs a UTxO at a curated listing address with `datum.update_ref == None`:
   - Insert row with `(initial_tx_hash, initial_output_index) == (tx_hash, output_index)`, `swap_index = 0`.

2. **Swap case** — a tx outputs a UTxO at a curated listing address with `datum.update_ref == Some(hash)`:
   - Find the listing UTxO consumed in the same tx (same script address among `tx.inputs`).
   - Sanity-check: `compute_output_tag(consumed.outref) == hash` (matches the validator's invariant S6 from SPEC §6.3).
   - Insert new row with the consumed row's lineage, `swap_index = consumed.swap_index + 1`.
   - Update the consumed row's `spent_action = 'swap'`, `spent_at_slot`, `spent_at`, `spent_by_tx_hash`.

3. **Cancel / Recover case** — a tx consumes a listing UTxO without producing a continuing listing output:
   - Update the consumed row's `spent_action = 'cancel'` (lister signature) or `'recover'` (admin signature on a datumless UTxO).
   - `spent_at_slot`, `spent_at`, `spent_by_tx_hash` populated.

Yaci Store maintains a `block` table with slot → timestamp; the indexer joins to it for the `*_at` timestamp columns.

### History endpoint

```
GET /api/listings/{initial_tx_hash}_{initial_output_index}/history
→ {
  "initial_outref": { "tx_id": "<hex>", "output_index": <int> },
  "events": [
    {
      "swap_index": 0,
      "tx_hash": "<hex>",
      "output_index": <int>,
      "slot": <int>,
      "timestamp": "<iso8601>",
      "nft_unit": "<hex>",
      "lovelace": <int>,
      "action": "create"        // genesis row marker
    },
    {
      "swap_index": 1,
      "tx_hash": "<hex>",
      "output_index": <int>,
      "slot": <int>,
      "timestamp": "<iso8601>",
      "na_unit": "<hex>",       // NFT that left
      "nb_unit": "<hex>",       // NFT that arrived
      "lovelace": <int>,
      "action": "swap"
    },
    // ...
    {
      "swap_index": <N>,
      "slot": <int>,
      "timestamp": "<iso8601>",
      "action": "cancel"        // or "recover"
    }
  ]
}
```

The `Listing` DTO returned by `GET /api/collections/{slug}/listings` includes `update_ref: { tx_id, output_index } | null` — the BE resolves the `update_ref_hash` to the previous outref via `listing_events_by_update_ref` index at response time. FE displays this as "this listing was last swapped on …" with a link to the history endpoint.

### Storage cost

For a busy collection (10k NFTs, 100k swaps lifetime), `listing_events` grows to ~110k rows × ~200 bytes = ~22 MB. Negligible. Indexes ~3× that. Postgres on a TB disk fits dozens of collections comfortably.

---

## Config registration

The curation registry is populated via `POST /api/configs` — an FE-driven, trustless endpoint that requires a CIP-8 admin signature over the metadata. The admin deploys a config UTxO via the FE; on confirmation the FE posts to this endpoint with the policy id, the curation metadata (slug + display_name + theme + display_order), and a CIP-8 signature from the on-chain admin key.

> **History.** v1 originally planned CIP-171 auto-discovery from tx-metadata label 1984. That path was deferred — see [§Future: CIP-171 auto-discovery (deferred)](#future-cip-171-auto-discovery-deferred) at the end of this section for the original plan, kept for reference.

### Endpoint

```
POST /api/configs
Content-Type: application/json

{
  "config_nft_policy": "<56-hex-char script hash>",
  "slug":              "<[a-z0-9]+(-[a-z0-9]+)*, 2..32 chars>",
  "display_name":      "<1..64 chars, no ASCII control characters>",
  "theme": {                                  // optional, all fields nullable
    "background_url":   "<https:// URL, 1..512 chars>",
    "accent_color":     "<CSS hex color, #rgb or #rrggbb>",
    "mascot_image_url": "<https:// URL, 1..512 chars>"
  },
  "display_order": 0,                         // optional, integer ≥ 0, default 0
  "signature": {
    "key":       "<hex of COSE_Key from CIP-30 signData>",
    "signature": "<hex of COSE_Sign1 from CIP-30 signData>"
  }
}
```

Response on success: **201 Created** with the persisted shape including the on-chain-derived fields (`collection_policy_id`, `m`, `protocol_fee`, `lister_fee`, `admin_pkh`, `treasury_addr_bech32`, `utxo_tx_id`, `utxo_output_index`).

### Canonical signature payload

The CIP-8 signature MUST be computed over the UTF-8 bytes of the following newline-delimited payload (field values inserted verbatim; empty string `""` substituted for any null/missing optional field; no trailing newline):

```
shithole/register-config
<config_nft_policy>           // lowercase hex
<slug>
<display_name>
<display_order>               // decimal integer string
<theme.background_url>        // or "" if null
<theme.accent_color>          // or "" if null
<theme.mascot_image_url>      // or "" if null
```

Field validation guarantees no field can contain `\n`, so the encoding is unambiguous. The leading `"shithole/register-config"` line is a domain separator that prevents the signature from being reused for any other purpose.

FE call from a CIP-30 wallet (`hashPayload=false, externalPayload=false`):

```ts
const payload = `shithole/register-config\n${policy}\n${slug}\n${displayName}\n${displayOrder}\n${bg}\n${accent}\n${mascot}`;
const { key, signature } = await wallet.signData(adminAddress, toHex(utf8(payload)));
```

### Verification pipeline (BE)

In order:

1. **Bean-validation + service-level shape mirrors** — policy hex 56 chars, slug regex, display_name regex, theme fields regex. → 400 on any mismatch.
2. **Cheap duplicate pre-check** — `existsById(slug)` and `existsByConfigNftPolicy(policy)` against both `configs` and `curated_collections`. → 409 on hit (saves a Blockfrost round-trip for the common duplicate case).
3. **CIP-8 parse + payload echo** — `COSESign1.deserialize` + `COSEKey.deserialize` from hex; reject `unprotected.hashed=true` (we only support inlined payloads); byte-compare `COSESign1.payload` to the canonically constructed payload bytes. → 401 `signature_payload_mismatch` or `signature_key_malformed` if anything fails. **Runs before Blockfrost** so a missing project-id doesn't mask malformed signatures.
4. **Address derivation** — `Address(ScriptCredential(config_nft_policy))` via `AddressProvider.getEntAddress`. Network selector is `app.network` (mainnet | preprod | preview).
5. **Blockfrost UTxO lookup** — `UtxoService.getUtxos(addr, count, page, asc)`. Page through up to `MAX_UTXO_PAGES`. On `!result.isSuccessful()`: code 404 → empty list (address never used); any other status → 502 `blockfrost_unavailable` (status code logged, response body NOT returned to the client).
6. **Strict asset-shape filter** — for each UTxO, count assets whose unit starts with `config_nft_policy`. If `> 1` same-policy assets OR the single matching asset has the wrong unit length / quantity ≠ 1 → 422 `datum_invariant_violation`. The legitimate shape: exactly one asset, unit length 112 hex chars (policy + 28-byte asset name), quantity 1.
7. **Resolve match count** — across all pages: 0 → 404 `config_utxo_not_found`; >1 → 409 `ambiguous_config`; 1 → continue.
8. **Datum decode** — `ConfigDatumConverter.deserialize(inlineDatumHex)`. Decode failure or null required fields → 422 `invalid_config_datum`.
9. **Datum invariants + numeric upper bounds** — `m ∈ [1, MAX_M=1_000_000]`, `protocol_fee ∈ [0, MAX_FEE=1_000_000_000]`, `lister_fee ∈ [MIN_LISTER_FEE=1_000_000, MAX_FEE]`. Caps are application-defensive, well below `Integer.MAX_VALUE` / `Long.MAX_VALUE` to avoid overflow in the subsequent `intValueExact` / `longValueExact` calls. → 422 `datum_invariant_violation`.
10. **Treasury address decode** — both verification-key and script credentials supported on the payment side; only inline stake credential (or no stake credential) supported on the stake side. Pointer addresses → 422.
11. **CIP-8 signer is admin** — `blake2b_224(pubKey) == datum.admin_pkh` (lowercase hex compare). Mismatch → 403 `signature_not_admin`. **Only after datum decode** so we know who the on-chain admin is.
12. **Ed25519 verify** — `EdDSASigningProvider.verify(coseSign1.signature, sigStructure.serializeAsBytes(), pubKey)`. Failure → 401 `signature_invalid`.
13. **Persist** — `REQUIRES_NEW` transaction. Re-runs the duplicate pre-check inside the tx, then `saveAndFlush` both rows; the unique indexes guarantee concurrent-submit races surface as `DataIntegrityViolationException`, which the controller maps to **409 `duplicate_registration`**.

### Error responses

| Status | `reason` tag                  | Trigger |
|--------|-------------------------------|---------|
| 400    | `invalid_request`             | Bean validation, malformed JSON, service-level shape failure |
| 401    | `signature_key_malformed`     | Hex decode / CBOR parse failed |
| 401    | `signature_payload_mismatch`  | `payload` bytes ≠ canonical; or `hashed=true` |
| 401    | `signature_invalid`           | Ed25519 verify returned false |
| 403    | `signature_not_admin`         | Recovered pubkey hash ≠ on-chain `admin_pkh` |
| 404    | `config_utxo_not_found`       | Blockfrost returned no UTxOs holding the config NFT |
| 409    | `duplicate_slug`              | Slug already in `curated_collections` |
| 409    | `duplicate_config`            | Policy already registered (in either `configs` or `curated_collections`) |
| 409    | `duplicate_registration`      | Concurrent-submit race hit a unique-index violation |
| 409    | `ambiguous_config`            | Multiple UTxOs hold the policy's NFT (shouldn't happen for legitimate deployments) |
| 422    | `invalid_config_datum`        | Inline datum missing or undecodable as `ConfigDatum` |
| 422    | `datum_invariant_violation`   | M / fees out of bounds, treasury address shape unsupported, asset-shape strict-check failed |
| 502    | `blockfrost_unavailable`      | Non-2xx Blockfrost response, network failure, or `ApiException` from CCL |

The 502 response body is a constant `"Backend temporarily unavailable"`; the full upstream error is logged at WARN. No upstream message bytes leak to the client.

### Security posture

- **No auth header**: registration is gated by the CIP-8 admin signature, not by an API key or HTTP basic auth. Anyone can hit the endpoint; only the admin can produce a valid signature.
- **`listing_script_address` is populated at registration** — derived via `aiken-java-binding`'s `AikenScriptUtil.applyParamToScript` (JNI wrapper over the Aiken UPLC runtime), applying the `config_nft_policy` as a `BytesPlutusData` parameter to the generated `ListingSpendValidator.COMPILED_CODE`. Result is bech32-encoded as an enterprise script address (`addr1w…` mainnet / `addr_test1w…` preprod). The indexer subscribes to UTxO events at this exact address.
- **Replay across slugs/themes**: prevented by the canonical-payload echo check in step 3. A valid signature for one `(policy, slug, display_name, theme, display_order)` tuple cannot be reused with a different tuple.
- **Replay against the same tuple**: prevented by the unique constraints (`configs.config_nft_policy` PK, `curated_collections.slug` PK, `curated_collections.config_nft_policy` UNIQUE). A second valid POST 409s.

### Future: CIP-171 auto-discovery (deferred)

The original v1 plan was permissionless auto-discovery from on-chain CIP-171 metadata records (tx-metadata label 1984), with an operator promotion step. We deferred it to keep v1 shippable: CIP-171 adds a separate Yaci Store processor + CBOR-chunk reassembly + a script-hash verification table that's a project-lifecycle artifact (every release would need a table update). The FE-driven path is simpler and keeps curation gated by an explicit admin signature.

When re-enabled (v1.5+), the deferred design is:

| Phase | Strategy | Trust model |
|---|---|---|
| **v1.5** | Hardcoded `RELEASED_VERSIONS` table mapping `(sourceUrl, commit, compiler) → expected_script_hash`, computed at release time and committed to BE source. | Trust the BE repo's released-versions table. |
| **v1.6** | Same, but with periodic CI workflow that rebuilds at advertised commits and updates the table. | Same trust model, fresher data. |
| **v2** | BE shells out to a local `aiken` CLI. On candidate discovery, clones the source at the advertised commit, runs `aiken build`, computes the script hash, verifies. | Trust only Cardano + the Aiken toolchain. |

The `candidate_configs` table is preserved (empty) in the BE schema for the re-enable. The FK from `curated_collections.config_nft_policy` to `candidate_configs` was dropped in V1_0_2 since under the FE-driven flow there's no `candidate_configs` row to point at.

---

## Secrets posture

All secrets live in environment variables, never in source/config files/logs:

| Secret | Env var | Profile that needs it |
|---|---|---|
| Blockfrost API key | `BLOCKFROST_PROJECT_ID` | Both (mainnet/preprod, scoped) |
| Admin wallet seed (rebalancer) | `ADMIN_SEED` | Admin-private only |
| Postgres connection password | `DATABASE_PASSWORD` (or `JDBC_URL`-embedded) | Both |
| Postgres host port | `5432` for the operator's local host-level Postgres (preferred for IntelliJ-driven dev); `5433` for the docker-compose service (for headless / CI / automation testing). | Both |
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
