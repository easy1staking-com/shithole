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
 * A single trait entry on an NFT, optionally annotated with collection-wide
 * rarity. The BE's {@link com.easy1staking.shithole.service.RarityService}
 * fills in {@code count} + {@code pct} when it has a rarity table loaded for
 * the NFT's policy; otherwise both rarity fields are null and the FE renders
 * without a rarity chip.
 */
export type NftTrait = {
  category: string;
  value: string;
  count: number | null;
  pct: number | null;
};

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

/* ------------------------------------------------------------------ */
/* v3 wanted-listing — pool-merkle endpoints                           */
/* (BE: P2pController; SPEC §11 wanted-listings)                       */
/* ------------------------------------------------------------------ */

/**
 * Summary of one curated stake pool's currently-active merkle root. The
 * FE renders these in the pool picker on the wanted-listing creation flow.
 *
 * `ticker` is the stable label (HOSKY, A3C, ...) across re-curations.
 * `pool_id_hex` is the 28-byte bech32-decoded stake pool hash, or null
 * for community-tracked pools that haven't published one yet.
 * `merkle_root_hex` is the 32-byte sha2_256 root the buyer commits to
 * when creating a wanted listing (the on-chain `accepted_merkle_root`).
 */
export type Pool = {
  ticker: string;
  pool_id_hex: string | null;
  merkle_root_hex: string;
  total_assets: number;
  is_active: boolean;
};

/**
 * One step in a merkle membership proof. `side` is "left" or "right" — the
 * sibling's position relative to the running hash at this level. `hash_hex`
 * is the 32-byte sibling sha2_256 hash. Forwarded verbatim into a Fulfill
 * redeemer's `merkle_proof` field; the on-chain validator does the verify.
 *
 * Shape mirrors `aiken_merkle_tree/mt.ProofItem` and the matching
 * `org.cardanofoundation:merkle-tree-java` `ProofItem.Left|Right`.
 */
export type ProofStep = {
  side: "left" | "right";
  hash_hex: string;
};

/**
 * A complete membership proof — the chain of `ProofStep`s a seller submits
 * with a `Fulfill` redeemer to prove their deposit NFT's asset_name is in
 * the buyer's `accepted_merkle_root` set. An empty `proof` array is valid
 * for a 1-leaf tree (rare in practice — pool sets are large).
 */
export type Proof = {
  merkle_root_hex: string;
  asset_name_hex: string;
  proof: ProofStep[];
};

/**
 * Batch pool-membership response from
 * `POST /api/p2p/asset-pool-membership`. Maps each requested asset_name
 * (lowercase hex) to the list of currently-active pool tickers whose
 * merkle tree accepts it. Empty list means the NFT isn't in any pool —
 * those are the "trade away" candidates in the create flow.
 */
export type AssetPoolMembership = Record<string, string[]>;

/**
 * One v3 wanted-listing row as served by `GET /api/p2p/listings` and
 * `GET /api/p2p/listings/by-buyer/{buyer_pkh}`. All identifiers are
 * lowercase hex unless suffixed `_bech32`.
 *
 * <p>{@code spent_action} is null while the listing is active. A null
 * + no {@code spent_*} timestamps means the UTxO is still on-chain and
 * fulfillable. Any other value (currently always {@code spent_unknown})
 * means it was consumed.
 */
export type P2pListing = {
  tx_hash: string;
  output_index: number;
  config_nft_policy: string;
  buyer_pkh: string;
  buyer_address_bech32: string;
  accepted_merkle_root: string;
  /** policy_id (28 bytes) + asset_name (0..32 bytes), concatenated hex. */
  offered_nft_unit: string;
  lovelace: number;
  created_at_slot: number;
  created_at: string;
  spent_action?: string | null;
  spent_at_slot?: number | null;
  spent_at?: string | null;
  spent_by_tx_hash?: string | null;
  /** Payment-key hash of the wallet that fulfilled this listing (V1_0_6+). */
  fulfiller_pkh?: string | null;
};

/* ------------------------------------------------------------------ */
/* GET /api/listings/by-pkh/{pkh}                                      */
/* ------------------------------------------------------------------ */

