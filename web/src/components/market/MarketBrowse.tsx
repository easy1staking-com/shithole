"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ADA_PRICE_UNIT_SENTINEL,
  FilterBar,
  type FilterState,
} from "@/components/market/FilterBar";
import { ListingCard } from "@/components/market/ListingCard";
import { fetchNftMetadata } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/hooks";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import { matchesPool, poolByTicker } from "@/lib/market/poolTraits";
import { isSupportedCollection } from "@/lib/market/supportedCollections";
import { makeClient } from "@/lib/tx/evolutionClient";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Browse view for /market. Steps:
 *   1. Pull every UTxO at the marketplace address (single Blockfrost call).
 *   2. Drop anything outside the {@link isSupportedCollection} whitelist —
 *      HOSKY CashGrab only in v1.
 *   3. Batch-fetch CIP-25 metadata for each remaining listing (uses
 *      React Query under useQueries; deduped against ListingCard's own
 *      useNftMetadata call so each unit is fetched once).
 *   4. Apply the filter bar (currency, pool-traits, sort) to the
 *      decorated list.
 *   5. Render filtered listings.
 */
export function MarketBrowse() {
  const { data: manifest } = useDerivedMarketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);

  const [listings, setListings] = useState<DecodedListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    priceUnit: "",
    poolTicker: "",
    sort: "none",
  });

  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  const refresh = useCallback(async () => {
    if (!marketplaceAddress || !walletApi) return;
    setLoading(true);
    setErr(null);
    try {
      const client = await makeClient(walletApi);
      const found = await fetchMarketListings(client, marketplaceAddress);
      setListings(found);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [marketplaceAddress, walletApi]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Whitelist filter — keep only listings whose listed asset is in a
  // supported collection (HOSKY CashGrab today).
  const onCollection = useMemo<DecodedListing[]>(() => {
    if (!listings) return [];
    return listings.filter((l) => {
      const u = l.listedUnits[0];
      return Boolean(u) && isSupportedCollection(u);
    });
  }, [listings]);

  // Batch-fetch metadata for every visible (whitelisted) listing in
  // parallel. React Query dedupes against ListingCard's own
  // useNftMetadata call so each unit hits the BE once total.
  const metaQueries = useQueries({
    queries: onCollection.map((l) => {
      const unit = l.listedUnits[0] ?? "";
      return {
        queryKey: queryKeys.nft(unit),
        queryFn: () => fetchNftMetadata(unit),
        enabled: Boolean(unit),
        staleTime: 60_000,
      };
    }),
  });

  const decorated = useMemo(() => {
    return onCollection.map((listing, i) => ({
      listing,
      traits: metaQueries[i]?.data?.traits ?? [],
    }));
  }, [onCollection, metaQueries]);

  const visible = useMemo(() => {
    let xs = decorated;

    // Currency filter. ADA's registry unit is empty hex, so we keep a
    // dedicated sentinel to distinguish "ADA only" from "all currencies"
    // (both would otherwise compare against an empty string).
    if (filters.priceUnit !== "") {
      const want =
        filters.priceUnit === ADA_PRICE_UNIT_SENTINEL
          ? ""
          : filters.priceUnit.toLowerCase();
      xs = xs.filter(
        (e) =>
          (
            e.listing.datum.pricePolicyHex + e.listing.datum.priceNameHex
          ).toLowerCase() === want,
      );
    }

    // Pool-traits filter.
    if (filters.poolTicker) {
      const pool = poolByTicker(filters.poolTicker);
      if (pool) {
        xs = xs.filter((e) => matchesPool(e.traits, pool).length > 0);
      }
    }

    // Sort — only when one currency. Across currencies it's nonsense.
    if (filters.sort !== "none" && filters.priceUnit !== "") {
      const factor = filters.sort === "asc" ? 1n : -1n;
      xs = [...xs].sort((a, b) => {
        const d = (a.listing.datum.priceQty - b.listing.datum.priceQty) * factor;
        return d > 0n ? 1 : d < 0n ? -1 : 0;
      });
    }

    return xs;
  }, [decorated, filters]);

  const someMetaLoading = metaQueries.some((q) => q.isLoading);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← home
        </Link>
        <Link href="/market/new" className="hover:text-zinc-300">
          list something →
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">marketplace</h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          HOSKY CashGrab NFTs only (for now). filter by sale currency or
          by the stake-pool trait set you care about — buyers wanting
          delegate-able art can find it.
        </p>
      </header>

      {!manifest ? (
        <ManifestEmptyState />
      ) : (
        <>
          <FilterBar filters={filters} onChange={setFilters} />

          {err ? (
            <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {err}
            </p>
          ) : null}

          {!walletApi ? (
            <p className="text-sm text-zinc-500">connect a wallet to browse.</p>
          ) : loading ? (
            <p className="text-sm text-zinc-500">scanning the marketplace…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {onCollection.length === 0
                ? "no HOSKY CashGrab listings yet — be the first."
                : someMetaLoading
                ? "applying filters…"
                : "no listings match the current filters."}
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                {visible.length} listing{visible.length === 1 ? "" : "s"}
                {onCollection.length !== visible.length
                  ? ` of ${onCollection.length}`
                  : ""}
              </p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visible.map((e) => (
                  <li
                    key={`${e.listing.utxo.txHash}:${e.listing.utxo.outputIndex}`}
                  >
                    <ListingCard listing={e.listing} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}

function ManifestEmptyState() {
  return (
    <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
      <p className="font-medium">marketplace not deployed yet</p>
      <p className="mt-1 text-amber-300/80">
        no jar + marketplace addresses in{" "}
        <code className="rounded bg-zinc-900 px-1 py-0.5">manifest.json</code>{" "}
        or local-storage. head to{" "}
        <Link className="underline" href="/market/dev-tools">
          /market/dev-tools
        </Link>{" "}
        to deploy on the current network.
      </p>
    </div>
  );
}
