"use client";

import { use } from "react";

import { MudPit } from "@/components/pit/MudPit";
import { PitHeader } from "@/components/pit/PitHeader";
import { WalletDrawer } from "@/components/pit/WalletDrawer";
import { useCollection, useListings } from "@/lib/api/hooks";

/**
 * The pit page — hero interaction of the dApp.
 *
 * <p>Iteration 1: themed mud-pit visual with atmospheric sampled
 * floaters, collection header (name + stats + accent + mascot), and a
 * sticky-bottom wallet drawer enumerating the wallet's holdings of this
 * collection. No interactions yet (swap + list flows land in iter-2).
 *
 * <p>The pit fills the upper viewport on mobile; on desktop it lives
 * inside a max-width container next to nothing yet — future iterations
 * may add a sidebar (lineage / stats / leaderboard).
 */
type Params = { slug: string };

export default function PitPage({ params }: { params: Promise<Params> }) {
  const { slug } = use(params);
  const collection = useCollection(slug);
  // Larger page size than the FE will surface in the mud — gives the
  // sampler more material to pick atmospheric floaters from.
  const listings = useListings(slug, { page: 0, size: 50 });

  // Per-collection theme background, applied to the page container.
  const bgUrl = collection.data?.theme?.background_url ?? null;

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={
        bgUrl
          ? {
              backgroundImage: `linear-gradient(rgba(8,8,12,0.85), rgba(8,8,12,0.95)), url(${bgUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 pb-32 pt-8">
        {collection.isLoading && (
          <p className="text-sm text-zinc-500">peering into the pit…</p>
        )}
        {collection.error && (
          <p className="text-sm text-red-400" role="alert">
            could not load this pit: {collection.error.message}
          </p>
        )}

        {collection.data && (
          <>
            <PitHeader collection={collection.data} />

            <div className="relative">
              {/* The mud-pit visual. Empty pool → static mud with a copy
               *  overlay; loaded pool → the sampler picks 8-12 floaters. */}
              {listings.isLoading && (
                <p className="text-xs text-zinc-500">counting NFTs in the mud…</p>
              )}
              <MudPit
                listings={listings.data?.data ?? []}
                accentColor={collection.data.theme?.accent_color}
              />
              {/* Centered overlay copy on an empty pool. */}
              {listings.data && listings.data.data.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <p className="rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-zinc-300 backdrop-blur">
                    nobody has dumped anything here yet
                  </p>
                </div>
              )}
            </div>

            {/* A subtle stat strip below the pit — pool size + accrued. */}
            {listings.data && listings.data.data.length > 0 && (
              <p className="text-center text-xs text-zinc-500">
                showing a sample of{" "}
                <span className="text-zinc-300">{Math.min(listings.data.data.length, 12)}</span>{" "}
                from{" "}
                <span className="text-zinc-300">{listings.data.total}</span>{" "}
                drowned souls
              </p>
            )}
          </>
        )}
      </main>

      {collection.data && (
        <WalletDrawer
          collectionPolicyId={collection.data.collection_policy_id}
          accentColor={collection.data.theme?.accent_color}
        />
      )}
    </div>
  );
}
