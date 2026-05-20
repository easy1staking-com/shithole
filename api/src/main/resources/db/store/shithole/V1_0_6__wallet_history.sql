-- V1_0_6 — counterparty pkh columns + per-pkh indexes for /me/history.
--
-- We track who the OTHER side of a spend is so the FE can render
-- "you swapped Hosky #123" for the swapper just as it does for the
-- lister. Same for p2p fulfills: the fulfiller's pkh lets the bot
-- (or any human fulfiller) see their own activity in `/me/history`.
--
-- Both columns are nullable: indexer leaves them NULL on rows it
-- can't classify (ambiguous outputs, no clean counterparty, admin
-- Rescue, etc.). Existing rows in mainnet — written before V1_0_6 —
-- stay NULL until backfilled via cursor-reset + truncate (see plan).

ALTER TABLE listing_events
    ADD COLUMN swapper_pkh BYTEA
    CHECK (swapper_pkh IS NULL OR octet_length(swapper_pkh) = 28);

ALTER TABLE wanted_listing_events
    ADD COLUMN fulfiller_pkh BYTEA
    CHECK (fulfiller_pkh IS NULL OR octet_length(fulfiller_pkh) = 28);

-- Per-pkh indexes powering GET /api/listings/by-pkh/{pkh}.
-- Two single-column indexes — Postgres BitmapOr handles
-- `WHERE lister_pkh = X OR swapper_pkh = X` cleanly across them.
-- The existing `listing_events_active` (V1_0_1) covers the live-browse
-- path; this is for the full-history view.
CREATE INDEX listing_events_by_lister
    ON listing_events (lister_pkh, created_at_slot DESC);

CREATE INDEX listing_events_by_swapper
    ON listing_events (swapper_pkh, spent_at_slot DESC)
    WHERE swapper_pkh IS NOT NULL;

-- Same shape on the wanted side.
CREATE INDEX wanted_listing_events_by_buyer_all
    ON wanted_listing_events (buyer_pkh, created_at_slot DESC);

CREATE INDEX wanted_listing_events_by_fulfiller
    ON wanted_listing_events (fulfiller_pkh, spent_at_slot DESC)
    WHERE fulfiller_pkh IS NOT NULL;
