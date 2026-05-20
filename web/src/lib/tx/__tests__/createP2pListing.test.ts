/**
 * Pure-function tests for the v3 P2P create-listing helpers. The
 * `submitCreateP2pListing` flow itself is integration-only (Evolution
 * SDK + wallet bridge + UPLC apply); test what we can in isolation.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_SELLER_COMPENSATION_LOVELACE,
  assertBountyFloor,
} from "@/lib/tx/createP2pListing";

describe("assertBountyFloor", () => {
  it("accepts exactly protocol_fee + min_seller_compensation", () => {
    expect(() =>
      assertBountyFloor(1_000_000n + MIN_SELLER_COMPENSATION_LOVELACE, 1_000_000n),
    ).not.toThrow();
  });

  it("accepts anything above the floor", () => {
    expect(() =>
      assertBountyFloor(50_000_000n, 1_000_000n),
    ).not.toThrow();
  });

  it("rejects exactly one lovelace below the floor", () => {
    expect(() =>
      assertBountyFloor(
        1_000_000n + MIN_SELLER_COMPENSATION_LOVELACE - 1n,
        1_000_000n,
      ),
    ).toThrow(/below floor/);
  });

  it("handles zero-fee config (floor = 2 ADA flat)", () => {
    expect(() => assertBountyFloor(2_000_000n, 0n)).not.toThrow();
    expect(() => assertBountyFloor(1_999_999n, 0n)).toThrow(/below floor/);
  });

  it("MIN_SELLER_COMPENSATION_LOVELACE matches the on-chain constant", () => {
    // Anchored against types.ak::min_seller_compensation = 2_000_000.
    expect(MIN_SELLER_COMPENSATION_LOVELACE).toBe(2_000_000n);
  });
});
