-- Shithole BE schema — v1.0.0 (bootstrap)
--
-- Reference: docs/BACKEND.md §CIP-171 config discovery, §rebalancer, §NFT metadata pipeline,
--            SPEC.md §10.2 (BE responsibilities), §6 (validator invariants).
--
-- Notes:
--   * Yaci-Store ships its own tables under `db/store/{vendor}` (block, tx, utxo, etc.) — Flyway
--     applies those alongside this file from the same vendor directory. These tables are the
--     application-level projections that live alongside the Yaci data.
--   * Composite PKs reflect on-chain identity (config_nft_policy + utxo_ref for listings).
--   * Mirrors ada-watch's `db/store/adawatch/V1_0_0__adawatch_init.sql` migration cadence.

---------------------------------------------------------------------
-- candidate_configs
--   CIP-171 auto-discovered candidate config deployments (per docs/BACKEND.md §CIP-171).
--   Lifecycle: discovered → pending → promoted | rejected.
--   Promoted entries are mirrored into `curated_collections`.
---------------------------------------------------------------------
CREATE TABLE candidate_configs (
    config_nft_policy   TEXT PRIMARY KEY,             -- hex; equal to config validator's compiled hash
    source_url          TEXT NOT NULL,
    commit_hash         TEXT NOT NULL,
    compiler_version    TEXT NOT NULL,
    source_path         TEXT,
    discovered_slot     BIGINT,
    discovered_tx_hash  TEXT,
    discovered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              TEXT NOT NULL DEFAULT 'pending',  -- pending | promoted | rejected
    notes               TEXT
);

CREATE INDEX idx_candidate_configs_status ON candidate_configs (status);
CREATE INDEX idx_candidate_configs_discovered_at ON candidate_configs (discovered_at);

---------------------------------------------------------------------
-- curated_collections
--   Public-facing curation registry. Entries are promoted from `candidate_configs`
--   by an admin action; serves `GET /api/curated`.
---------------------------------------------------------------------
CREATE TABLE curated_collections (
    slug                  TEXT PRIMARY KEY,
    config_nft_policy     TEXT NOT NULL UNIQUE,
    collection_policy_id  TEXT NOT NULL,                -- = config NFT's asset name (28 bytes hex)
    display_name          TEXT NOT NULL,
    background_url        TEXT,
    accent_color          TEXT,
    mascot_image_url      TEXT,
    display_order         INTEGER NOT NULL DEFAULT 0,
    promoted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    listing_script_address TEXT,                        -- derived address; nullable until known
    CONSTRAINT fk_curated_collections_candidate
        FOREIGN KEY (config_nft_policy)
        REFERENCES candidate_configs (config_nft_policy)
        ON DELETE RESTRICT
);

CREATE INDEX idx_curated_collections_display_order ON curated_collections (display_order);
CREATE INDEX idx_curated_collections_collection_policy_id ON curated_collections (collection_policy_id);

