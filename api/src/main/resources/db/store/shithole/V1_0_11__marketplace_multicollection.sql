-- V1_0_11 — multi-collection marketplace.
--
-- Two shapes of curated collection now coexist:
--   * pit-backed (has an on-chain config_nft_policy; registered via
--     POST /api/configs) — the existing rows;
--   * marketplace-only (NO config; seeded from marketplace_collections.csv)
--     — Gnomeskies / Snekkies / Hosky 10k etc.
-- So config_nft_policy becomes nullable, and a `surface` tag records where a
-- collection appears. A per-collection default pricing token is stored so the
-- list form + activity feed know what to price in.
--
-- marketplace_events gains a collection_policy_id dimension (derived from the
-- listed NFT's policy) so the public per-collection activity feed + stats can
-- query by collection.

-- --------------------------------------------------------------------------
-- curated_collections: nullable config + surface + default pricing token
-- --------------------------------------------------------------------------
-- Marketplace-only collections have no on-chain config. (The candidate_configs
-- FK was already dropped in V1_0_2; config_nft_policy stays UNIQUE — Postgres
-- allows multiple NULLs, so many config-less rows coexist.)
ALTER TABLE curated_collections ALTER COLUMN config_nft_policy DROP NOT NULL;

ALTER TABLE curated_collections
    ADD COLUMN surface                TEXT NOT NULL DEFAULT 'marketplace',  -- pit | marketplace | both
    ADD COLUMN default_price_policy   TEXT,     -- hex policy id; NULL/'' = ADA
    ADD COLUMN default_price_name     TEXT,     -- hex asset name
    ADD COLUMN default_price_decimals INTEGER,  -- smallest-unit exponent
    ADD COLUMN price_token_label      TEXT;     -- e.g. 'HOSKY', 'SNEK', 'ADA'

-- Existing rows are pit-backed (they have a config) and may also be
-- marketplace-listed → 'both', so they keep appearing in /api/curated
-- (which filters to surface <> 'marketplace').
UPDATE curated_collections SET surface = 'both' WHERE config_nft_policy IS NOT NULL;

ALTER TABLE curated_collections
    ADD CONSTRAINT curated_collections_surface_chk
        CHECK (surface IN ('pit', 'marketplace', 'both'));

-- --------------------------------------------------------------------------
-- marketplace_events: collection dimension
-- --------------------------------------------------------------------------
-- collection_policy_id = first 28 bytes (the policy id) of listed_nft_unit.
ALTER TABLE marketplace_events ADD COLUMN collection_policy_id BYTEA
    CHECK (collection_policy_id IS NULL OR octet_length(collection_policy_id) = 28);

-- Backfill every existing row from its listed NFT's policy prefix.
UPDATE marketplace_events
    SET collection_policy_id = substring(listed_nft_unit FROM 1 FOR 28)
    WHERE collection_policy_id IS NULL;

-- Drives the public per-collection activity feed (newest-first) + stats.
CREATE INDEX marketplace_events_by_collection
    ON marketplace_events (collection_policy_id, created_at_slot DESC);
