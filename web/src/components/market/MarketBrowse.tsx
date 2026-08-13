"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  ADA_PRICE_UNIT_SENTINEL,
  FilterBar,
  type FilterState,
} from "@/components/market/FilterBar";
import { CollectionActivityFeed } from "@/components/market/CollectionActivityFeed";
import { CollectionStatsStrip } from "@/components/market/CollectionStatsStrip";
import { CollectionTabs } from "@/components/market/CollectionTabs";
import { ListingCard } from "@/components/market/ListingCard";
import { MarketNav } from "@/components/market/MarketNav";
import { ErrorView } from "@/components/ErrorView";
import { fetchNftMetadata } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/hooks";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { type DecodedListing } from "@/lib/market/queryListings";
import { useMarketListings } from "@/lib/market/useMarketListings";
import { matchesPool, poolByTicker } from "@/lib/market/poolTraits";
import {
  isSupportedCollection,
  supportedCollections,
} from "@/lib/market/supportedCollections";
import { supportedPriceTokens } from "@/lib/market/supportedPriceTokens";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Browse view for /market. Steps:
 *   1. Pull every UTxO at the marketplace address via the PUBLIC read
 *      client ({@link useMarketListings}) — browsing needs no wallet.
 *   2. Drop anything outside the {@link isSupportedCollection} whitelist.
 *   3. Optional collection tab (?c=policy) narrows to one collection and
 *      unlocks its stats strip + activity feed.
 *   4. Batch-fetch CIP-25 metadata; apply the filter bar (currency,
 *      pool-traits, sort); render.
 */
export function MarketBrowse() {
  const { data: manifest, loading: manifestLoading } =
    useDerivedMarketplaceManifest();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { listings, loading, error: err } = useMarketListings();

  // Default the browse view to all currencies, cheapest first. The sort
  // works across currencies by comparing human-readable amounts (see the
  // `visible` memo below), so it no longer needs a single currency picked.
  const [filters, setFilters] = useState<FilterState>({
    priceUnit: "",
    poolTicker: "",
    sort: "asc",
  });

  // Selected collection tab — URL-synced (?c=policy) so the landing strips
  // can deep-link into a filtered browse. Validated against the whitelist.
  const selectedCollection = useMemo(() => {
    const c = searchParams.get("c")?.toLowerCase() ?? null;
    if (!c) return null;
    return supportedCollections().some((x) => x.policyId.toLowerCase() === c)
      ? c
      : null;
  }, [searchParams]);

  const onSelectCollection = useCallback(
    (policyId: string | null) => {
      router.replace(policyId ? `/market?c=${policyId.toLowerCase()}` : "/market", {
        scroll: false,
      });
    },
    [router],
  );

  // listings | activity — activity only meaningful for a single collection.
  const [view, setView] = useState<"listings" | "activity">("listings");
  const activeView = selectedCollection ? view : "listings";

  // Whitelist filter — keep only listings whose listed asset is in a
  // supported collection; then narrow to the selected tab if any.
  const onCollection = useMemo<DecodedListing[]>(() => {
    if (!listings) return [];
    return listings.filter((l) => {
      const u = l.listedUnits[0];
      if (!u || !isSupportedCollection(u)) return false;
      return selectedCollection
        ? u.slice(0, 56).toLowerCase() === selectedCollection
        : true;
    });
  }, [listings, selectedCollection]);

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

    // Sort by price. Works across currencies by comparing the
    // *human-readable* amount (raw on-chain qty ÷ 10^decimals) rather
    // than the raw qty — otherwise a 0-decimal token (HOSKY) and a
    // 6-decimal one (ADA/USDM) aren't comparable at all (10 ADA is
    // 10_000_000 raw lovelace vs 100 HOSKY at 100 raw). This is still
    // apples-to-oranges across tokens (no FX conversion), but it gives a
    // stable, intuitive cheapest-first ordering instead of creation order.
    if (filters.sort !== "none") {
      const decByUnit = new Map(
        supportedPriceTokens().map((t) => [t.unit.toLowerCase(), t.decimals]),
      );
      const amountOf = (l: DecodedListing): number => {
        const unit = (
          l.datum.pricePolicyHex + l.datum.priceNameHex
        ).toLowerCase();
        const decimals = decByUnit.get(unit) ?? 0;
        return Number(l.datum.priceQty) / 10 ** decimals;
      };
      const factor = filters.sort === "asc" ? 1 : -1;
      xs = [...xs].sort(
        (a, b) => (amountOf(a.listing) - amountOf(b.listing)) * factor,
      );
    }

    return xs;
  }, [decorated, filters]);

  const someMetaLoading = metaQueries.some((q) => q.isLoading);
  const collectionCount = supportedCollections().length;

  // How many of the live (whitelisted, any collection) listings belong to
  // the connected wallet — surfaces a "manage yours" shortcut to /market/me.
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const myCount = useMemo(() => {
    if (!walletPkh || !listings) return 0;
    const me = walletPkh.toLowerCase();
    return listings.filter(
      (l) =>
        (l.listedUnits[0] ? isSupportedCollection(l.listedUnits[0]) : false) &&
        l.datum.sellerPkhHex.toLowerCase() === me,
    ).length;
  }, [walletPkh, listings]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-12">
      <MarketNav back={{ href: "/", label: "← home" }} />

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">marketplace</h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          {collectionCount > 1
            ? `${collectionCount} dead collections and counting. pick one for its stats + activity, `
            : "dead collections only. "}
          filter by sale currency or by the stake-pool trait set you care
          about — buyers wanting delegate-able art can find it.
        </p>
      </header>

      {!manifest ? (
        manifestLoading ? (
          <p className="text-sm text-zinc-500">scanning the marketplace…</p>
        ) : (
          <ManifestEmptyState />
        )
      ) : (
        <>
          {myCount > 0 ? (
            <Link
              href="/market/me"
              className="flex items-center justify-between rounded-lg border border-amber-900/60 bg-amber-950/20 px-3.5 py-2 text-sm text-amber-200 transition hover:border-amber-700"
            >
              <span>
                you have <b className="font-mono">{myCount}</b> listing
                {myCount === 1 ? "" : "s"} live here (marked{" "}
                <span className="rounded bg-amber-500/90 px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                  yours
                </span>
                )
              </span>
              <span className="font-mono text-xs uppercase tracking-widest">
                manage / delist →
              </span>
            </Link>
          ) : null}

          <CollectionTabs
            selected={selectedCollection}
            onSelect={onSelectCollection}
          />

          {selectedCollection ? (
            <>
              <CollectionStatsStrip policyId={selectedCollection} />
              <div className="flex gap-1 border-b border-zinc-900">
                <ViewTab
                  label="listings"
                  active={activeView === "listings"}
                  onClick={() => setView("listings")}
                />
                <ViewTab
                  label="activity"
                  active={activeView === "activity"}
                  onClick={() => setView("activity")}
                />
              </div>
            </>
          ) : null}

          {activeView === "activity" && selectedCollection ? (
            <CollectionActivityFeed policyId={selectedCollection} />
          ) : (
            <>
              <FilterBar filters={filters} onChange={setFilters} />

              {err ? (
                <ErrorView error={err} context={{ subject: "listings" }} />
              ) : null}

              {loading || listings === null ? (
                <p className="text-sm text-zinc-500">scanning the marketplace…</p>
              ) : visible.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {onCollection.length === 0
                    ? "no live listings here yet — be the first."
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
        </>
      )}
    </main>
  );
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors ${
        active
          ? "border-sky-500 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
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
