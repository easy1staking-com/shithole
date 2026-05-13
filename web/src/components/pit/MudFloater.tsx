"use client";

import { motion } from "framer-motion";

import { useNftMetadata } from "@/lib/api/hooks";
import type { Listing } from "@/types/api";

/**
 * One semi-submerged NFT floating in the mud. Positioned absolutely as a
 * percentage of the parent (the {@code MudPit}'s bounding box).
 *
 * <p>Per-NFT pose (rotation, sink tilt, opacity) is passed in from the
 * {@link MudPit}'s deterministic sampler — same listing → same pose.
 *
 * <p>The drift animation is a low-frequency Y/rotation oscillation. Each
 * floater starts at a different phase ({@code driftDelaySec}) so the pool
 * doesn't pulse in unison. Reduced-motion preferences flatten the
 * animation to a static pose.
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
  const imageUrl = meta.data?.image_url ?? null;
  const name = meta.data?.name ?? listing.current_nft_unit.slice(0, 16) + "…";

  return (
    <motion.div
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 select-none"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: `${sizePct}%`,
        opacity,
      }}
      animate={{
        y: [0, -3, 0, 3, 0],
        rotate: [
          rotateDeg,
          rotateDeg + 1.5,
          rotateDeg,
          rotateDeg - 1.5,
          rotateDeg,
        ],
      }}
      transition={{
        duration: 6 + (Math.abs(sinkDeg) % 3),
        ease: "easeInOut",
        repeat: Infinity,
        delay: driftDelaySec,
      }}
      title={name}
    >
      <div
        className="relative aspect-square overflow-hidden rounded-full shadow-[0_8px_18px_rgba(0,0,0,0.55)] ring-2 ring-black/40"
        style={{ transform: `rotate(${sinkDeg}deg)` }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-zinc-900 text-[0.6rem] text-zinc-500">
            loading
          </div>
        )}
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