---------------------------------------------------------------------
-- configs
--   Indexed config UTxO state per `config_nft_policy`. One row per active config
--   (consumed configs are tracked off-table for now; live state suffices for v1).
---------------------------------------------------------------------
CREATE TABLE configs (
    config_nft_policy     TEXT PRIMARY KEY,
    utxo_tx_id            TEXT NOT NULL,
    utxo_output_index     INTEGER NOT NULL,
    m                     INTEGER NOT NULL,
    protocol_fee          BIGINT NOT NULL,
    lister_fee            BIGINT NOT NULL,
    treasury_addr_bech32  TEXT,
    treasury_addr_payment_cred_type TEXT,        -- 'verification_key' | 'script'
    treasury_addr_payment_cred_hash TEXT,
    treasury_addr_stake_cred_type   TEXT,        -- 'verification_key' | 'script' | null
    treasury_addr_stake_cred_hash   TEXT,
    admin_pkh             TEXT NOT NULL,
    updated_at_slot       BIGINT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_configs_admin_pkh ON configs (admin_pkh);

---------------------------------------------------------------------
-- listings
--   Indexed listing UTxOs that pass the §10.2 well-formedness filter.
--   PK: (config_nft_policy, utxo_tx_id, utxo_output_index).
--   A row is removed when its UTxO is consumed (swap / cancel).
---------------------------------------------------------------------
CREATE TABLE listings (
    config_nft_policy   TEXT NOT NULL,
    utxo_tx_id          TEXT NOT NULL,
    utxo_output_index   INTEGER NOT NULL,
    lister_pkh          TEXT NOT NULL,
    current_nft_unit    TEXT NOT NULL,             -- policy_id_hex || asset_name_hex
    lovelace            BIGINT NOT NULL,
    accrued_lovelace    BIGINT NOT NULL DEFAULT 0, -- lovelace - min_utxo for this output shape
    update_ref_tx_id    TEXT,                      -- compute_output_tag(prior_outRef)-derived; null at create
    update_ref_output_index INTEGER,
    created_slot        BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (config_nft_policy, utxo_tx_id, utxo_output_index)
);

CREATE INDEX idx_listings_config_nft_policy ON listings (config_nft_policy);
CREATE INDEX idx_listings_lister_pkh ON listings (lister_pkh);
CREATE INDEX idx_listings_current_nft_unit ON listings (current_nft_unit);

---------------------------------------------------------------------
-- swap_events
--   Append-only log of consumed listings via Swap. Drives §10.2 stats
--   (swap_count_24h, etc.).
---------------------------------------------------------------------
CREATE TABLE swap_events (
    id                  BIGSERIAL PRIMARY KEY,
    config_nft_policy   TEXT NOT NULL,
    tx_hash             TEXT NOT NULL,
    slot                BIGINT NOT NULL,
    consumed_utxo_tx_id TEXT NOT NULL,
    consumed_utxo_output_index INTEGER NOT NULL,
    na_unit             TEXT NOT NULL,
    nb_unit             TEXT NOT NULL,
    swapper_pkh         TEXT,
    protocol_fee_paid   BIGINT NOT NULL,
    lister_fee_paid     BIGINT NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_swap_events_config ON swap_events (config_nft_policy);
CREATE INDEX idx_swap_events_occurred_at ON swap_events (occurred_at);
CREATE INDEX idx_swap_events_slot ON swap_events (slot);

---------------------------------------------------------------------
-- nft_metadata
--   CIP-25/CIP-68 cache populated from Blockfrost /assets/{unit} (see docs/BACKEND.md).
--   On-chain metadata is immutable so cache-once-forever is correct;
--   `status` tracks the image fetch lifecycle separately.
---------------------------------------------------------------------
CREATE TABLE nft_metadata (
    unit                          TEXT PRIMARY KEY,    -- policy_id_hex || asset_name_hex
    policy_id                     TEXT NOT NULL,
    asset_name_hex                TEXT,
    asset_name                    TEXT,
    fingerprint                   TEXT,
    quantity                      BIGINT,
    onchain_metadata_standard     TEXT,
    name                          TEXT,
    description                   TEXT,
    image_ipfs_uri                TEXT,                -- ipfs://Qm... as stored on-chain
    image_url                     TEXT,                -- HTTP-resolved gateway URL (post-fanout)
    traits_json                   TEXT,                -- raw CIP-25 traits payload (JSON-as-text)
    raw_onchain_metadata          TEXT,                -- raw Blockfrost onchain_metadata as JSON
    -- Image pipeline state (see docs/BACKEND.md §image pipeline)
    image_status                  TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | permanent_failure
    image_fetch_attempts          INTEGER NOT NULL DEFAULT 0,
    image_last_attempted_at       TIMESTAMPTZ,
    image_thumb_64                BYTEA,
    image_thumb_256               BYTEA,
    image_thumb_1024              BYTEA,
    fetched_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nft_metadata_policy_id ON nft_metadata (policy_id);
CREATE INDEX idx_nft_metadata_image_status ON nft_metadata (image_status);
