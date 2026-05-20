-- V1_0_3 — v3 wanted_listing support.
--
-- Three tables backing the BE's merkle-proof service:
--
-- * `nft_traits`         — one row per cashgrab NFT, raw trait data. Queryable
--                          per-NFT lookup; source-versioned via a content
--                          hash so we can trace each merkle root back to the
--                          exact NFT snapshot it was computed from.
--
-- * `pool_curation`      — one row per stake pool the curation knows about.
--                          Carries the set of "accepted" trait values for
--                          that pool plus a source-version hash.
--
-- * `pool_merkle_roots`  — append-only ledger of every (root, asset_names,
--                          source_versions) tuple the seeder has ever
--                          produced. PK is the 32-byte root. `is_active` is
--                          TRUE iff the row appears in the currently-shipped
--                          curation snapshot; historical superseded roots
--                          stay queryable forever (proofs for old listings
--                          must remain producible even if curation has moved on).
--
-- All hex-encoded value columns are stored as BYTEA (raw bytes, no '0x'
-- prefix). asset_names lists inside JSONB are stored as arrays of lowercase
-- hex strings — JSONB-of-BYTEA is awkward in JPA, and the FE wants hex anyway.

CREATE TABLE nft_traits (
    -- 28-byte asset_name (raw bytes). PK because NFTs are 1:1 with asset_name
    -- within the cashgrab policy. CHECK enforces the Cardano CIP-25 hard
    -- limit (asset_name = 28 bytes / 56 hex chars).
    --
    -- NOTE: this initial constraint is wrong (real CIP-25 allows 0-32 bytes;
    -- Hosky CashGrab names are 22 bytes). Loosened forward in V1_0_4.
    asset_name BYTEA PRIMARY KEY CHECK (octet_length(asset_name) = 28),
    -- {category: value} map (Background → "Cyan", Fur → "Original", ...).
    -- We don't pre-normalize categories/values into separate columns: querying
    -- is rare and the JSONB shape mirrors the source jsonl 1:1.
    traits JSONB NOT NULL,
    -- sha2_256 of the source jsonl file that produced this row's traits.
    -- Lets the seeder detect "source file unchanged → skip re-ingest" and lets
    -- a merkle root row prove WHICH snapshot of traits it was computed from.
    source_version VARCHAR(64) NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The seeder will query "rows whose traits intersect this pool's accepted set"
-- when building per-pool merkle inputs. GIN on the JSONB enables fast
-- containment queries (`traits @> '{"Background":"Cyan"}'` style).
CREATE INDEX nft_traits_traits_gin ON nft_traits USING GIN (traits);


CREATE TABLE pool_curation (
    -- Curation label (HOSKY, A3C, VEGAS, ...) post-migration. NOT the
    -- bech32 stake pool id — see `pool_id` for that. Tickers are stable
    -- across re-curations of the same pool (a "HOSKY v2" curation has
    -- ticker = 'HOSKY' and a different source_version).
    ticker VARCHAR(64) PRIMARY KEY,
    -- 28-byte bech32-decoded stake pool hash, or NULL when the curation
    -- knows the pool by ticker only (some community-tracked pools haven't
    -- published their pool ID yet).
    pool_id BYTEA CHECK (pool_id IS NULL OR octet_length(pool_id) = 28),
    -- Set of {category, value} pairs an NFT must match AT LEAST ONE of to
    -- be included in this pool. Stored as a JSONB array of objects:
    -- [{"category":"Background","value":"Cyan"}, ...].
    accepted_traits JSONB NOT NULL,
    -- sha2_256 of the source curation file. Together with `nft_traits.source_version`
    -- this fully identifies the inputs that produced any given merkle root.
    source_version VARCHAR(64) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE pool_merkle_roots (
    -- 32-byte sha2_256 root. THE primary key — uniquely identifies a tree.
    -- CHECK enforces sha2_256's 32-byte output so malformed rows can't
    -- enter the table even via direct SQL.
    merkle_root BYTEA PRIMARY KEY CHECK (octet_length(merkle_root) = 32),
    -- Curation ticker this root belongs to. NOT unique across the table:
    -- multiple historical roots may share a ticker (each is a different
    -- snapshot of the underlying inputs). See the unique partial index
    -- below for the at-most-one-active-per-ticker rule.
    ticker VARCHAR(64) NOT NULL,
    -- Optional bech32-decoded stake pool hash, mirrored from pool_curation
    -- at the time this root was computed.
    pool_id BYTEA CHECK (pool_id IS NULL OR octet_length(pool_id) = 28),
    -- The canonical-ordered list of asset_names that produced this root.
    -- Lexicographic ascending. Order is load-bearing — same list, different
    -- order ⇒ different root via the library's left-leaning split-by-half
    -- tree construction (aiken_merkle_tree/mt.ak:227-249). Stored as JSONB
    -- array of lowercase hex strings.
    asset_names_hex JSONB NOT NULL,
    total_assets INT NOT NULL,
    -- TRUE iff this root is in the currently-shipped curation snapshot
    -- (i.e. matches the resource file the seeder just verified). Superseded
    -- roots are NOT deleted — they flip is_active = FALSE and stay queryable
    -- for any in-flight listings that committed them.
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    -- Provenance: which nft_traits + pool_curation versions produced this root.
    -- A future fix-and-rebuild can use these to answer "what changed?"
    source_nft_version VARCHAR(64) NOT NULL,
    source_curation_version VARCHAR(64) NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique partial index for the hot path: "which active pool serves this
-- ticker?". At-most-one-active-per-ticker is a hard invariant — without it,
-- findActiveByTicker can return non-unique results and 500. Mirrors the
-- partial-index pattern in V1_0_1's listing_events_active but tightened
-- from INDEX to UNIQUE INDEX.
CREATE UNIQUE INDEX pool_merkle_roots_active_ticker
    ON pool_merkle_roots (ticker)
    WHERE is_active = TRUE;
