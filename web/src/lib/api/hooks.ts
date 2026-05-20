/**
 * React Query hooks over the typed API client. Keep cache keys
 * structural so we can invalidate per-collection cleanly when the
 * wallet starts mutating state in later phases.
 */

import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchAssetPoolMembership,
  fetchCollection,
  fetchCurated,
  fetchListings,
  fetchListingsByPkh,
  fetchNftMetadata,
  fetchP2pListings,
  fetchP2pListingsByBuyer,
  fetchP2pListingsByPkh,
  fetchPoolByRoot,
  fetchPoolByTicker,
  fetchPools,
  fetchProof,
  type ByPkhQuery,
  type ListingsQuery,
  type P2pListingsByBuyerQuery,
  type P2pListingsQuery,
} from "./client";
import type {
  AssetPoolMembership,
  CollectionState,
  CuratedCollection,
  ListingEvent,
  ListingsResponse,
  NftMetadata,
  P2pListing,
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
  /**
   * Cache key is a sorted+joined fingerprint of the asset_names list so two
   * components looking up the same set of NFTs share a single fetch.
   */
  assetPoolMembership: (assetNamesHex: string[]) =>
    [
      "assetPoolMembership",
      [...assetNamesHex].map((h) => h.toLowerCase()).sort().join(","),
    ] as const,
  p2pListings: (query: P2pListingsQuery) =>
    [
      "p2pListings",
      query.config ?? null,
      [...(query.roots ?? [])].sort().join(",") || null,
      query.page ?? 0,
      query.size ?? 50,
    ] as const,
  p2pListingsByBuyer: (buyerPkhHex: string, query: P2pListingsByBuyerQuery) =>
    [
      "p2pListingsByBuyer",
      buyerPkhHex.toLowerCase(),
      query.includeSpent ?? false,
      query.page ?? 0,
      query.size ?? 50,
    ] as const,
  listingsByPkh: (pkhHex: string, query: ByPkhQuery) =>
    [
      "listingsByPkh",
      pkhHex.toLowerCase(),
      query.page ?? 0,
      query.size ?? 100,
    ] as const,
  p2pListingsByPkh: (pkhHex: string, query: ByPkhQuery) =>
    [
      "p2pListingsByPkh",
      pkhHex.toLowerCase(),
      query.page ?? 0,
      query.size ?? 100,
    ] as const,
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
 * Batch lookup of pool tickers per asset_name. Driven by the wallet's
 * current NFT holdings for a collection; refetched on window focus is
 * disabled because pool membership only changes when the BE re-seeds
 * (rare).
 */
export function useAssetPoolMembership(
  assetNamesHex: string[],
  options?: QueryOptions<AssetPoolMembership>,
): UseQueryResult<AssetPoolMembership, Error> {
  return useQuery({
    queryKey: queryKeys.assetPoolMembership(assetNamesHex),
    queryFn: () => fetchAssetPoolMembership(assetNamesHex),
    enabled: assetNamesHex.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 min; the BE seeder only re-runs at boot
    ...options,
  });
}

/**
 * Active wanted-listings, optionally filtered. Drives /p2p browse.
 * Short stale time (10s) — listings come and go as buyers create + sellers
 * fulfill. Refetch on focus is fine here.
 */
export function useP2pListings(
  query: P2pListingsQuery = {},
  options?: QueryOptions<P2pListing[]>,
): UseQueryResult<P2pListing[], Error> {
  return useQuery({
    queryKey: queryKeys.p2pListings(query),
    queryFn: () => fetchP2pListings(query),
    staleTime: 10_000,
    ...options,
  });
}

/**
 * Listings created by a specific buyer pkh. Drives /me/p2p.
 */
export function useP2pListingsByBuyer(
  buyerPkhHex: string | null,
  query: P2pListingsByBuyerQuery = {},
  options?: QueryOptions<P2pListing[]>,
): UseQueryResult<P2pListing[], Error> {
  return useQuery({
    queryKey: queryKeys.p2pListingsByBuyer(buyerPkhHex ?? "", query),
    queryFn: () => fetchP2pListingsByBuyer(buyerPkhHex!, query),
    enabled: Boolean(buyerPkhHex),
    staleTime: 10_000,
    ...options,
  });
}

/**
 * Pit listing-events a wallet participated in — as lister OR swapper.
 * Drives the pit side of /me/history.
 */
export function useListingsByPkh(
  pkhHex: string | null,
  query: ByPkhQuery = {},
  options?: QueryOptions<ListingEvent[]>,
): UseQueryResult<ListingEvent[], Error> {
  return useQuery({
    queryKey: queryKeys.listingsByPkh(pkhHex ?? "", query),
    queryFn: () => fetchListingsByPkh(pkhHex!, query),
    enabled: Boolean(pkhHex),
    staleTime: 15_000,
    ...options,
  });
}

/**
 * P2p listings a wallet participated in — as buyer OR fulfiller.
 * Drives the p2p side of /me/history.
 */
export function useP2pListingsByPkh(
  pkhHex: string | null,
  query: ByPkhQuery = {},
  options?: QueryOptions<P2pListing[]>,
): UseQueryResult<P2pListing[], Error> {
  return useQuery({
    queryKey: queryKeys.p2pListingsByPkh(pkhHex ?? "", query),
    queryFn: () => fetchP2pListingsByPkh(pkhHex!, query),
    enabled: Boolean(pkhHex),
    staleTime: 15_000,
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
