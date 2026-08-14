"use client";

import { useEffect, useRef, useState } from "react";

import {
  getDerivedMarketplaceManifest,
  manifestCacheKey,
  marketplaceManifest,
  type DerivedMarketplaceManifest,
} from "@/lib/market/config";
import { describeError } from "@/lib/errors";

/**
 * React hook: returns the derived manifest, recomputing whenever the slim
 * manifest's network + admin pkh changes. Loading is true on first paint
 * (single async fetch + UPLC apply, usually < 50ms once the blueprint is
 * warm). Errors surface via {@code error}.
 *
 * <p>Lives in its own client-only file so {@code config.ts} can stay
 * Server-Component-safe (the route pages call {@code isMarketplaceEnabled}
 * server-side and would otherwise drag this hook's React deps along).
 *
 * <p>Consumers that previously did
 * {@code useMemo(() => marketplaceManifest(), [])} should switch to this
 * hook and read derived fields off {@code data}.
 */
export function useDerivedMarketplaceManifest(): {
  data: DerivedMarketplaceManifest | null;
  loading: boolean;
  error: string | null;
} {
  const slim = marketplaceManifest();
  const slimKey = slim ? manifestCacheKey(slim) : null;
  const [state, setState] = useState<{
    data: DerivedMarketplaceManifest | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: !!slim, error: null });
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!slim || !slimKey) {
      lastKeyRef.current = null;
      // Clear derived state when the slim manifest disappears (external sync).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ data: null, loading: false, error: null });
      return;
    }
    if (lastKeyRef.current === slimKey && state.data) {
      // Already resolved for this key; skip the round-trip.
      return;
    }
    lastKeyRef.current = slimKey;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    getDerivedMarketplaceManifest(slim)
      .then((derived) => {
        if (cancelled) return;
        setState({ data: derived, loading: false, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: describeError(e),
        });
      });
    return () => {
      cancelled = true;
    };
    // The slim object is recomputed every render from localStorage, but
    // we key the effect on the stable string identity of network+pkh so
    // we don't re-derive on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slimKey]);

  return state;
}
