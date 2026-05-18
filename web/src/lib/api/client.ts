/**
 * Typed BE API client. Plain fetch wrapper.
 *
 * - Base URL via NEXT_PUBLIC_API_BASE_URL (default "" — same-origin so
 *   MSW can intercept in dev).
 * - All endpoints return JSON; image bytes are loaded via <img src>
 *   directly, not through this module.
 *
 * Endpoints mirror docs/BACKEND.md and SPEC.md §10.2.
 */

import type {
  CollectionState,
  CuratedCollection,
  ListingsResponse,
  NftMetadata,
  Pool,
  Proof,
} from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  public readonly status: number;
  public readonly url: string;
  /** BE error envelope, if the response decoded as JSON `{reason, message, ...}`. */
  public readonly body: { reason?: string; message?: string } | null;

  constructor(
    status: number,
    url: string,
    body: { reason?: string; message?: string } | null,
    message?: string,
  ) {
    super(message ?? `API error ${status} at ${url}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    ...init,
  });
  if (!resp.ok) {
    const body = await safeJsonBody(resp);
    throw new ApiError(resp.status, url, body);
  }
  return (await resp.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await safeJsonBody(resp);
    throw new ApiError(
      resp.status,
      url,
      errBody,
      errBody?.message ?? errBody?.reason,
    );
  }
  return (await resp.json()) as T;
}

async function safeJsonBody(
  resp: Response,
): Promise<{ reason?: string; message?: string } | null> {
  try {
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return null;
    return (await resp.json()) as { reason?: string; message?: string };
  } catch {
    return null;
  }
}

export function fetchCurated(): Promise<CuratedCollection[]> {
  return getJson<CuratedCollection[]>("/api/curated");
}

export function fetchCollection(slug: string): Promise<CollectionState> {
  return getJson<CollectionState>(`/api/collections/${encodeURIComponent(slug)}`);
}

export type ListingsQuery = {
  page?: number;
  size?: number;
  /** Optional bucket filter (SPEC §7) — BE may surface listings whose NA hashes to this bucket. */
  bucket?: number;
};

export function fetchListings(
  slug: string,
  { page = 0, size = 20, bucket }: ListingsQuery = {},
): Promise<ListingsResponse> {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("size", String(size));
  if (bucket !== undefined) qs.set("bucket", String(bucket));
  return getJson<ListingsResponse>(
    `/api/collections/${encodeURIComponent(slug)}/listings?${qs.toString()}`,
  );
}

export function fetchNftMetadata(unit: string): Promise<NftMetadata> {
  return getJson<NftMetadata>(`/api/nft/${encodeURIComponent(unit)}`);
}

/** Build the BE image URL for an NFT. Use directly in <img src>. */
export function nftImageUrl(unit: string, size: 64 | 256 | 1024 = 256): string {
  return `${BASE_URL}/api/nft/${encodeURIComponent(unit)}/image?size=${size}`;
}

/* ------------------------------------------------------------------ */
/* POST /api/configs                                                   */
/* ------------------------------------------------------------------ */

/**
 * Request body for `POST /api/configs` — mirrors
 * {@code com.easy1staking.shithole.model.ConfigRegistrationRequestDto}.
 * Snake-case keys per the BE wire format.
 */
export type ConfigRegistrationRequest = {
  config_nft_policy: string;
  slug: string;
  display_name: string;
  theme?: {
    background_url?: string | null;
    accent_color?: string | null;
    mascot_image_url?: string | null;
  } | null;
  display_order?: number;
  signature: {
    key: string;
    signature: string;
  };
};

export type ConfigRegistrationResponse = {
  config_nft_policy: string;
  slug: string;
  collection_policy_id: string;
  m: number;
  protocol_fee: number;
  lister_fee: number;
  admin_pkh: string;
  treasury_addr_bech32: string;
  utxo_tx_id: string;
  utxo_output_index: number;
  display_name: string;
  theme: {
    background_url: string | null;
    accent_color: string | null;
    mascot_image_url: string | null;
  } | null;
};

export function registerConfig(
  body: ConfigRegistrationRequest,
): Promise<ConfigRegistrationResponse> {
  return postJson<ConfigRegistrationResponse>("/api/configs", body);
}

/* ------------------------------------------------------------------ */
/* v3 wanted-listing — pool-merkle endpoints                           */
/* ------------------------------------------------------------------ */

/** List currently-active curated pools. Empty array is valid (pre-curation). */
export function fetchPools(): Promise<Pool[]> {
  return getJson<Pool[]>("/api/p2p/pools");
}

/** Single active pool by ticker, or null on 404. */
export async function fetchPoolByTicker(ticker: string): Promise<Pool | null> {
  try {
    return await getJson<Pool>(`/api/p2p/pools/${encodeURIComponent(ticker)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Reverse lookup: which pool produced this merkle root? Works for
 * historical (no-longer-active) roots too — used to label a wanted listing
 * whose datum carries a now-superseded root. Returns null on 404.
 */
export async function fetchPoolByRoot(merkleRootHex: string): Promise<Pool | null> {
  try {
    return await getJson<Pool>(
      `/api/p2p/pools/by-root/${encodeURIComponent(merkleRootHex)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Membership proof for `assetNameHex` against `merkleRootHex`. Returns null
 * if the root is unknown or the asset_name is not a leaf of that tree —
 * callers should treat both as "this seller can't fulfill against this
 * listing" rather than a hard error.
 */
export async function fetchProof(
  merkleRootHex: string,
  assetNameHex: string,
): Promise<Proof | null> {
  try {
    return await getJson<Proof>(
      `/api/p2p/pools/${encodeURIComponent(merkleRootHex)}/proofs/${encodeURIComponent(assetNameHex)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