/**
 * A full {@code listing_events} row — both active and historical — as
 * served by the wallet-history endpoint. Carries lineage info, lovelace,
 * and the spent_* terminal columns plus {@code swapper_pkh} (V1_0_6+)
 * so the FE can synthesise both a "listed" and a follow-up "swapped /
 * cancelled / recovered" event from a single row.
 *
 * <p>Distinct from {@link Listing} (live-only browse shape with
 * accrued_lovelace + update_ref) — this is the lineage row as-is.
 */
export type ListingEvent = {
  tx_hash: string;
  output_index: number;
  initial_tx_hash: string;
  initial_output_index: number;
  swap_index: number;
  config_nft_policy: string;
  lister_pkh: string;
  nft_unit: string;
  lovelace: number;
  created_at_slot: number;
  created_at: string;
  spent_at_slot?: number | null;
  spent_at?: string | null;
  spent_by_tx_hash?: string | null;
  /** 'swap' | 'cancel' | 'recover' | 'spent_unknown' when consumed; null = active. */
  spent_action?: string | null;
  /** Payment-key hash of the swapper (V1_0_6+); stamped on the predecessor on a swap. */
  swapper_pkh?: string | null;
};

/* ------------------------------------------------------------------ */
/* GET /api/market/listings/by-pkh/{pkh}                               */
/* ------------------------------------------------------------------ */

/**
 * A full {@code marketplace_events} row, as served by the marketplace
 * wallet-history endpoint. Carries the listing datum fields (seller,
 * price, bond) plus the terminal {@code spent_*} columns and
 * {@code buyer_pkh} so the FE can synthesise both a "listed" event at
 * created_at and a follow-up "sold" / "cancelled" event at spent_at.
 *
 * <p>Both {@code price_policy} and {@code price_name} are hex strings;
 * empty string for ADA-priced listings. {@code price_qty} is the raw
 * smallest-unit count as a string (BE serialises NUMERIC as a string so
 * BigInteger values survive transit without precision loss).
 */
export type MarketplaceListing = {
  tx_hash: string;
  output_index: number;
  seller_pkh: string;
  seller_address_bech32: string;
  price_policy: string;
  price_name: string;
  /** Smallest-unit count. BE serialises NUMERIC as a string for safety. */
  price_qty: string;
  accompanying_lovelace: number;
  /** policy_id (28) + asset_name (0..32 bytes), concatenated hex. */
  listed_nft_unit: string;
  lovelace: number;
  created_at_slot: number;
  created_at: string;
  spent_at_slot?: number | null;
  spent_at?: string | null;
  spent_by_tx_hash?: string | null;
  /** 'sold' | 'cancelled' | 'spent_unknown' when consumed; null = active. */
  spent_action?: string | null;
  /** Payment-key hash of the buyer on a sold row; null otherwise. */
  buyer_pkh?: string | null;
};

/* -------------------------------------------------------------------- */
/* GET /api/collections/:slugOrPolicy/activity + /stats                 */
/* -------------------------------------------------------------------- */

/** One row of the public per-collection marketplace activity feed. */
export type MarketActivityEvent = {
  event: "listed" | "sold" | "cancelled" | "spent";
  /** policy_id + asset_name, hex. */
  nft_unit: string;
  price: {
    /** Smallest-unit amount as a string (precision-safe). */
    native_qty: string;
    token_label: string;
    decimals: number;
  };
  /** Best-effort "≈ estimated" figures; absent when unpriceable. */
  ada_estimate?: number;
  usd_estimate?: number;
  /** pkh of the wallet on this event's side — buyer for sold, else seller. */
  wallet: string;
  ts: string;
};

/** Public per-collection marketplace stats. ADA/USD figures are estimates. */
export type MarketCollectionStats = {
  active_listings: number;
  sales_24h: number;
  unique_traders_24h: number;
  volume_24h_ada?: number;
  volume_24h_usd?: number;
  floor?: {
    native_qty: string;
    token_label: string;
    decimals: number;
    ada_estimate?: number;
    usd_estimate?: number;
  } | null;
};
