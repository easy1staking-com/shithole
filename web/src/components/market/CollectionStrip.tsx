"use client";

import Link from "next/link";

import { ListingCard } from "@/components/market/ListingCard";
import type { DecodedListing } from "@/lib/market/queryListings";
import type { SupportedCollection } from "@/lib/market/supportedCollections";

/**
 * Horizontal strip of live marketplace listings for a single collection.
 * Filters the (already-fetched) listing set by the collection's policy id
 * and renders each as the same {@link ListingCard} used on /market.
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
          href="/market"
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
        <ul className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3 [scrollbar-width:thin]">
          {forCollection.map((l) => (
            <li
              key={`${l.utxo.txHash}.${l.utxo.outputIndex}`}
              className="w-52 flex-none"
            >
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
