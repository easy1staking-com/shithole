-- V1_0_9 — backfill traits_json for rows whose nested container is a
-- CIP-25 v1 *array* of single-key dicts (e.g. [{Background: "Cyan"}, ...]).
-- V1_0_7/8 only handled the flat-object dialect; HOSKY CashGrab (and any
-- collection following the CIP-25 v1 recommended shape) stored its traits
-- as a list under "-----Traits-----" / "traits" / "Traits" / "properties"
-- / "Properties", leaving traits_json NULL after both prior passes.
--
-- The existing traits_json contract is itself an array of single-key dicts,
-- so the backfill is a one-line projection: take the array as-is from the
-- raw onchain metadata, cast to TEXT.

-- HOSKY CashGrab key.
UPDATE nft_metadata
SET traits_json = ((raw_onchain_metadata::jsonb) -> '-----Traits-----')::TEXT
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? '-----Traits-----'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> '-----Traits-----') = 'array';

-- Lowercase "traits" array.
UPDATE nft_metadata
SET traits_json = ((raw_onchain_metadata::jsonb) -> 'traits')::TEXT
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'traits'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'traits') = 'array';

-- Capitalised "Traits" array.
UPDATE nft_metadata
SET traits_json = ((raw_onchain_metadata::jsonb) -> 'Traits')::TEXT
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'Traits'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'Traits') = 'array';

-- "properties" / "Properties" arrays.
UPDATE nft_metadata
SET traits_json = ((raw_onchain_metadata::jsonb) -> 'properties')::TEXT
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'properties'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'properties') = 'array';

UPDATE nft_metadata
SET traits_json = ((raw_onchain_metadata::jsonb) -> 'Properties')::TEXT
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'Properties'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'Properties') = 'array';
