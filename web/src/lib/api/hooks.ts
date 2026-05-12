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
  type ListingsQuery,
} from "./client";
import type {
  CollectionState,
  CuratedCollection,
  ListingsResponse,
  NftMetadata,
} from "@/types/api";

export const queryKeys = {
  curated: () => ["curated"] as const,
  collection: (slug: string) => ["collection", slug] as const,
  listings: (slug: string, query: ListingsQuery) =>
    ["listings", slug, query.page ?? 0, query.size ?? 20, query.bucket ?? null] as const,
  nft: (unit: string) => ["nft", unit] as const,
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
