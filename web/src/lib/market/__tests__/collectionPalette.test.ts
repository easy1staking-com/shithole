import { describe, expect, it } from "vitest";

import { countByPolicy, filterByLabel } from "@/lib/market/collectionPalette";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

const POLICY_A = "a".repeat(56);
const POLICY_B = "b".repeat(56);

function listing(unit: string): DecodedListing {
  return { listedUnits: [unit] } as unknown as DecodedListing;
}

describe("countByPolicy", () => {
  it("returns an empty map when listings is null", () => {
    expect(countByPolicy(null)).toEqual(new Map());
  });

  it("tallies mixed-policy listings by their 28-byte policy prefix", () => {
    const listings = [
      listing(POLICY_A + "61"),
      listing(POLICY_A + "62"),
      listing(POLICY_B + "63"),
    ];
    const counts = countByPolicy(listings);
    expect(counts.get(POLICY_A)).toBe(2);
    expect(counts.get(POLICY_B)).toBe(1);
  });

  it("groups case-insensitively (uppercase policy folds into the same key)", () => {
    const listings = [
      listing(POLICY_A + "61"),
      listing(POLICY_A.toUpperCase() + "62"),
    ];
    const counts = countByPolicy(listings);
    expect(counts.get(POLICY_A)).toBe(2);
    expect(counts.size).toBe(1);
  });

  it("buckets listings with no units under the empty-string key", () => {
    const listings = [{ listedUnits: [] } as unknown as DecodedListing];
    const counts = countByPolicy(listings);
    expect(counts.get("")).toBe(1);
  });
});

function collection(over: Partial<SupportedCollection>): SupportedCollection {
  return {
    label: "Gnomeskies",
    policyId: POLICY_A,
    ...over,
  };
}

describe("filterByLabel", () => {
  const collections = [
    collection({ label: "Gnomeskies", policyId: POLICY_A }),
    collection({ label: "Snekkies", policyId: POLICY_B }),
  ];

  it("returns the list unchanged (same order) for an empty query", () => {
    expect(filterByLabel(collections, "")).toEqual(collections);
  });

  it("returns the list unchanged for a whitespace-only query", () => {
    expect(filterByLabel(collections, "   ")).toEqual(collections);
  });

  it("matches a case-insensitive substring", () => {
    expect(filterByLabel(collections, "gnome")).toEqual([collections[0]]);
    expect(filterByLabel(collections, "SNEK")).toEqual([collections[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterByLabel(collections, "nope")).toEqual([]);
  });
});
