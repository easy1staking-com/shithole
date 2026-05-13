"use client";

import { useMemo } from "react";

import type { Listing } from "@/types/api";

import { MudFloater } from "./MudFloater";

/**
 * The mud pit — hero visual of the pit page.
 *
 * <p>Renders an SVG-defined oval pool of mud (radial gradient + feTurbulence
 * noise) topped by 8-12 atmospheric floaters sampled from the listing pool.
 * Floater positions are deterministic per-listing-outref so the same NFT
 * lands in the same spot between renders (no visual jitter on refetch).
 *
 * <p>Theming: {@code accent_color} overlays as a subtle iridescence on the
 * surface; {@code background_url} is rendered behind the pit (a setting,
 * not the mud itself); {@code mascot_image_url} is a corner decoration
 * outside this component.
 */
export function MudPit({
  listings,
  accentColor,
  backgroundImage = "/pit/default-pit.webp",
}: {
  listings: Listing[];
  accentColor?: string | null;
  /**
   * Path to the pit's hero image. Defaults to the AI-generated shared
   * asset under {@code web/public/pit/default-pit.webp}. Future iterations
   * may supply a per-collection override via the curated theme.
   */
  backgroundImage?: string;
}) {
  // Sample 8-12 floaters deterministically (sorted by tx_hash for a stable
  // seed). Choose count based on pool size so a small pit doesn't feel empty.
  const sampled = useMemo(() => sampleFloaters(listings, 8, 12), [listings]);

  const accent = accentColor ?? "#b87333";

  return (
    <div className="relative w-full overflow-hidden rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
      {/* Hero image — the actual mud. Aspect-video (16:9) matches the
       *  AI-generated source. The image fills the box; CSS keeps it
       *  responsive. */}
      <div className="relative aspect-video w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={backgroundImage}
          alt="the pit"
          className="absolute inset-0 h-full w-full select-none object-cover"
          draggable={false}
        />

        {/* Subtle accent-coloured sheen on the surface — picks up the
         *  per-collection theme without overpowering the source art. */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay"
          style={{
            background: `radial-gradient(35% 30% at 35% 30%, ${accent}33 0%, transparent 70%)`,
          }}
          aria-hidden
        />

        {/* Inner vignette — pulls the eye toward the centre and frames
         *  the floaters. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)",
          }}
          aria-hidden
        />

        {/* Floaters layered over the image. The xPct/yPct sampler bounds
         *  (10..90% wide, 25..75% tall) target the safe area inside the
         *  pit's rim; if the source art's pit area shifts, adjust the
         *  sampler ranges instead of these positions. */}
        <div className="pointer-events-none absolute inset-0">
          {sampled.map((s, i) => (
            <MudFloater
              key={`${s.listing.utxo_ref.tx_id}#${s.listing.utxo_ref.output_index}`}
              listing={s.listing}
              xPct={s.xPct}
              yPct={s.yPct}
              sizePct={s.sizePct}
              rotateDeg={s.rotateDeg}
              sinkDeg={s.sinkDeg}
              opacity={s.opacity}
              driftDelaySec={i * 0.37}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Deterministic sampling                                                     */
/* -------------------------------------------------------------------------- */

type Sample = {
  listing: Listing;
  xPct: number;
  yPct: number;
  sizePct: number;
  rotateDeg: number;
  sinkDeg: number;
  opacity: number;
};

/**
 * Pick min..max listings deterministically (by sorted tx_hash) and assign
 * each a stable position + rotation derived from its outref bytes. Same
 * pool state → same picks → same positions → no visual jitter on refetch.
 */
function sampleFloaters(
  listings: Listing[],
  min: number,
  max: number,
): Sample[] {
  if (listings.length === 0) return [];
  const count = Math.max(1, Math.min(max, Math.max(min, listings.length)));
  // Deterministic order: by tx_hash hex (then output_index). Doesn't matter
  // what the order IS, only that it's stable.
  const sorted = [...listings].sort((a, b) => {
    const cmp = a.utxo_ref.tx_id.localeCompare(b.utxo_ref.tx_id);
    return cmp !== 0
      ? cmp
      : a.utxo_ref.output_index - b.utxo_ref.output_index;
  });
  const picks = sorted.slice(0, count);
  return picks.map((listing) => {
    // Seed RNG off the listing's outref so each NFT has its own stable
    // pose regardless of pool size or other listings around it.
    const seed = hashStr(
      `${listing.utxo_ref.tx_id}#${listing.utxo_ref.output_index}`,
    );
    const rng = mulberry32(seed);
    // 10..90% across, 25..75% down — keeps floaters inside the visible
    // ellipse (won't render at the very edges where the SVG rim shadow
    // is darkest).
    const xPct = 10 + rng() * 80;
    const yPct = 25 + rng() * 50;
    const sizePct = 9 + rng() * 5; // 9..14% of the pit's width
    const rotateDeg = (rng() - 0.5) * 30; // -15..+15
    const sinkDeg = (rng() - 0.5) * 10; // -5..+5 perspective tilt
    const opacity = 0.78 + rng() * 0.22; // 0.78..1.0
    return { listing, xPct, yPct, sizePct, rotateDeg, sinkDeg, opacity };
  });
}

/** Fast deterministic RNG: mulberry32. */
function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a of a UTF-8 string. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

