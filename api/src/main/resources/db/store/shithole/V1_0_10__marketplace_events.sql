-- V1_0_10 — marketplace on-chain event log.
--
-- One row per marketplace listing UTxO ever observed at the singleton
-- marketplace script address. Mirrors the flat shape of
-- wanted_listing_events (V1_0_5) — marketplace listings dissolve on Buy
-- (NFT → buyer, ADA → seller) or Cancel (everything → seller), so
-- there's no lineage to track.
--
-- "Active" listings are exactly the rows with spent_action IS NULL.
-- Spent rows stay for the /me/history feed.

CREATE TABLE marketplace_events (
    -- Output reference of this listing UTxO. Composite PK.
    tx_hash BYTEA NOT NULL CHECK (octet_length(tx_hash) = 32),
    output_index INTEGER NOT NULL,

    -- From the decoded MarketDatum.
    seller_pkh BYTEA NOT NULL CHECK (octet_length(seller_pkh) = 28),
    -- Full bech32 — the marketplace validator does full-Address equality
    -- on Buy (the seller-payout output must land at this exact bech32).
    seller_address_bech32 VARCHAR(160) NOT NULL,
    -- Asking-price token. Both can be empty (lovelace = ADA price).
    price_policy BYTEA NOT NULL,
    price_name BYTEA NOT NULL,
    -- Asking price in smallest units of (price_policy, price_name).
    -- Inclusive of the 2 % protocol fee — seller receives
    -- (price_qty - ceil(price_qty * 2 / 100)) after the validator splits.
    price_qty NUMERIC(38, 0) NOT NULL CHECK (price_qty > 0),
    -- Bond the seller locked alongside the listed NFT. Returned to the
    -- seller on either Buy (seller's payout output carries it back) or
    -- Cancel (everything goes back to the seller).
    accompanying_lovelace BIGINT NOT NULL CHECK (accompanying_lovelace >= 0),

    -- Listed NFT (the asset the seller is selling). 28-byte policy
    -- prefix + 0..32 byte asset_name. Same encoding the FE uses
    -- elsewhere. Length range 28 (empty asset_name) .. 60.
    listed_nft_unit BYTEA NOT NULL
        CHECK (octet_length(listed_nft_unit) BETWEEN 28 AND 60),

    -- Total lovelace locked in this UTxO at creation time (>=
    -- accompanying_lovelace because the seller has to cover both the
    -- bond AND any min-utxo on top).
    lovelace BIGINT NOT NULL CHECK (lovelace >= 0),

    created_at_slot BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,

    -- Terminal spend fields. NULL while the listing is active.
    -- spent_action is one of: sold | cancelled | spent_unknown.
    -- 'spent_unknown' covers the (unlikely) case where the indexer sees
    -- the input consumed but can't pull a Buy/Cancel redeemer from the
    -- witness set — only happens on degenerate / partially-indexed txs.
    spent_at_slot BIGINT,
    spent_at TIMESTAMPTZ,
    spent_by_tx_hash BYTEA CHECK (spent_by_tx_hash IS NULL OR octet_length(spent_by_tx_hash) = 32),
    spent_action VARCHAR(16),

    -- Payment-key hash of the wallet that bought this listing. Stamped
    -- when a Buy spends the listing UTxO; null on active rows, on
    -- cancelled rows (the buyer doesn't exist), and on spent_unknown.
    buyer_pkh BYTEA CHECK (buyer_pkh IS NULL OR octet_length(buyer_pkh) = 28),

    PRIMARY KEY (tx_hash, output_index)
);

-- Hot path: "what's active right now?" — drives the browse page if we
-- ever surface this on the BE.
CREATE INDEX marketplace_events_active_recent
    ON marketplace_events (created_at_slot DESC)
    WHERE spent_action IS NULL;

-- /me/listings: seller-side active filter.
CREATE INDEX marketplace_events_seller_active
    ON marketplace_events (seller_pkh)
    WHERE spent_action IS NULL;

-- /me/history: every event the wallet was on either side of, ordered by
-- last-touched slot. Powers GET /api/market/listings/by-pkh/{pkh}.
CREATE INDEX marketplace_events_seller_recent
    ON marketplace_events (seller_pkh, created_at_slot DESC);
CREATE INDEX marketplace_events_buyer_recent
    ON marketplace_events (buyer_pkh, spent_at_slot DESC)
    WHERE buyer_pkh IS NOT NULL;
