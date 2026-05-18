/**
 * React Query hooks over the typed API client. Keep cache keys
 * structural so we can invalidate per-collection cleanly when the
 * wallet starts mutating state in later phases.
 */

import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchCollection,
  fetchCurated,
  fetchListings,
  fetchNftMetadata,
  fetchPoolByRoot,
  fetchPoolByTicker,
  fetchPools,
  fetchProof,
  type ListingsQuery,
} from "./client";
import type {
  CollectionState,
  CuratedCollection,
  ListingsResponse,
  NftMetadata,
  Pool,
  Proof,
} from "@/types/api";

export const queryKeys = {
  curated: () => ["curated"] as const,
  collection: (slug: string) => ["collection", slug] as const,
  listings: (slug: string, query: ListingsQuery) =>
    ["listings", slug, query.page ?? 0, query.size ?? 20, query.bucket ?? null] as const,
  nft: (unit: string) => ["nft", unit] as const,
  pools: () => ["pools"] as const,
  poolByTicker: (ticker: string) => ["pool", "ticker", ticker] as const,
  poolByRoot: (root: string) => ["pool", "root", root] as const,
  proof: (root: string, assetName: string) =>
    ["proof", root, assetName] as const,
};

type QueryOptions<TData> = Omit<UseQueryOptions<TData, Error, TData>, "queryKey" | "queryFn">;

export function useCurated(
  options?: QueryOptions<CuratedCollection[]>,
): UseQueryResult<CuratedCollection[], Error> {
  return useQuery({
    queryKey: queryKeys.curated(),
    queryFn: fetchCurated,
    ...options,
  });
}

export function useCollection(
  slug: string,
  options?: QueryOptions<CollectionState>,
): UseQueryResult<CollectionState, Error> {
  return useQuery({
    queryKey: queryKeys.collection(slug),
    queryFn: () => fetchCollection(slug),
    enabled: Boolean(slug),
    ...options,
  });
}

export function useListings(
  slug: string,
  query: ListingsQuery = {},
  options?: QueryOptions<ListingsResponse>,
): UseQueryResult<ListingsResponse, Error> {
  return useQuery({
    queryKey: queryKeys.listings(slug, query),
    queryFn: () => fetchListings(slug, query),
    enabled: Boolean(slug),
    ...options,
  });
}

export function useNftMetadata(
  unit: string,
  options?: QueryOptions<NftMetadata>,
): UseQueryResult<NftMetadata, Error> {
  return useQuery({
    queryKey: queryKeys.nft(unit),
    queryFn: () => fetchNftMetadata(unit),
    enabled: Boolean(unit),
    ...options,
  });
}

/* ---------- v3 wanted-listing — pool-merkle hooks --------------------- */

/**
 * List currently-active curated pools. Returns [] when no curation has
 * been published yet — UI should render an "empty" state rather than
 * a spinner or error.
 */
export function usePools(
  options?: QueryOptions<Pool[]>,
): UseQueryResult<Pool[], Error> {
  return useQuery({
    queryKey: queryKeys.pools(),
    queryFn: fetchPools,
    ...options,
  });
}

/**
 * Single active pool by ticker. {@code data} is {@code null} when the
 * ticker has no active row (e.g. user navigated to a URL with a
 * superseded ticker) — distinguished from "still loading" via
 * {@code isPending}.
 */
export function usePoolByTicker(
  ticker: string,
  options?: QueryOptions<Pool | null>,
): UseQueryResult<Pool | null, Error> {
  return useQuery({
    queryKey: queryKeys.poolByTicker(ticker),
    queryFn: () => fetchPoolByTicker(ticker),
    enabled: Boolean(ticker),
    ...options,
  });
}

/**
 * Reverse lookup: which pool produced this merkle root? Works for
 * historical roots, used to label a wanted listing whose datum carries
 * a now-superseded root.
 */
export function usePoolByRoot(
  merkleRootHex: string,
  options?: QueryOptions<Pool | null>,
): UseQueryResult<Pool | null, Error> {
  return useQuery({
    queryKey: queryKeys.poolByRoot(merkleRootHex),
    queryFn: () => fetchPoolByRoot(merkleRootHex),
    enabled: Boolean(merkleRootHex),
    ...options,
  });
}

/**
 * Membership proof for a seller's deposit NFT against a specific listing's
 * root. {@code data} is {@code null} when the asset_name isn't in the tree
 * — UI should treat that as "this NFT doesn't qualify" rather than an error.
 */
export function useProof(
  merkleRootHex: string,
  assetNameHex: string,
  options?: QueryOptions<Proof | null>,
): UseQueryResult<Proof | null, Error> {
  return useQuery({
    queryKey: queryKeys.proof(merkleRootHex, assetNameHex),
    queryFn: () => fetchProof(merkleRootHex, assetNameHex),
    enabled: Boolean(merkleRootHex) && Boolean(assetNameHex),
    ...options,
  });
}
