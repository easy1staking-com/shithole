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
} from "@/types/api";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  public readonly status: number;
  public readonly url: string;

  constructor(status: number, url: string, message?: string) {
    super(message ?? `API error ${status} at ${url}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
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
    throw new ApiError(resp.status, url);
  }
  return (await resp.json()) as T;
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
