"use client";

import { forwardRef } from "react";

import type { Listing } from "@/types/api";

import { MudPit } from "./MudPit";

/**
 * Wraps {@link MudPit} with a forwarded ref so the parent (PitPage) can
 * call {@code getBoundingClientRect()} on drop release. Adds an accent
 * glow when something is being dragged toward the pit.
 *
 * <p>The glow is just a CSS overlay; no JS needed beyond toggling a
 * boolean. The drop hit-test lives in the parent (it already owns the
 * swap-state machine and decides match-or-reject).
 */
export const PitDropZone = forwardRef<
  HTMLDivElement,
  {
    listings: Listing[];
    accentColor?: string | null;
    /** True while the user is currently dragging a wallet card. */
    armed: boolean;
    /** True if the cursor/finger is inside the pit's rect during drag. */
    hovering: boolean;
  }
>(function PitDropZone(
  { listings, accentColor, armed, hovering },
  ref,
) {
  const accent = accentColor ?? "#b87333";
  return (
    <div ref={ref} className="relative">
      <MudPit listings={listings} accentColor={accentColor} />
      {/* Glow overlay — visible when a drag is in progress. Intensity
       *  bumps when the cursor is actually inside the pit. */}
      {armed && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-200"
          style={{
            opacity: hovering ? 0.85 : 0.35,
            boxShadow: `inset 0 0 80px 30px ${accent}aa`,
          }}
          aria-hidden
        />
      )}
    </div>
  );
});
