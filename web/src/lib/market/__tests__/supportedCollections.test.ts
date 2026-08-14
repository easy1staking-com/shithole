import { describe, expect, it } from "vitest";

import { isValidCollectionParam } from "@/lib/market/supportedCollections";

// Real preprod policy (Gnomeskies) and mainnet policy (HOSKY CashGrab)
// from the whitelist in supportedCollections.ts.
const PREPROD_GNOMESKIES = "a4ad9795d5a07ca9df5ccdb99b011fab5a0f4563ede432c5f9c6347d";
const MAINNET_HOSKY = "a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559";
const NON_WHITELIST_POLICY = "0".repeat(56);

describe("isValidCollectionParam", () => {
  it("returns false for undefined", () => {
    expect(isValidCollectionParam(undefined, "preprod")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidCollectionParam("", "preprod")).toBe(false);
  });

  it("returns false for a 56-hex policy not on the whitelist", () => {
    expect(isValidCollectionParam(NON_WHITELIST_POLICY, "preprod")).toBe(false);
  });

  it("returns true for a valid preprod policy (Gnomeskies)", () => {
    expect(isValidCollectionParam(PREPROD_GNOMESKIES, "preprod")).toBe(true);
  });

  it("returns true for the same valid policy uppercased (case-insensitive)", () => {
    expect(
      isValidCollectionParam(PREPROD_GNOMESKIES.toUpperCase(), "preprod"),
    ).toBe(true);
  });

  it("returns true for the mainnet HOSKY policy on mainnet", () => {
    expect(isValidCollectionParam(MAINNET_HOSKY, "mainnet")).toBe(true);
  });

  it("returns false for a preprod-only policy on mainnet (network-keyed)", () => {
    expect(isValidCollectionParam(PREPROD_GNOMESKIES, "mainnet")).toBe(false);
  });
});
