import { describe, expect, it } from "vitest";

import { LANDING_STRIP_LIMIT, topCollections } from "@/lib/market/topCollections";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

// Real hex containing letters (not digit-only) so `.toUpperCase()` on these
// actually changes the string — required for the case-insensitivity
// assertions below to exercise anything.
const P1 = "1a".repeat(28);
const P2 = "2b".repeat(28);
const P3 = "3c".repeat(28);
const P4 = "4d".repeat(28);
const P5 = "5e".repeat(28);
const P6 = "6f".repeat(28);
const P_ABSENT = "9d".repeat(28);

function listing(unit: string): DecodedListing {
  return { listedUnits: [unit] } as unknown as DecodedListing;
}

function collection(policyId: string, label: string): SupportedCollection {
  return { label, policyId };
}

/** N listings for `policyId`, each with a distinct asset-name suffix. */
function listingsFor(policyId: string, count: number): DecodedListing[] {
  return Array.from({ length: count }, (_, i) =>
    listing(policyId + i.toString(16).padStart(2, "0")),
  );
}

describe("topCollections", () => {
  it("N=1: returns the single collection", () => {
    const collections = [collection(P1, "A")];
    expect(topCollections(collections, null)).toEqual(collections);
  });

  it("N=4 lopsided counts: all four pass through in whitelist order", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
    ];
    const listings = [
      ...listingsFor(P4, 50),
      ...listingsFor(P1, 1),
    ];
    expect(topCollections(collections, listings)).toEqual(collections);
  });

  it("N=5 boundary (N === limit): passes through in whitelist order, not count order", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
    ];
    // All listings sit on the last collection — if the passthrough branch
    // didn't fire at N === limit, this would sort E to the front.
    const listings = listingsFor(P5, 50);
    expect(topCollections(collections, listings)).toEqual(collections);
  });

  it("N=6: ranks the top 5 by live count descending", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    // counts: A=1 B=5 C=3 D=0 E=4 F=2
    const listings = [
      ...listingsFor(P1, 1),
      ...listingsFor(P2, 5),
      ...listingsFor(P3, 3),
      ...listingsFor(P5, 4),
      ...listingsFor(P6, 2),
    ];
    const result = topCollections(collections, listings);
    expect(result.map((c) => c.label)).toEqual(["B", "E", "C", "F", "A"]);
    expect(result).toHaveLength(LANDING_STRIP_LIMIT);
  });

  it("N=6 with a tie: tied collections keep whitelist order (stability)", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    // counts: A=2 B=2 C=1 D=1 E=0 F=3
    const listings = [
      ...listingsFor(P1, 2),
      ...listingsFor(P2, 2),
      ...listingsFor(P3, 1),
      ...listingsFor(P4, 1),
      ...listingsFor(P6, 3),
    ];
    const result = topCollections(collections, listings);
    // F(3), then tie A/B(2) in whitelist order, then tie C/D(1) in whitelist
    // order; E(0) drops off the top-5 cut.
    expect(result.map((c) => c.label)).toEqual(["F", "A", "B", "C", "D"]);
  });

  it("N=6 with listings === null: first 5 in whitelist order", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    const result = topCollections(collections, null);
    expect(result.map((c) => c.label)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("a pinned collection with a repeated, case-varied id floats to index 0 exactly once", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    // counts: A=5 B=4 C=3 D=2 E=1 F=0 (whitelist order already matches
    // count-desc order, so any reordering below is attributable to the pin)
    const listings = [
      ...listingsFor(P1, 5),
      ...listingsFor(P2, 4),
      ...listingsFor(P3, 3),
      ...listingsFor(P4, 2),
      ...listingsFor(P5, 1),
    ];
    // The SAME collection pinned three times (twice verbatim, once
    // upper-cased) — de-dup must collapse this to a single entry.
    const result = topCollections(collections, listings, LANDING_STRIP_LIMIT, [
      P6,
      P6,
      P6.toUpperCase(),
    ]);
    expect(result.map((c) => c.label)).toEqual(["F", "A", "B", "C", "D"]);
    expect(result.filter((c) => c.label === "F")).toHaveLength(1);
  });

  it("pinning the TOP-count collection still excludes it from rest — no duplicate inside the limit", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    // counts: A=99 B=4 C=3 D=2 E=1 F=0 — A is both pinned AND the highest
    // count, so a duplicate would land INSIDE the limit if the exclusion
    // filter didn't remove the pinned collection from `rest`.
    const listings = [
      ...listingsFor(P1, 99),
      ...listingsFor(P2, 4),
      ...listingsFor(P3, 3),
      ...listingsFor(P4, 2),
      ...listingsFor(P5, 1),
    ];
    const result = topCollections(collections, listings, LANDING_STRIP_LIMIT, [
      P1,
    ]);
    const labels = result.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("a pinned id absent from collections is ignored (no undefined in output)", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    const listings = [
      ...listingsFor(P1, 5),
      ...listingsFor(P2, 4),
      ...listingsFor(P3, 3),
      ...listingsFor(P4, 2),
      ...listingsFor(P5, 1),
    ];
    const result = topCollections(collections, listings, LANDING_STRIP_LIMIT, [
      P_ABSENT,
    ]);
    expect(result.every((c) => c !== undefined)).toBe(true);
    expect(result.map((c) => c.label)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("pin matching is case-insensitive", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    const listings = [
      ...listingsFor(P1, 5),
      ...listingsFor(P2, 4),
      ...listingsFor(P3, 3),
      ...listingsFor(P4, 2),
      ...listingsFor(P5, 1),
    ];
    const result = topCollections(collections, listings, LANDING_STRIP_LIMIT, [
      P6.toUpperCase(),
    ]);
    expect(result.map((c) => c.label)).toEqual(["F", "A", "B", "C", "D"]);
  });

  it("count lookup is case-insensitive: an upper-cased policy id still outranks a non-zero rival", () => {
    const upperF = P6.toUpperCase();
    const collections = [
      // Rival sits earlier in the whitelist AND has a non-zero count, so a
      // stable sort with everything collapsed to 0 would (wrongly) keep
      // Rival ahead of the upper-cased collection — only a correct,
      // lower-cased count lookup floats the latter above it.
      collection(P1, "Rival"),
      collection(P2, "X2"),
      collection(P3, "X3"),
      collection(P4, "X4"),
      collection(P5, "X5"),
      collection(upperF, "Upper"),
    ];
    // counts: Rival=1, X2=X3=X4=X5=0, Upper=10 (listings generated against
    // the upper-cased policy id, exactly like `Upper.policyId` itself).
    const listings = [
      ...listingsFor(P1, 1),
      ...listingsFor(upperF, 10),
    ];
    const result = topCollections(collections, listings);
    expect(result.map((c) => c.label)).toEqual([
      "Upper",
      "Rival",
      "X2",
      "X3",
      "X4",
    ]);
  });

  it("does not mutate the input collections array", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
      collection(P5, "E"),
      collection(P6, "F"),
    ];
    const before = collections.map((c) => c.label);
    const listings = [
      ...listingsFor(P1, 1),
      ...listingsFor(P2, 5),
      ...listingsFor(P3, 3),
    ];
    topCollections(collections, listings);
    expect(collections.map((c) => c.label)).toEqual(before);
  });

  it("limit = 0 returns an empty array", () => {
    const collections = [collection(P1, "A"), collection(P2, "B")];
    expect(topCollections(collections, null, 0)).toEqual([]);
  });

  it("N<=limit passthrough returns a fresh array, not the input reference", () => {
    const collections = [
      collection(P1, "A"),
      collection(P2, "B"),
      collection(P3, "C"),
      collection(P4, "D"),
    ];
    const result = topCollections(collections, null, 5);
    expect(result).toEqual(collections);
    expect(result).not.toBe(collections);
  });
});
