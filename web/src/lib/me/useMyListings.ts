"use client";

import { useQueries, useQuery } from "@tanstack/react-query";

import { fetchCurated, fetchListings } from "@/lib/api/client";
import type { CuratedCollection, Listing } from "@/types/api";

/**
 * One row on the {@code /me} page: a listing owned by the connected
 * wallet, paired with the collection it belongs to (for theming + nav).
 */
export type MyListingRow = {
  collection: CuratedCollection;
  listing: Listing;
};

/**
 * Aggregate every listing in every curated collection whose
 * {@code lister_pkh} matches {@code pkhLower}. Reads the curated list
 * once + one listings page per collection (default 100). For v1 this
 * covers all realistic cases — if N grows past 100 per collection,
 * we'll add a dedicated BE endpoint.
 *
 * <p>Filtered client-side: BE doesn't expose a "by lister" query yet
 * and the BE is frozen for the moment. Per-collection listings are
 * fetched in parallel via {@code useQueries} so the page renders as
 * soon as the slowest collection lands.
 */
export function useMyListings(
  pkhLower: string | null,
  pageSize: number = 100,
) {
  const curated = useQuery<CuratedCollection[], Error>({
    queryKey: ["curated"],
    queryFn: fetchCurated,
    staleTime: 60_000,
  });

  const collections = curated.data ?? [];

  const listingQueries = useQueries({
    queries: collections.map((c) => ({
      queryKey: ["listings", c.slug, 0, pageSize, null],
      queryFn: () => fetchListings(c.slug, { page: 0, size: pageSize }),
      enabled: collections.length > 0,
      staleTime: 30_000,
    })),
  });

  const isLoading =
    curated.isLoading ||
    listingQueries.some((q) => q.isLoading || q.isFetching);
  const error =
    curated.error ?? listingQueries.find((q) => q.error)?.error ?? null;

  const rows: MyListingRow[] = [];
  // True if any collection has more listings than the page we fetched
  // — we'd be missing rows past the cap. v1 caveat surfaced in the UI.
  let anyCapped = false;
  if (pkhLower) {
    const lp = pkhLower.toLowerCase();
    for (let i = 0; i < collections.length; i++) {
      const c = collections[i];
      const q = listingQueries[i];
      if (!q?.data) continue;
      if (q.data.total > q.data.data.length) anyCapped = true;
      for (const l of q.data.data) {
        if (l.lister_pkh.toLowerCase() === lp) {
          rows.push({ collection: c, listing: l });
        }
      }
    }
  }
  // Stable order: most accrued first, ties by created_at desc.
  rows.sort((a, b) => {
    const da = a.listing.accrued_lovelace - b.listing.accrued_lovelace;
    if (da !== 0) return -da;
    return b.listing.created_at.localeCompare(a.listing.created_at);
  });

  return {
    rows,
    collections,
    isLoading,
    error,
    anyCapped,
  };
}
