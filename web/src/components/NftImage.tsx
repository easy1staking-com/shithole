"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * NFT image with IPFS-gateway rotation. The BE rewrites ipfs:// URIs to a
 * hardcoded public gateway (ipfs.io) in {@code image_url} — but ipfs.io is
 * on ad-block/privacy filter lists (Brave Shields, uBlock, strict ETP, DNS
 * blockers) and rate-limits bursts, so on some browsers every card in a
 * grid 404s/blocks and renders a raw broken image.
 *
 * <p>This component builds the URL client-side from the RAW on-chain URI
 * ({@code image_ipfs_uri}) and rotates through a gateway list on
 * {@code onError}: w3s.link → dweb.link → ipfs.io. When there is no
 * ipfs:// URI it falls back to {@code image_url} verbatim (http/ar/data
 * images). When every candidate fails — or there's no image at all — it
 * renders {@code fallback} (default: the muted gradient placeholder).
 *
 * <p>Drop-in recipe at call sites:
 * {@code <NftImage ipfsUri={meta.data?.image_ipfs_uri} url={meta.data?.image_url} …/>}
 * replacing the whole {@code image ? <img/> : <placeholder/>} branch.
 */

/** Rotation order. cloudflare-ipfs.com is dead — do not add it. */
const GATEWAYS = ["w3s.link", "dweb.link", "ipfs.io"] as const;

export type NftImageProps = {
  /** Raw on-chain URI (ipfs://CID[/path]) — preferred source. */
  ipfsUri?: string | null;
  /** BE-rewritten URL — used when there's no ipfs:// URI. */
  url?: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  draggable?: boolean;
  /** Rendered when every candidate fails or no image exists. */
  fallback?: ReactNode;
};

export function NftImage({
  ipfsUri,
  url,
  alt,
  className,
  loading = "lazy",
  draggable,
  fallback,
}: NftImageProps) {
  const candidates = useMemo(() => buildCandidates(ipfsUri, url), [ipfsUri, url]);
  const [attempt, setAttempt] = useState(0);

  // Viewport gating: don't give the <img> a src until the card is actually
  // near the viewport. Native loading="lazy" is NOT enough — browsers
  // preload lazy images within a huge margin and a whale wallet mounts
  // 1000+ cards at once, so the burst 429s every gateway, the rotation
  // exhausts, and whole grids render the (near-black) fallback. eager
  // images (above-the-fold heroes) bypass the observer.
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(loading === "eager");
  const candidatesKey = candidates.join("|");
  useEffect(() => {
    if (inView) return;
    // Re-arm whenever the candidate list changes: on a cold load the first
    // render happens BEFORE metadata arrives (no candidates → fallback →
    // no holder div), so an observer armed only at mount would watch
    // nothing and the image would stay a placeholder forever. The
    // candidatesKey dep re-runs this once the holder actually renders.
    const el = holderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IO (jsdom / very old browsers) → load immediately. Microtask
      // keeps the setState out of the effect's sync body.
      queueMicrotask(() => setInView(true));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      // Start fetching a little ahead of the scroll for smoothness, but
      // nowhere near the browser's own multi-thousand-px lazy margins.
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, candidatesKey]);

  // New unit/metadata → new candidate list → restart the rotation. Uses
  // React's render-time "adjust state when props change" pattern (not an
  // effect): setState during render is bailed out immediately, no extra
  // paint of the stale attempt.
  const [prevKey, setPrevKey] = useState(candidatesKey);
  if (prevKey !== candidatesKey) {
    setPrevKey(candidatesKey);
    setAttempt(0);
  }

  const src = candidates[attempt];
  if (!src) {
    return fallback !== undefined ? <>{fallback}</> : <DefaultFallback className={className} />;
  }

  if (!inView) {
    // Same layout slot the <img> will occupy; the observer watches this.
    return (
      <div
        ref={holderRef}
        aria-hidden
        className={`animate-pulse bg-zinc-900/60 ${className ?? ""}`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      draggable={draggable}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}

/** Muted gradient placeholder — mirrors the market ListingCard fallback. */
function DefaultFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 ${className ?? ""}`}
    />
  );
}

/** ipfs://CID[/path] (tolerating the legacy ipfs://ipfs/CID form) → CID[/path]. */
function ipfsPath(uri: string): string | null {
  if (!uri.startsWith("ipfs://")) return null;
  let path = uri.slice("ipfs://".length);
  if (path.startsWith("ipfs/")) path = path.slice("ipfs/".length);
  return path || null;
}

/** Exported for the 3D gallery's texture loader — same rotation order. */
export function buildCandidates(
  ipfsUri: string | null | undefined,
  url: string | null | undefined,
): string[] {
  const out: string[] = [];
  const path = ipfsUri ? ipfsPath(ipfsUri) : null;
  if (path) {
    for (const g of GATEWAYS) out.push(`https://${g}/ipfs/${path}`);
  }
  // BE-rewritten URL as the last resort (deduped — it's usually the
  // ipfs.io form already in the list). Sole candidate for non-IPFS images.
  if (url && !out.includes(url)) out.push(url);
  return out;
}
