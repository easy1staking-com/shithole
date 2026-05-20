/**
 * Unit tests for the v3 BE API client (pool-merkle endpoints). The test
 * mocks `globalThis.fetch` directly — no MSW, no React. Catches wire-format
 * drift between FE and BE, and confirms 404 → null translation works.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchPoolByRoot,
  fetchPoolByTicker,
  fetchPools,
  fetchProof,
} from "@/lib/api/client";

const HOSKY_POOL = {
  ticker: "HOSKY",
  pool_id_hex: "11".repeat(28),
  merkle_root_hex: "aa".repeat(32),
  total_assets: 12345,
  is_active: true,
};

function mockFetch(impl: (req: { url: string }) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(impl({ url }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPools", () => {
  it("returns the array unchanged", async () => {
    mockFetch(() =>
      Response.json([HOSKY_POOL], { status: 200 }),
    );
    const pools = await fetchPools();
    expect(pools).toHaveLength(1);
    expect(pools[0]).toEqual(HOSKY_POOL);
  });

  it("returns empty array as-is (pre-curation state)", async () => {
    mockFetch(() => Response.json([], { status: 200 }));
    const pools = await fetchPools();
    expect(pools).toEqual([]);
  });
});

describe("fetchPoolByTicker", () => {
  it("returns the pool on 200", async () => {
    mockFetch(() => Response.json(HOSKY_POOL, { status: 200 }));
    const pool = await fetchPoolByTicker("HOSKY");
    expect(pool).toEqual(HOSKY_POOL);
  });

  it("returns null on 404", async () => {
    mockFetch(() =>
      Response.json({ error: "not_found" }, { status: 404 }),
    );
    const pool = await fetchPoolByTicker("UNKNOWN");
    expect(pool).toBeNull();
  });

  it("rethrows on non-404 errors", async () => {
    mockFetch(() =>
      Response.json({ error: "internal" }, { status: 500 }),
    );
    await expect(fetchPoolByTicker("HOSKY")).rejects.toThrow(/API error 500/);
  });

  it("URL-encodes the ticker", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json(HOSKY_POOL)));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchPoolByTicker("HO SKY/v2");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/p2p/pools/HO%20SKY%2Fv2",
      expect.anything(),
    );
  });
});

describe("fetchPoolByRoot", () => {
  it("returns the pool for a known root (including historical)", async () => {
    mockFetch(() => Response.json(HOSKY_POOL, { status: 200 }));
    const pool = await fetchPoolByRoot(HOSKY_POOL.merkle_root_hex);
    expect(pool).toEqual(HOSKY_POOL);
  });

  it("returns null on 404", async () => {
    mockFetch(() =>
      Response.json({ error: "not_found" }, { status: 404 }),
    );
    const pool = await fetchPoolByRoot("00".repeat(32));
    expect(pool).toBeNull();
  });
});

describe("fetchProof", () => {
  it("returns the proof on 200", async () => {
    const proof = {
      merkle_root_hex: HOSKY_POOL.merkle_root_hex,
      asset_name_hex: "cc".repeat(28),
      proof: [
        { side: "left", hash_hex: "11".repeat(32) },
        { side: "right", hash_hex: "22".repeat(32) },
      ],
    };
    mockFetch(() => Response.json(proof, { status: 200 }));
    const result = await fetchProof(HOSKY_POOL.merkle_root_hex, "cc".repeat(28));
    expect(result).toEqual(proof);
  });

  it("returns null when the asset_name isn't a leaf", async () => {
    mockFetch(() =>
      Response.json({ error: "not_found" }, { status: 404 }),
    );
    const result = await fetchProof(HOSKY_POOL.merkle_root_hex, "ff".repeat(28));
    expect(result).toBeNull();
  });

  it("URL-encodes both path segments", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ error: "x" }, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await fetchProof("root/with/slashes", "asset?name");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/p2p/pools/root%2Fwith%2Fslashes/proofs/asset%3Fname",
      expect.anything(),
    );
  });
});
