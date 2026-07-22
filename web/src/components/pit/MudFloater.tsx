"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { NftImage } from "@/components/NftImage";
import { useNftMetadata } from "@/lib/api/hooks";
import type { Listing } from "@/types/api";

/**
 * One semi-submerged NFT floating in the mud. Positioned absolutely as a
 * percentage of the parent (the {@code MudPit}'s bounding box).
 *
 * <p>Per-NFT pose (rotation, sink tilt, opacity) is passed in from the
 * {@link MudPit}'s deterministic sampler — same listing → same pose.
 *
 * <p>The drift animation is a low-frequency Y oscillation. Each floater
 * starts at a different phase ({@code driftDelaySec}) so the pool doesn't
 * pulse in unison. Animation is suspended when:
 * <ul>
 *   <li>the user prefers reduced motion;</li>
 *   <li>the document is hidden (background tab / minimized).</li>
 * </ul>
 *
 * <p>Earlier iterations animated both Y and rotation across 4 keyframes
 * at a 6-9s loop — multiplied by 8-12 floaters that's a measurable
 * steady-state CPU hit on laptops. Current version animates Y only on
 * 3 keyframes at 12-15s, dropping the per-frame work to a third while
 * keeping a subtle drift.
 */
export function MudFloater({
  listing,
  xPct,
  yPct,
  sizePct,
  rotateDeg,
  sinkDeg,
  opacity,
  driftDelaySec,
}: {
  listing: Listing;
  xPct: number;
  yPct: number;
  sizePct: number;
  rotateDeg: number;
  sinkDeg: number;
  opacity: number;
  driftDelaySec: number;
}) {
  const meta = useNftMetadata(listing.current_nft_unit);
  const name = meta.data?.name ?? listing.current_nft_unit.slice(0, 16) + "…";
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animated = !reduceMotion && visible;

  return (
    <motion.div
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 select-none"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: `${sizePct}%`,
        opacity,
        // Static rotation lives on the OUTER container too, so the
        // animation can drop the rotate keyframe without losing the
        // per-NFT pose variety.
        rotate: rotateDeg,
      }}
      animate={animated ? { y: [0, -3, 0] } : { y: 0 }}
      transition={
        animated
          ? {
              duration: 12 + (Math.abs(sinkDeg) % 3),
              ease: "easeInOut",
              repeat: Infinity,
              repeatType: "mirror",
              delay: driftDelaySec,
            }
          : { duration: 0 }
      }
      title={name}
    >
      <div
        className="relative aspect-square overflow-hidden rounded-full shadow-[0_8px_18px_rgba(0,0,0,0.55)] ring-2 ring-black/40"
        style={{ transform: `rotate(${sinkDeg}deg)` }}
      >
        <NftImage
          ipfsUri={meta.data?.image_ipfs_uri ?? null}
          url={meta.data?.image_url ?? null}
          alt={name}
          className="h-full w-full object-cover"
          fallback={
            <div className="grid h-full w-full place-items-center bg-zinc-900 text-[0.6rem] text-zinc-500">
              loading
            </div>
          }
        />
        {/* A brown sheen over the bottom third — suggests the NFT is
         *  partially submerged. The rotation on the outer container plus
         *  this gradient makes the same image read differently for each
         *  floater. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
          style={{
            background:
              "linear-gradient(to top, rgba(60,38,12,0.85), rgba(60,38,12,0.0))",
          }}
        />
      </div>
    </motion.div>
  );
}

/**
 * Track document.visibilityState so animations can pause when the tab
 * is backgrounded / window minimized. Saves CPU on idle background
 * tabs and helps laptops stay cool when the user has multiple tabs
 * open.
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
