"use client";

import Link from "next/link";
import { useMemo } from "react";

import { NftImage } from "@/components/NftImage";
import { listPools, matchesPool } from "@/lib/market/poolTraits";
import {
  splitUnit,
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import type { DecodedListing } from "@/lib/market/queryListings";
import { useNftMetadata } from "@/lib/api/hooks";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Marketplace listing card. Inspired by wayup.io's grid view: square
 * image dominates, name + price chip below, the listing's URL is the
 * canonical detail route. Image comes from the BE's CIP-25 metadata
 * (resolved via {@link useNftMetadata}); falls back to a hash-derived
 * gradient when the IPFS gateway 404s or the NFT carries no image.
 *
 * <p>Price label is resolved against the curated
 * {@link supportedPriceTokens} registry — "ADA", "HOSKY", "USDM"
 * instead of the raw policy id. Unknown price tokens show a truncated
 * policy id with a "?" prefix.
 */
export function ListingCard({ listing }: { listing: DecodedListing }) {
  const unit = listing.listedUnits[0] ?? "";
  const detailHref = `/market/${unit}?utxo=${listing.utxo.txHash}.${listing.utxo.outputIndex}`;

  const meta = useNftMetadata(unit);
  const name =
    meta.data?.name ?? prettyAssetName(unit) ?? truncate(unit, 22);

  const priceTokens = supportedPriceTokens();
  const priceLabel = resolvePriceLabel(listing, priceTokens);

  const displayPrice = formatPriceQty(
    listing.datum.priceQty,
    priceLabel.decimals,
  );

  const imageUrl = meta.data?.image_url ?? null;
  const isMulti = listing.listedUnits.length > 1;

  // Mark the connected wallet's own listings so sellers can spot (and go
  // delist) them straight from any browse surface. Cheap datum compare —
  // no extra fetch; simply absent when no wallet is connected.
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const isMine =
    !!walletPkh &&
    listing.datum.sellerPkhHex.toLowerCase() === walletPkh.toLowerCase();

  // Pools this NFT matches — same logic the /market filter uses, run
  // per-card here so the chips appear alongside the name. Computed
  // once per metadata refresh.
  const matchingPools = useMemo(() => {
    const traits = meta.data?.traits ?? [];
    if (traits.length === 0) return [];
    return listPools()
      .filter((p) => matchesPool(traits, p).length > 0)
      .map((p) => p.ticker);
  }, [meta.data]);

  return (
    <Link
      href={detailHref}
      className={`group relative block overflow-hidden rounded-xl border bg-zinc-950 transition hover:border-sky-700 ${
        isMine ? "border-amber-700/70" : "border-zinc-800"
      }`}
    >
      <ListingImage
        ipfsUri={meta.data?.image_ipfs_uri ?? null}
        url={imageUrl}
        alt={name}
        fallbackSeed={unit}
      />
      {isMine ? (
        <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-950 shadow">
          yours
        </span>
      ) : null}
      <div className="space-y-1.5 p-3">
        <h3 className="truncate text-sm font-semibold text-zinc-100">
          {name}
        </h3>
        {matchingPools.length > 0 ? (
          <PoolChips tickers={matchingPools} />
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-base text-sky-400">
            {displayPrice}
            <span className="ml-1 text-xs text-sky-300/80">
              {priceLabel.label}
            </span>
          </span>
          {isMulti ? (
            <span className="text-[10px] uppercase tracking-widest text-amber-400">
              bundle · {listing.listedUnits.length}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * Compact strip of pool tickers the listed NFT matches. Caps at 3
 * visible chips + a "+N" overflow chip so a Spam-class NFT with 8 pool
 * matches doesn't blow up the card layout.
 */
function PoolChips({ tickers }: { tickers: string[] }) {
  const visible = tickers.slice(0, 3);
  const overflow = tickers.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1" title={`matches: ${tickers.join(", ")}`}>
      {visible.map((t) => (
        <span
          key={t}
          className="rounded bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-300"
        >
          {t}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function ListingImage({
  ipfsUri,
  url,
  alt,
  fallbackSeed,
}: {
  ipfsUri: string | null;
  url: string | null;
  alt: string;
  fallbackSeed: string;
}) {
  return (
    <div className="relative aspect-square overflow-hidden bg-zinc-900">
      <NftImage
        ipfsUri={ipfsUri}
        url={url}
        alt={alt}
        draggable={false}
        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        fallback={<ImageFallback seed={fallbackSeed} />}
      />
    </div>
  );
}

/**
 * Deterministic gradient placeholder. Mirrors what most NFT marketplaces
 * fall back to when IPFS is slow / missing. The seed is the asset unit
 * so the same NFT always gets the same gradient.
 */
function ImageFallback({ seed }: { seed: string }) {
  const [h1, h2] = seedToHues(seed);
  return (
    <div
      className="relative flex aspect-square items-center justify-center bg-zinc-900 text-[10px] uppercase tracking-widest text-zinc-600"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${h1} 55% 16%) 0%, hsl(${h2} 55% 28%) 100%)`,
      }}
    >
      no image
    </div>
  );
}

function seedToHues(seed: string): [number, number] {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const h1 = acc % 360;
  const h2 = (acc * 7919) % 360;
  return [h1, h2];
}

type ResolvedPriceLabel = {
  label: string;
  decimals: number;
};

function resolvePriceLabel(
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

function formatPriceQty(qty: bigint, decimals: number): string {
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

function formatThousands(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  // Insert thousands separators from the right.
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function prettyAssetName(unit: string): string | null {
  if (unit.length <= 56) return null;
  try {
    const ascii = hexToAscii(unit.slice(56));
    return ascii || null;
  } catch {
    return null;
  }
}

function hexToAscii(hex: string): string {
  if (!hex || hex.length % 2 !== 0) throw new Error("bad hex");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x20 || code > 0x7e) throw new Error("non-printable");
    out += String.fromCharCode(code);
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
