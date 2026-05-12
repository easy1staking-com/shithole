-- Shithole BE schema — v1.0.1 (swap-history lineage)
--
-- Reference: docs/BACKEND.md §"Swap-history lineage tracking" → "Data model".
-- SPEC.md §10.2 bullet "Swap-history lineage tracking".
--
-- This migration replaces the legacy `listings` table (V1_0_0) with the
-- append-only `listing_events` lineage table. The legacy table was never
-- written to (the BE serves fixtures during bootstrap), so dropping it is
-- safe — there is no data to migrate.
--
-- The shape here is copied verbatim from docs/BACKEND.md to keep the spec
-- the single source of truth. Do not deviate without updating the doc.

---------------------------------------------------------------------
-- Drop the legacy `listings` table.
--
-- Rationale: every listing UTxO ever observed is now a row in
-- `listing_events`. The live listings are the rows where
-- `spent_action IS NULL`; the history of any listing is its lineage
-- chain ordered by `swap_index`. Keeping a separate "live only" view
-- would double-write and double-index for no benefit.
---------------------------------------------------------------------
DROP INDEX IF EXISTS idx_listings_config_nft_policy;
DROP INDEX IF EXISTS idx_listings_lister_pkh;
DROP INDEX IF EXISTS idx_listings_current_nft_unit;
DROP TABLE IF EXISTS listings;

---------------------------------------------------------------------
-- listing_events
--   One append-only row per listing UTxO ever observed at any curated
--   spend-script address. See docs/BACKEND.md §"Swap-history lineage
--   tracking" for the indexer behavior (genesis / swap / cancel /
--   recover transitions).
---------------------------------------------------------------------
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

-- Partial index over live listings only — drives the per-collection / per-lister
-- listing feed without scanning historical rows.
CREATE INDEX listing_events_active
    ON listing_events (config_nft_policy, lister_pkh)
    WHERE spent_action IS NULL;

-- Lineage index — supports `GET /api/listings/{initial_outref}/history` by
-- scanning a contiguous range of swap_index values for one (initial_tx_hash,
-- initial_output_index) tuple.
CREATE INDEX listing_events_lineage
    ON listing_events (initial_tx_hash, initial_output_index, swap_index);

-- Hash → outref reverse index. The validator stores
-- `compute_output_tag(prev_outref)` as a 28-byte hash in the listing datum;
-- the BE resolves the hash back to the structured prev outref at response
-- time when shaping the `Listing.update_ref` field.
CREATE INDEX listing_events_by_update_ref
    ON listing_events (update_ref_hash)
    WHERE update_ref_hash IS NOT NULL;
