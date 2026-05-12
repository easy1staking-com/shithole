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

import { collectionBySlug, curated, imageUrlForUnit, listingsBySlug, nftByUnit } from "./fixtureLoader";

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
