/**
 * Shithole BE API contract — typed mirrors of the JSON shapes served by
 * the backend (see docs/BACKEND.md and SPEC.md §10.2).
 *
 * These types ARE the integration contract between FE and BE. If the
 * backend changes a field, change it here and propagate via the typed
 * client / React Query hooks.
 */

/* ------------------------------------------------------------------ */
/* Common building blocks                                              */
/* ------------------------------------------------------------------ */

/** Cardano output reference: tx id + output index. Used as listing UTxO id. */
export type OutRef = {
  tx_id: string;
  output_index: number;
};

/** Per-collection visual theme served by the BE; mostly cosmetic. */
export type Theme = {
  background_url: string | null;
  accent_color: string;
  mascot_image_url: string | null;
};

/** Aiken credential — verification-key or script. */
export type Credential = {
  type: "verification_key" | "script";
  hash: string;
};

/** Aiken Address (base or enterprise). */
export type AddressView = {
  payment_credential: Credential;
  stake_credential: Credential | null;
};

/**
 * BE-facing render of the on-chain ConfigDatum (SPEC §3.1).
 * collection_policy_id lives on the collection envelope, not the datum,
 * because on-chain it is the config-NFT asset name.
 */
export type ConfigDatumView = {
  m: number;
  protocol_fee: number;
  lister_fee: number;
  treasury_addr: AddressView;
  admin_pkh: string;
};

/* ------------------------------------------------------------------ */
/* GET /api/curated                                                    */
/* ------------------------------------------------------------------ */

/**
 * One entry in the curated-collection list. Renders as a card / pit on
 * the home page. `display_order` is BE-controlled.
 */
export type CuratedCollection = {
  slug: string;
  config_nft_policy: string;
  collection_policy_id: string;
  display_name: string;
  theme: Theme;
  display_order: number;
};

/* ------------------------------------------------------------------ */
/* GET /api/collections/:slug                                          */
/* ------------------------------------------------------------------ */

export type CollectionStats = {
  n_valid_listings: number;
  total_accrued_lovelace: number;
  swap_count_24h: number;
};

export type MStaleness = {
  current_m: number;
  recommended_m: number;
  recommended_m_ratio: number;
};

/** Full per-collection envelope: identity + theme + on-chain config + stats. */
export type CollectionState = {
  slug: string;
  config_nft_policy: string;
  collection_policy_id: string;
  display_name: string;
  theme: Theme;
  config: ConfigDatumView;
  listing_script_address: string;
  stats: CollectionStats;
  m_staleness: MStaleness;
};

/* ------------------------------------------------------------------ */
/* GET /api/collections/:slug/listings                                 */
/* ------------------------------------------------------------------ */

/**
 * A well-formed listing UTxO as seen by the indexer's strict filter
 * (SPEC §10.2). Junk UTxOs at the listing address are excluded.
 */
export type Listing = {
  utxo_ref: OutRef;
  config_nft_policy: string;
  lister_pkh: string;
  current_nft_unit: string;
  /** Total lovelace in the UTxO (includes min-UTxO + accrued). */
  lovelace: number;
  /** Lovelace accrued from past swaps; subset of `lovelace`. */
  accrued_lovelace: number;
  /** Some(compute_output_tag(prior_outRef)) post-swap; null at initial creation. */
  update_ref: OutRef | null;
  created_at: string;
};

export type ListingsResponse = {
  total: number;
  page: number;
  size: number;
  data: Listing[];
};

/* ------------------------------------------------------------------ */
/* GET /api/nft/:unit                                                  */
/* ------------------------------------------------------------------ */

/**
 * A single trait entry from CIP-25 metadata. The shape is intentionally
 * loose because CIP-25 v1 lets minters use arbitrary string keys with
 * arbitrary scalar values. The BE passes traits through unchanged.
 */
export type NftTrait = Record<string, string | number | boolean | null | undefined>;

/**
 * NFT metadata as cached by the BE from Blockfrost /assets/{unit}.
 * `image_url` is the BE-served image endpoint (mocked locally during dev).
 */
export type NftMetadata = {
  unit: string;
  policy_id: string;
  asset_name_hex: string;
  asset_name: string;
  fingerprint: string;
  quantity: number;
  onchain_metadata_standard: string | null;
  name: string;
  image_ipfs_uri: string | null;
  image_url: string;
  traits: NftTrait[];
  description: string | null;
};
