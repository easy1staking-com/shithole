/**
 * Static, bundle-time map of all fixture data the MSW handlers need.
 *
 * We import the JSON fixtures and PNG images directly so webpack/turbopack
 * inline them into the dev bundle. The image imports return Next.js
 * `StaticImageData` whose `.src` is a `_next/static/...` URL the browser
 * can fetch; the MSW handler does an internal fetch + relay to serve the
 * image bytes back to the page-level <img> tag.
 *
 * When the BE goes live (NEXT_PUBLIC_API_MODE !== "mock"), none of this
 * code runs in production — MSW is not started.
 */

import type {
  CollectionState,
  CuratedCollection,
  ListingsResponse,
  NftMetadata,
  Pool,
} from "@/types/api";

import curatedJson from "@/mocks/fixtures/api/curated.json";
import hoskyCollection from "@/mocks/fixtures/api/collections/hosky.json";
import hoskyListings from "@/mocks/fixtures/api/collections/hosky-listings.json";
import poolsJson from "@/mocks/fixtures/api/p2p/pools.json";

import nft1 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303031.json";
import nft2 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303032.json";
import nft3 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303033.json";
import nft4 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303034.json";
import nft5 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303035.json";
import nft6 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303036.json";
import nft7 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303037.json";
import nft8 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303038.json";
import nft9 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303039.json";
import nft10 from "@/mocks/fixtures/api/nft/a5bb0e5bb275a573d744a021f9b3bff73595468e002755b447e01559484f534b594361736847726162303030303030303130.json";

import imgHosky1 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000001.png";
import imgHosky2 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000002.png";
import imgHosky3 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000003.png";
import imgHosky4 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000004.png";
import imgHosky5 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000005.png";
import imgHosky6 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000006.png";
import imgHosky7 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000007.png";
import imgHosky8 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000008.png";
import imgHosky9 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000009.png";
import imgHosky10 from "@/mocks/fixtures/hosky/images/HOSKYCashGrab000000010.png";

/** Curated list (home page). */
export const curated: CuratedCollection[] = curatedJson as CuratedCollection[];

/**
 * v3 curated pools for the wanted-listing picker. Roots + asset_names_hex
 * are placeholders; real values come from the BE seeder once
 * `api/src/main/resources/p2p/pools.json` is populated.
 */
export const pools: Pool[] = poolsJson as Pool[];

/** Per-slug collection envelope. */
export const collectionBySlug: Record<string, CollectionState> = {
  hosky: hoskyCollection as CollectionState,
};

/** Per-slug listings page. The mock returns the full page regardless of pagination args. */
export const listingsBySlug: Record<string, ListingsResponse> = {
  hosky: hoskyListings as ListingsResponse,
};

const nftFixtures: NftMetadata[] = [
  nft1 as NftMetadata,
  nft2 as NftMetadata,
  nft3 as NftMetadata,
  nft4 as NftMetadata,
  nft5 as NftMetadata,
  nft6 as NftMetadata,
  nft7 as NftMetadata,
  nft8 as NftMetadata,
  nft9 as NftMetadata,
  nft10 as NftMetadata,
];

/** unit (hex) -> metadata. */
export const nftByUnit: Record<string, NftMetadata> = Object.fromEntries(
  nftFixtures.map((n) => [n.unit, n]),
);

/**
 * unit (hex) -> Next StaticImageData for the PNG.
 * `.src` is the bundled `_next/static/...` URL the service worker can fetch.
 */
type StaticImage = { src: string };

const imagesByAssetName: Record<string, StaticImage> = {
  HOSKYCashGrab000000001: imgHosky1,
  HOSKYCashGrab000000002: imgHosky2,
  HOSKYCashGrab000000003: imgHosky3,
  HOSKYCashGrab000000004: imgHosky4,
  HOSKYCashGrab000000005: imgHosky5,
  HOSKYCashGrab000000006: imgHosky6,
  HOSKYCashGrab000000007: imgHosky7,
  HOSKYCashGrab000000008: imgHosky8,
  HOSKYCashGrab000000009: imgHosky9,
  HOSKYCashGrab000000010: imgHosky10,
};

/** Resolve unit hex -> bundled image URL (via the NFT metadata's asset_name). */
export function imageUrlForUnit(unit: string): string | null {
  const meta = nftByUnit[unit];
  if (!meta) return null;
  const img = imagesByAssetName[meta.asset_name];
  return img ? img.src : null;
}
