"use client";

import Link from "next/link";
import { use } from "react";

import { nftImageUrl } from "@/lib/api/client";
import { useCollection, useListings, useNftMetadata } from "@/lib/api/hooks";
import type { Listing } from "@/types/api";

type Params = { slug: string };

export default function PitPage({ params }: { params: Promise<Params> }) {
  const { slug } = use(params);
  const collection = useCollection(slug);
  const listings = useListings(slug, { page: 0, size: 50 });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← back to all pits
        </Link>
      </nav>

      {collection.isLoading && (
        <p className="text-sm text-zinc-500">peering into the pit…</p>
      )}
      {collection.error && (
        <p className="text-sm text-red-400" role="alert">
          could not load this pit: {collection.error.message}
        </p>
      )}

      {collection.data && (
        <header className="space-y-3 border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: collection.data.theme.accent_color }}
              aria-hidden
            />
            <h1 className="text-3xl font-semibold tracking-tight">
              {collection.data.display_name}
            </h1>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
            <Stat label="listings" value={collection.data.stats.n_valid_listings} />
            <Stat label="M (buckets)" value={collection.data.config.m} />
            <Stat
              label="protocol fee"
              value={`${(collection.data.config.protocol_fee / 1_000_000).toFixed(2)} ₳`}
            />
            <Stat
              label="lister fee"
              value={`${(collection.data.config.lister_fee / 1_000_000).toFixed(2)} ₳`}
            />
          </dl>
        </header>
      )}

      {listings.isLoading && <p className="text-sm text-zinc-500">counting NFTs…</p>}
      {listings.error && (
        <p className="text-sm text-red-400" role="alert">
          could not load listings: {listings.error.message}
        </p>
      )}

      {listings.data && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {listings.data.data.map((l) => (
            <li key={`${l.utxo_ref.tx_id}#${l.utxo_ref.output_index}`}>
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const nft = useNftMetadata(listing.current_nft_unit);
  const accruedAda = (listing.accrued_lovelace / 1_000_000).toFixed(2);

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="aspect-square bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={nftImageUrl(listing.current_nft_unit, 256)}
          alt={nft.data?.name ?? listing.current_nft_unit}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-sm font-medium text-zinc-100">
          {nft.data?.name ?? "loading…"}
        </p>
        <p className="font-mono text-xs text-zinc-400">accrued {accruedAda} ₳</p>
      </div>
    </article>
  );
}
