"use client";

import Link from "next/link";

import { ErrorView } from "@/components/ErrorView";
import { PitP2pBand } from "@/components/PitP2pBand";
import { CollectionStrip } from "@/components/market/CollectionStrip";
import { supportedCollections } from "@/lib/market/supportedCollections";
import { useMarketListings } from "@/lib/market/useMarketListings";

/**
 * Marketplace-first landing. Hero flows straight into live per-collection
 * NFT strips (public, wallet-free reads). Pit + P2P get a subordinate band
 * below (next iteration); both stay reachable from the nav.
 */
export default function HomePage() {
  const collections = supportedCollections();
  const { listings, loading, error } = useMarketListings();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-14">
      {/* ---- HERO ---- */}
      <section className="flex flex-col gap-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500">
          the second-hand market for dead JPEGs
        </p>
        <h1 className="font-mono text-4xl font-bold uppercase leading-[0.98] tracking-tight text-zinc-100 text-balance sm:text-6xl">
          Everything here{" "}
          <span className="text-zinc-600 line-through">already</span> rugged.
          <br />
          <span className="text-sky-400">Trade it anyway.</span>
        </h1>
        <p className="max-w-2xl text-base text-zinc-400">
          A marketplace for dead and rugpulled Cardano collections. List the
          bags you&apos;re stuck with, buy someone else&apos;s mistake — or drop
          it in a Pit and take whatever surfaces.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/market"
            className="rounded bg-sky-700 px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-wide text-zinc-100 hover:bg-sky-600"
          >
            browse the market →
          </Link>
          <Link
            href="/market/new"
            className="rounded border border-zinc-700 px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-zinc-300 hover:border-sky-600"
          >
            list something
          </Link>
        </div>
      </section>

      {/* ---- LIVE COLLECTION STRIPS ---- */}
      {error ? (
        <ErrorView error={error} context={{ subject: "marketplace" }} />
      ) : collections.length > 0 ? (
        <div className="flex flex-col gap-10">
          {collections.map((c) => (
            <CollectionStrip
              key={c.policyId}
              collection={c}
              listings={listings ?? []}
              loading={loading || listings === null}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          no collections configured on this network yet.
        </p>
      )}

      {/* ---- PIT + P2P (subordinate band) ---- */}
      <PitP2pBand />
    </main>
  );
}
