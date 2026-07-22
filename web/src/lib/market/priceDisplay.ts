import {
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import type { DecodedListing } from "@/lib/market/queryListings";

/**
 * Price/name display helpers shared by the 2D grid (ListingCard) and the
 * 3D gallery plaques. Extracted verbatim from ListingCard so both
 * surfaces render identical labels.
 */

export type ResolvedPriceLabel = {
  label: string;
  decimals: number;
};

export function resolvePriceLabel(
  listing: DecodedListing,
  registry: SupportedPriceToken[],
): ResolvedPriceLabel {
  const unitHex = (
    listing.datum.pricePolicyHex + listing.datum.priceNameHex
  ).toLowerCase();
  for (const t of registry) {
    if ((t.unit || "").toLowerCase() === unitHex) {
      return { label: t.ticker ?? t.label, decimals: t.decimals };
    }
  }
  // Best-effort fallback: try to decode the asset name as ASCII so dev
  // collections that don't have a registry entry still surface a sane
  // chip ("?HOSKY" etc.) instead of raw hex.
  try {
    const asciiName = hexToAscii(listing.datum.priceNameHex);
    if (asciiName) return { label: `?${asciiName}`, decimals: 0 };
  } catch {
    /* ignore */
  }
  const head = listing.datum.pricePolicyHex.slice(0, 6);
  return { label: `?${head}…`, decimals: 0 };
}

export function formatPriceQty(qty: bigint, decimals: number): string {
  if (decimals === 0) return formatThousands(qty);
  const divisor = 10n ** BigInt(decimals);
  const whole = qty / divisor;
  const frac = qty % divisor;
  if (frac === 0n) return formatThousands(whole);
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${formatThousands(whole)}.${fracStr}`;
}

export function formatThousands(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  // Insert thousands separators from the right.
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function prettyAssetName(unit: string): string | null {
  if (unit.length <= 56) return null;
  try {
    const ascii = hexToAscii(unit.slice(56));
    return ascii || null;
  } catch {
    return null;
  }
}

export function hexToAscii(hex: string): string {
  if (!hex || hex.length % 2 !== 0) throw new Error("bad hex");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x20 || code > 0x7e) throw new Error("non-printable");
    out += String.fromCharCode(code);
  }
  return out;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
