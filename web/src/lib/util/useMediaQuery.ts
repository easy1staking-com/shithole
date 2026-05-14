"use client";

import { useSyncExternalStore } from "react";

/**
 * Tailwind-ish breakpoints. Mirrors the {@code sm}/{@code md}/{@code lg}
 * defaults so business logic stays aligned with the visual layout.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/**
 * Subscribe to a CSS media query. SSR-safe: the server snapshot is
 * always {@code false}; client picks up the real value on hydrate.
 *
 * <p>Use {@link useBreakpoint} for the common case of "is the viewport
 * at least breakpoint X?".
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => (typeof window !== "undefined" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Returns true if the viewport is at least the given Tailwind breakpoint. */
export function useBreakpoint(name: keyof typeof BREAKPOINTS): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[name]}px)`);
}
