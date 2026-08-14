import { describe, expect, it } from "vitest";

import { LANDING_STRIP_LIMIT, topCollections } from "@/lib/market/topCollections";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

const P1 = "1".repeat(56);
const P2 = "2".repeat(56);
const P3 = "3".repeat(56);
const P4 = "4".repeat(56);
const P5 = "5".repeat(56);
const P6 = "6".repeat(56);
const P_ABSENT = "9".repeat(56);

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

  it("a pinned low-count collection floats to index 0, exactly once", () => {
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
    const result = topCollections(collections, listings, LANDING_STRIP_LIMIT, [
      P6,
    ]);
    expect(result.map((c) => c.label)).toEqual(["F", "A", "B", "C", "D"]);
    expect(result.filter((c) => c.label === "F")).toHaveLength(1);
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
});
