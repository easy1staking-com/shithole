/**
 * MSW handlers — intercept the BE API surface during dev so the FE can
 * be developed against a stable, committed fixture set. When the real
 * BE is reachable, switch via NEXT_PUBLIC_API_MODE (see browser.ts).
 *
 * Endpoint surface mirrors docs/BACKEND.md / SPEC.md §10.2:
 *   GET /api/curated
 *   GET /api/collections/:slug
 *   GET /api/collections/:slug/listings?page=&size=&bucket=
 *   GET /api/nft/:unit
 *   GET /api/nft/:unit/image?size=64|256|1024
 */

import { http, HttpResponse } from "msw";

import {
  collectionBySlug,
  curated,
  imageUrlForUnit,
  listingsBySlug,
  nftByUnit,
  pools,
} from "./fixtureLoader";

export const handlers = [
  http.get("/api/curated", () => {
    return HttpResponse.json(curated);
  }),

  http.get("/api/collections/:slug", ({ params }) => {
    const slug = params.slug as string;
    const collection = collectionBySlug[slug];
    if (!collection) {
      return HttpResponse.json({ error: "not_found", slug }, { status: 404 });
    }
    return HttpResponse.json(collection);
  }),

  http.get("/api/collections/:slug/listings", ({ params, request }) => {
    const slug = params.slug as string;
    const all = listingsBySlug[slug];
    if (!all) {
      return HttpResponse.json({ error: "not_found", slug }, { status: 404 });
    }
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
    const size = Number.parseInt(url.searchParams.get("size") ?? String(all.size), 10);
    const start = page * size;
    const data = all.data.slice(start, start + size);
    return HttpResponse.json({
      total: all.total,
      page,
      size,
      data,
    });
  }),

  http.get("/api/nft/:unit", ({ params }) => {
    const unit = params.unit as string;
    const meta = nftByUnit[unit];
    if (!meta) {
      return HttpResponse.json({ error: "not_found", unit }, { status: 404 });
    }
    return HttpResponse.json(meta);
  }),

  /**
   * Mock for POST /api/configs. Returns 401 signature_invalid by default
   * to mirror the real BE's behavior: in mock mode we never have a real
   * on-chain admin to satisfy the verifier. The 401 still confirms the
   * FE wire shape compiles and reaches the handler.
   *
   * To test the success path locally, set NEXT_PUBLIC_API_MODE=live and
   * point at a running BE.
   */
  http.post("/api/configs", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return HttpResponse.json(
        { reason: "invalid_request", message: "malformed JSON" },
        { status: 400 },
      );
    }
    // Minimal shape check so the FE form gets useful 400s in dev.
    const required = ["config_nft_policy", "slug", "display_name", "signature"];
    for (const k of required) {
      if (!(k in body)) {
        return HttpResponse.json(
          { reason: "invalid_request", message: `missing field: ${k}` },
          { status: 400 },
        );
      }
    }
    return HttpResponse.json(
      {
        reason: "signature_invalid",
        message:
          "mock-mode BE cannot verify CIP-8 signatures; set NEXT_PUBLIC_API_MODE=live for the real flow",
      },
      { status: 401 },
    );
  }),

  /* ---- v3 wanted-listing — pool-merkle endpoints ------------------- */

  http.get("/api/p2p/pools", () => {
    return HttpResponse.json(pools.filter((p) => p.is_active));
  }),

  http.get("/api/p2p/pools/by-root/:root", ({ params }) => {
    const root = params.root as string;
    const pool = pools.find((p) => p.merkle_root_hex === root);
    if (!pool) {
      return HttpResponse.json({ error: "not_found", root }, { status: 404 });
    }
    return HttpResponse.json(pool);
  }),

  http.get("/api/p2p/pools/:ticker", ({ params }) => {
    const ticker = params.ticker as string;
    const pool = pools.find((p) => p.is_active && p.ticker === ticker);
    if (!pool) {
      return HttpResponse.json({ error: "not_found", ticker }, { status: 404 });
    }
    return HttpResponse.json(pool);
  }),

  // Proof generation needs real merkle data — the fixture pools.json carries
  // placeholder roots/asset_names, so we can't synthesise a valid proof
  // off-chain. Return 404 in mock mode so the UI exercises the empty branch;
  // switch NEXT_PUBLIC_API_MODE=live for the real flow once the BE seeder
  // is populated.
  http.get("/api/p2p/pools/:root/proofs/:assetName", () => {
    return HttpResponse.json(
      {
        error: "not_found",
        message:
          "mock-mode MSW serves placeholder pool data; proofs only available against live BE",
      },
      { status: 404 },
    );
  }),

  http.get("/api/nft/:unit/image", async ({ params }) => {
    const unit = params.unit as string;
    const url = imageUrlForUnit(unit);
    if (!url) {
      return new HttpResponse(null, { status: 404 });
    }
    // The bundled URL points at a `_next/static/...` asset; let the
    // service worker fetch it from the same origin and relay the bytes.
    // Size is intentionally ignored here — the fixture is one resolution
    // (full PNG); real BE serves 64/256/1024 JPEG variants per BACKEND.md.
    const resp = await fetch(url);
    if (!resp.ok) {
      return new HttpResponse(null, { status: 502 });
    }
    const buffer = await resp.arrayBuffer();
    return new HttpResponse(buffer, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }),
];
