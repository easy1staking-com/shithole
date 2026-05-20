-- V1_0_5 — v3 wanted-listing on-chain event log.
--
-- One row per wanted-listing UTxO ever observed at a watched
-- wanted_listing script address. Unlike v2 listings, wanted-listings DO
-- NOT replant on fulfill — they dissolve. So the lineage shape of
-- listing_events isn't needed here: a flat row with optional terminal
-- spent_* fields is sufficient.
--
-- "Active" listings (those a buyer can fulfill / reclaim) are exactly the
-- rows with spent_action IS NULL. Spent rows stay for history / FE
-- "your past listings" views.

CREATE TABLE wanted_listing_events (
    -- Output reference of this listing UTxO. Composite PK.
    tx_hash BYTEA NOT NULL CHECK (octet_length(tx_hash) = 32),
    output_index INTEGER NOT NULL,

    -- Resolves to the curated collection via configs.config_nft_policy.
    -- Stored here so queries by collection don't have to join.
    config_nft_policy BYTEA NOT NULL CHECK (octet_length(config_nft_policy) = 28),

    -- From the decoded WantedDatum.
    buyer_pkh BYTEA NOT NULL CHECK (octet_length(buyer_pkh) = 28),
    -- Full bech32 delivery address — the on-chain validator does full-
    -- Address equality on Fulfill so we need to preserve the exact string
    -- for FE display + future fulfill-tx wallet routing.
    buyer_address_bech32 VARCHAR(160) NOT NULL,
    -- 32-byte sha2_256 merkle root this listing commits to.
    accepted_merkle_root BYTEA NOT NULL CHECK (octet_length(accepted_merkle_root) = 32),

    -- The offered NFT (the one the buyer wants to dump). 28-byte policy
    -- prefix + 0-32 byte asset_name. Stored concatenated as "unit" (same
    -- format the FE uses everywhere). Length range is 28 (empty
    -- asset_name) .. 60 (32-byte asset_name).
    offered_nft_unit BYTEA NOT NULL
        CHECK (octet_length(offered_nft_unit) BETWEEN 28 AND 60),

    -- Total lovelace locked in this UTxO at creation time.
    lovelace BIGINT NOT NULL CHECK (lovelace >= 0),

    created_at_slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,

    -- Terminal spend fields. NULL while the listing is active.
    -- spent_action is one of: fulfill | reclaim | rescue | spent_unknown.
    -- v1 of the indexer doesn't classify by redeemer — it marks every
    -- terminal spend as 'spent_unknown'. Redeemer-driven classification
    -- is a follow-up (same approach v2 took for cancel-vs-recover).
    spent_at_slot BIGINT,
    spent_at TIMESTAMPTZ,
    spent_by_tx_hash BYTEA CHECK (spent_by_tx_hash IS NULL OR octet_length(spent_by_tx_hash) = 32),
    spent_action VARCHAR(16)
);

-- Hot path: "what's active right now?" — drives the browse page.
CREATE INDEX wanted_listing_events_active_recent
    ON wanted_listing_events (created_at_slot DESC)
    WHERE spent_action IS NULL;

-- "my listings" / reclaim: by buyer.
CREATE INDEX wanted_listing_events_buyer_active
    ON wanted_listing_events (buyer_pkh)
    WHERE spent_action IS NULL;

-- Filter by collection within the browse page.
CREATE INDEX wanted_listing_events_config_active
    ON wanted_listing_events (config_nft_policy)
    WHERE spent_action IS NULL;

-- Per-pool browse: which listings target a specific merkle root.
CREATE INDEX wanted_listing_events_root_active
    ON wanted_listing_events (accepted_merkle_root)
    WHERE spent_action IS NULL;
