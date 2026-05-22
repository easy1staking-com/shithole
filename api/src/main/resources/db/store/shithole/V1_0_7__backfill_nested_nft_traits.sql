-- V1_0_7 — backfill traits_json for rows the original extractor missed.
--
-- The original NftMetadataService.extractTraits only recognized flat
-- top-level trait fields (e.g. {name, image, Fur, Eyes, ...}). HOSKY
-- CashGrab and many other CIP-25 collections nest traits under a
-- top-level "traits" object; some others use the OpenSea "attributes"
-- array. For those, traits_json was stored NULL.
--
-- We already cache the full on-chain JSON in raw_onchain_metadata, so the
-- backfill doesn't need to re-hit Blockfrost.

-- Pass 1: nested "traits" object dialect (CIP-25 + most CNFT collections).
UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
    FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> 'traits')
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'traits'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'traits') = 'object';

-- Pass 2: OpenSea-style "attributes" array dialect.
UPDATE nft_metadata
SET traits_json = (
    SELECT jsonb_agg(jsonb_build_object(attr->>'trait_type', attr->>'value'))::TEXT
    FROM jsonb_array_elements((raw_onchain_metadata::jsonb) -> 'attributes') AS attr
    WHERE attr ? 'trait_type' AND attr ? 'value'
)
WHERE traits_json IS NULL
  AND raw_onchain_metadata IS NOT NULL
  AND (raw_onchain_metadata::jsonb) ? 'attributes'
  AND jsonb_typeof((raw_onchain_metadata::jsonb) -> 'attributes') = 'array';
