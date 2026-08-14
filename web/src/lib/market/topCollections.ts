/**
 * Pure ranking helper for the landing's collection strips — kept
 * React-free so it's directly vitest-able (the harness only mounts
 * `.test.ts`, not `.tsx`).
 */

import { countByPolicy } from "@/lib/market/collectionPalette";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

/** Max number of collection strips the landing renders. */
export const LANDING_STRIP_LIMIT = 5;

/**
 * Picks the top `limit` collections to show as landing strips.
 *
 * <p>When the whitelist already fits within `limit`, every collection is
 * returned in whitelist order — counts and pins never come into play, so
 * N<=limit stays byte-identical to rendering the raw whitelist (the
 * `[...collections]` spread below keeps that return a fresh array, not
 * an alias of the input). Otherwise collections are ranked by live
 * listing count (from {@link countByPolicy}, descending), with
 * `pinnedPolicyIds` floated to the front first (matched
 * case-insensitively, unmatched ids skipped, duplicates collapsed).
 * Ties keep whitelist order (stable sort on the array `.filter()`
 * already returns a fresh copy of, so neither branch mutates the input).
 *
 * <p>`pinnedPolicyIds` has no caller in this slice — it exists so a pin
 * list can be layered on later without changing this function's shape.
 * Not dead code, just not wired up yet.
 */
export function topCollections(
  collections: SupportedCollection[],
  listings: DecodedListing[] | null,
  limit: number = LANDING_STRIP_LIMIT,
  pinnedPolicyIds: readonly string[] = [],
): SupportedCollection[] {
  if (limit <= 0) return [];
  if (collections.length <= limit) return [...collections];

  const counts = countByPolicy(listings);
  const countOf = (c: SupportedCollection) =>
    counts.get(c.policyId.toLowerCase()) ?? 0;

  const pinned: SupportedCollection[] = [];
  const pinnedIds = new Set<string>();
  for (const id of pinnedPolicyIds) {
    const match = collections.find(
      (c) => c.policyId.toLowerCase() === id.toLowerCase(),
    );
    if (match && !pinnedIds.has(match.policyId.toLowerCase())) {
      pinned.push(match);
      pinnedIds.add(match.policyId.toLowerCase());
    }
  }

  const rest = collections
    .filter((c) => !pinnedIds.has(c.policyId.toLowerCase()))
    .sort((a, b) => countOf(b) - countOf(a));

  return [...pinned, ...rest].slice(0, limit);
}
