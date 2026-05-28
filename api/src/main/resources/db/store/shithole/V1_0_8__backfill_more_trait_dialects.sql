-- V1_0_8 — second pass at the trait-extraction backfill.
--
-- V1_0_7 only knew about the literal "traits" key. HOSKY CashGrab (and
-- presumably other collections) nest their traits under ornate variants:
-- "-----Traits-----" (5 dashes, "Traits", 5 dashes), "Traits", or
-- "Properties". Walk the remaining rows where traits_json is still NULL
-- and try each known key in turn.
--
-- See .local/backfill-hosky-traits.py for the same fallback chain on the
-- Python aggregator side.

-- HOSKY CashGrab dialect: literal "-----Traits-----" nested object.
UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
    FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> '-----Traits-----')
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? '-----Traits-----'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> '-----Traits-----') = 'object';

-- Capitalised "Traits".
UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
    FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> 'Traits')
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'Traits'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'Traits') = 'object';

-- "properties" / "Properties" containers (some CIP-25 collections).
UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
    FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> 'properties')
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'properties'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'properties') = 'object';

UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
    FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> 'Properties')
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'Properties'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'Properties') = 'object';
