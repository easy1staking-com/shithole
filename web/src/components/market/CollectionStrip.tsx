"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ListingCard } from "@/components/market/ListingCard";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

/**
 * Horizontal strip of live marketplace listings for a single collection.
 * Filters the (already-fetched) listing set by the collection's policy id
 * and renders each as the same {@link ListingCard} used on /market.
 *
 * <p>Paging is arrow-driven (carousel style): the native scrollbar is
 * hidden and two overlay buttons scroll by ~a viewport's worth of cards.
 * Arrows only render when there's overflow in that direction; touch
 * swiping still works on mobile (overflow-x stays scrollable).
 */
export function CollectionStrip({
  collection,
  listings,
  loading,
}: {
  collection: SupportedCollection;
  listings: DecodedListing[];
  loading: boolean;
}) {
  const policy = collection.policyId.toLowerCase();
  const forCollection = listings.filter(
    (l) => (l.listedUnits[0] ?? "").slice(0, 56).toLowerCase() === policy,
  );

  const scrollerRef = useRef<HTMLUListElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Re-evaluate arrow visibility on scroll/resize/content change. 2px slack
  // absorbs sub-pixel rounding at the ends.
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, forCollection.length]);

  const page = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll by ~90% of the visible width so the last partially-visible
    // card of one page becomes the first full card of the next.
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-zinc-200">
            {collection.label}
          </h2>
          {!loading ? (
            <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-600">
              {forCollection.length} listed
            </span>
          ) : null}
        </div>
        <Link
          href={`/market?c=${policy}`}
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-sky-400"
        >
          view all →
        </Link>
      </div>

      {loading && forCollection.length === 0 ? (
        <div className="flex gap-4 overflow-hidden pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square w-52 flex-none animate-pulse rounded-lg border border-zinc-900 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : forCollection.length === 0 ? (
        <p className="text-sm text-zinc-600">
          no live listings — be the first to dump some in.
        </p>
      ) : (
        <div className="group relative">
          <ul
            ref={scrollerRef}
            className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {forCollection.map((l) => (
              <li
                key={`${l.utxo.txHash}.${l.utxo.outputIndex}`}
                className="w-52 flex-none"
              >
                <ListingCard listing={l} />
              </li>
            ))}
          </ul>

          {canLeft ? (
            <StripArrow dir={-1} onClick={() => page(-1)} label="previous listings" />
          ) : null}
          {canRight ? (
            <StripArrow dir={1} onClick={() => page(1)} label="more listings" />
          ) : null}
        </div>
      )}
    </section>
  );
}

function StripArrow({
  dir,
  onClick,
  label,
}: {
  dir: 1 | -1;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/90 text-lg text-zinc-200 shadow-lg backdrop-blur transition-colors hover:border-sky-600 hover:text-sky-300 sm:flex ${
        dir === -1 ? "-left-3" : "-right-3"
      }`}
    >
      {dir === -1 ? "←" : "→"}
    </button>
  );
}
