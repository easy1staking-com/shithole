/**
 * Pure helpers for {@link ../../components/market/CollectionPalette} — kept
 * React-free so they're directly vitest-able (the harness only mounts
 * `.test.ts`, not `.tsx`).
 */

import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

/**
 * Groups listings by collection policy id, lowercased. Mirrors the
 * canonical per-collection count expression used by
 * {@code CollectionStrip.tsx} (`listedUnits[0]` sliced to the 28-byte
 * policy prefix). `null` listings (not yet resolved) yield an empty map
 * so callers can distinguish "zero" from "unknown" via the `listings`
 * prop itself.
 */
export function countByPolicy(
  listings: DecodedListing[] | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!listings) return counts;
  for (const l of listings) {
    const policy = (l.listedUnits[0] ?? "").slice(0, 56).toLowerCase();
    counts.set(policy, (counts.get(policy) ?? 0) + 1);
  }
  return counts;
}

/**
 * Case-insensitive substring filter over collection labels. An empty or
 * whitespace-only query returns the list unchanged (order preserved) —
 * the palette's default "show everything" state.
 */
export function filterByLabel(
  collections: SupportedCollection[],
  query: string,
): SupportedCollection[] {
  const q = query.trim().toLowerCase();
  if (!q) return collections;
  return collections.filter((c) => c.label.toLowerCase().includes(q));
}
