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
  baseColor = "#5a3c1f",
}: {
  listings: Listing[];
  accentColor?: string | null;
  baseColor?: string;
}) {
  // Sample 8-12 floaters deterministically (sorted by tx_hash for a stable
  // seed). Choose count based on pool size so a small pit doesn't feel empty.
  const sampled = useMemo(() => sampleFloaters(listings, 8, 12), [listings]);

  const accent = accentColor ?? "#b87333";

  return (
    <div className="relative w-full">
      {/* The pit itself — an SVG with a radial-gradient mud fill and a
       *  noise filter for texture. Aspect ratio is wider than tall so the
       *  surface reads as a pool, not a circle. */}
      <svg
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        aria-label="mud pit"
      >
        <defs>
          {/* Mud fill — dark at the rim, warmer at the centre. */}
          <radialGradient id="mud-fill" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={lighten(baseColor, 0.15)} />
            <stop offset="60%" stopColor={baseColor} />
            <stop offset="100%" stopColor={darken(baseColor, 0.3)} />
          </radialGradient>

          {/* Subtle accent-coloured sheen on the surface. */}
          <radialGradient id="mud-sheen" cx="35%" cy="30%" r="40%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>

          {/* Noise texture — feTurbulence + colour matrix to brown. */}
          <filter id="mud-noise" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="3"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="
                0 0 0 0 0.20
                0 0 0 0 0.13
                0 0 0 0 0.05
                0 0 0 0.15 0"
            />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>

          {/* Rim shadow for depth. */}
          <radialGradient id="mud-rim" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
          </radialGradient>
        </defs>

        {/* Mud body — large ellipse filling most of the canvas. */}
        <ellipse cx="500" cy="250" rx="490" ry="230" fill="url(#mud-fill)" />
        {/* Noise texture layered over the body. */}
        <ellipse
          cx="500"
          cy="250"
          rx="490"
          ry="230"
          fill="url(#mud-fill)"
          filter="url(#mud-noise)"
        />
        {/* Accent sheen, top-left. */}
        <ellipse cx="500" cy="250" rx="490" ry="230" fill="url(#mud-sheen)" />
        {/* Rim shadow on the inside. */}
        <ellipse
          cx="500"
          cy="250"
          rx="490"
          ry="230"
          fill="url(#mud-rim)"
          pointerEvents="none"
        />
      </svg>

      {/* Floaters layered absolutely over the SVG. Each is positioned by
       *  a deterministic % of the pit's bounding box so the placement is
       *  stable across renders. The HTML/img approach (instead of inline
       *  SVG <image>) lets us reuse Next's Image optimisation + native
       *  CSS animations cleanly. */}
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

/* -------------------------------------------------------------------------- */
/* Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

function lighten(hex: string, amount: number) {
  const { r, g, b } = parseHex(hex);
  return rgbToHex(
    clamp(r + 255 * amount),
    clamp(g + 255 * amount),
    clamp(b + 255 * amount),
  );
}

function darken(hex: string, amount: number) {
  return lighten(hex, -amount);
}

function parseHex(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, n));
}
