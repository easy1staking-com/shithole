-- V1_0_7 — backfill traits_json for rows the original extractor missed.
--
-- The dev branch's original NftMetadataService.extractTraits only
-- handled flat top-level CIP-25 fields. The preprod HOSKY mimic + many
-- mainnet collections nest their traits under a key like "traits",
-- "Traits", "-----Traits-----" (HOSKY mainnet's literal key),
-- "properties", or "Properties" — either as a flat object or as a
-- CIP-25 v1 array of single-key dicts. OpenSea-style "attributes"
-- arrays of {trait_type, value} too.
--
-- raw_onchain_metadata is already cached, so the backfill doesn't have
-- to re-hit Blockfrost. SQL via Postgres jsonb operators handles both
-- object and array shapes per key.

-- Pass 1: nested-object dialect under each known key.
DO $$
DECLARE
  k TEXT;
BEGIN
  FOR k IN SELECT unnest(ARRAY['-----Traits-----','traits','Traits','properties','Properties'])
  LOOP
    EXECUTE format($f$
      UPDATE nft_metadata
      SET traits_json = (
        SELECT jsonb_agg(jsonb_build_object(key, value))::TEXT
        FROM jsonb_each_text((raw_onchain_metadata::jsonb) -> %L)
      )
      WHERE traits_json IS NULL
        AND raw_onchain_metadata IS NOT NULL
        AND (raw_onchain_metadata::jsonb) ? %L
        AND jsonb_typeof((raw_onchain_metadata::jsonb) -> %L) = 'object'
    $f$, k, k, k);
  END LOOP;
END $$;

-- Pass 2: CIP-25 v1 array of single-key dicts.
DO $$
DECLARE
  k TEXT;
BEGIN
  FOR k IN SELECT unnest(ARRAY['-----Traits-----','traits','Traits','properties','Properties'])
  LOOP
    EXECUTE format($f$
      UPDATE nft_metadata
      SET traits_json = ((raw_onchain_metadata::jsonb) -> %L)::TEXT
      WHERE traits_json IS NULL
        AND raw_onchain_metadata IS NOT NULL
        AND (raw_onchain_metadata::jsonb) ? %L
        AND jsonb_typeof((raw_onchain_metadata::jsonb) -> %L) = 'array'
    $f$, k, k, k);
  END LOOP;
END $$;

-- Pass 3: OpenSea-style "attributes" array.
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
