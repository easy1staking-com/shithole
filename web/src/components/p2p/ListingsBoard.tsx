"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ErrorView } from "@/components/ErrorView";
import { MultiSelectPopover } from "@/components/p2p/MultiSelectPopover";
import {
  useAssetPoolMembership,
  useCurated,
  useNftMetadata,
  useP2pListings,
  usePools,
} from "@/lib/api/hooks";
import { useWalletCollectionNfts } from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { AssetPoolMembership, P2pListing, Pool } from "@/types/api";

/**
 * /p2p browse — surface every active wanted listing the BE indexer
 * knows about. Optional pool filter narrows by accepted_merkle_root.
 *
 * <p>Cards render the offered NFT's asset_name (ASCII or short hex
 * fallback), the locked deposit in ADA, and pool ribbons for context
 * (which pool's delegators the listing targets). Clicking a card
 * routes to the fulfill page for that listing.
 *
 * <p>For v1 we keep filtering FE-side simple: a pool dropdown that
 * narrows via the BE's {@code root} query param when a single pool is
 * picked. "All pools" sends no filter (returns global active list).
 */
export function ListingsBoard() {
  const searchParams = useSearchParams();
  const configFilter = searchParams.get("config");
  const { data: pools, isPending: poolsPending } = usePools();
  const [filterTicker, setFilterTicker] = useState<string | null>(null);
  const [onlyFulfillable, setOnlyFulfillable] = useState(false);
  // "Include pools" — when non-empty, only show listings whose OFFERED NFT
  // belongs to at least one selected pool. Mental model: the seller is
  // interested in receiving NFTs from THESE pools (because they collect
  // those traits, or they plan to delegate there). Different from
  // "fulfillable" — that filters by what the seller can deposit; this
  // filters by what they'd receive.
  const [includedTickers, setIncludedTickers] = useState<Set<string>>(
    () => new Set(),
  );

  const filterRoot = useMemo(() => {
    if (!pools || !filterTicker) return null;
    return pools.find((p) => p.ticker === filterTicker)?.merkle_root_hex ?? null;
  }, [pools, filterTicker]);

  const {
    data: listings,
    isPending,
    isError,
    error,
  } = useP2pListings(
    filterRoot
      ? { config: configFilter ?? undefined, roots: [filterRoot] }
      : { config: configFilter ?? undefined },
  );

  // ---- "I can fulfill" data plumbing ----
  // For v3 launch p2p is Hosky-only; pick the first curated collection's
  // policy id to scope the wallet-NFT lookup. When p2p expands to more
  // collections we'd union across all of them.
  const { data: curated, isPending: curatedPending } = useCurated();
  const collectionPolicyHex = curated?.[0]?.collection_policy_id ?? null;
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const { data: walletNfts, isPending: walletNftsPending } =
    useWalletCollectionNfts(addressBech32, collectionPolicyHex);
  const walletAssetNamesHex = useMemo(
    () => (walletNfts ?? []).map((n) => n.assetNameHex),
    [walletNfts],
  );
  const {
    data: walletMembership,
    isSuccess: membershipSuccess,
    isError: membershipError,
  } = useAssetPoolMembership(walletAssetNamesHex);
  // myMatchableTickers = union of all pool tickers any of the wallet's NFTs
  // belong to. A listing is matchable iff its target ticker is in this set.
  const myMatchableTickers = useMemo(() => {
    const out = new Set<string>();
    if (!walletMembership) return out;
    for (const tickers of Object.values(walletMembership)) {
      for (const t of tickers) out.add(t);
    }
    return out;
  }, [walletMembership]);
  // root_hex → ticker, used to resolve each listing's target pool
  // ticker on the fly without re-fetching per row.
  const rootToTicker = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of pools ?? []) m[p.merkle_root_hex] = p.ticker;
    return m;
  }, [pools]);

  // ---- offered-NFT pool memberships ----
  // For the "include pools" filter we need to know which pools each
  // listing's OFFERED NFT belongs to. Fetch once at the page level —
  // ListingsList re-uses the same data for its per-card pool ribbons.
  const offeredAssetNamesHex = useMemo(
    () => (listings ?? []).map((l) => l.offered_nft_unit.slice(56)),
    [listings],
  );
  const { data: offeredMembership } = useAssetPoolMembership(offeredAssetNamesHex);

  // Apply client-side filters. The BE-side `pool` filter narrows the
  // initial fetch; these run on top of that result.
  const filteredListings = useMemo(() => {
    if (!listings) return null;
    return listings.filter((l) => {
      const targetTicker = rootToTicker[l.accepted_merkle_root];

      // "Only listings I can fulfill" — listing's target pool must be in
      // the union of pools any of the wallet's NFTs belong to.
      if (onlyFulfillable && targetTicker && !myMatchableTickers.has(targetTicker)) {
        return false;
      }

      // "Include pools" — the listing's OFFERED NFT (what the seller
      // would receive) must belong to at least one selected pool.
      if (includedTickers.size > 0) {
        const offeredName = l.offered_nft_unit.slice(56).toLowerCase();
        const offeredTickers = offeredMembership?.[offeredName] ?? [];
        if (!offeredTickers.some((t) => includedTickers.has(t))) {
          return false;
        }
      }

      return true;
    });
  }, [
    listings,
    rootToTicker,
    onlyFulfillable,
    myMatchableTickers,
    includedTickers,
    offeredMembership,
  ]);

  const toggleIncluded = (ticker: string) => {
    setIncludedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  // "I can fulfill" toggle is only useful with a connected wallet AND
  // once we know what's in the wallet. Settled = either the membership
  // query succeeded OR errored (BE down, network blip — let the user
  // still toggle; myMatchableTickers will just be empty). Don't gate on
  // `data !== undefined`: useAssetPoolMembership short-circuits with
  // enabled=false on empty input (wallet has zero NFTs in collection),
  // and `data` stays undefined forever in error cases too.
  const walletEmpty = (walletNfts?.length ?? 0) === 0;
  const membershipSettled =
    walletEmpty || membershipSuccess || membershipError;
  const fulfillableLoading =
    curatedPending || walletNftsPending || !membershipSettled;
  const fulfillableDisabled = !addressBech32 || fulfillableLoading;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          open listings — idiots looking to swap
        </h1>
        <p className="text-sm text-zinc-400">
          someone locked an NFT, hoping a delegator with matching traits
          takes it off their hands. that&apos;s you, maybe.
        </p>
      </header>

      {/* Pool filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-zinc-500">
          pool:
        </span>
        <button
          type="button"
          onClick={() => setFilterTicker(null)}
          className={
            "rounded-md border px-2 py-1 text-xs " +
            (filterTicker === null
              ? "border-amber-500 bg-amber-950/40 text-amber-200"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-600")
          }
        >
          all
        </button>
        {poolsPending && (
          <span className="text-xs text-zinc-500">loading pools…</span>
        )}
        {(pools ?? []).map((p) => (
          <button
            key={p.ticker}
            type="button"
            onClick={() => setFilterTicker(p.ticker)}
            className={
              "rounded-md border px-2 py-1 font-mono text-xs " +
              (p.ticker === filterTicker
                ? "border-amber-500 bg-amber-950/40 text-amber-200"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-600")
            }
          >
            {p.ticker}
          </button>
        ))}
      </div>

      {/* Seller-mode filters: explicit, both compose with the pool filter. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-zinc-500">
          filters:
        </span>
        <label
          className={
            "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs " +
            (onlyFulfillable
              ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
              : "border-zinc-800 text-zinc-400 hover:border-zinc-600") +
            (fulfillableDisabled ? " cursor-not-allowed opacity-50" : "")
          }
          title={
            !addressBech32
              ? "connect your wallet to enable"
              : fulfillableLoading
                ? "loading your NFTs…"
                : "show only listings whose target pool matches one of your NFTs"
          }
        >
          <input
            type="checkbox"
            checked={onlyFulfillable}
            disabled={fulfillableDisabled}
            onChange={(e) => setOnlyFulfillable(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          only listings I can fulfill
        </label>
        <MultiSelectPopover
          label="include pools"
          options={(pools ?? []).map((p) => ({ value: p.ticker, label: p.ticker }))}
          selected={includedTickers}
          onToggle={toggleIncluded}
          onClear={() => setIncludedTickers(new Set())}
        />
      </div>

      {/* Included chip strip — appears only when there's something to show. */}
      {includedTickers.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">
            interested in NFTs from:
          </span>
          {[...includedTickers].sort().map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleIncluded(t)}
              className="rounded-sm bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-200 hover:bg-amber-900/40"
              title={`remove ${t} from interest set`}
            >
              {t} <span className="text-amber-200/60">×</span>
            </button>
          ))}
        </div>
      )}

      {isPending && <p className="text-sm text-zinc-500">looking for listings…</p>}
      {isError && <ErrorView error={error} context={{ subject: "listings" }} />}
      {filteredListings && filteredListings.length === 0 && (
        <EmptyState
          filterTicker={filterTicker}
          onlyFulfillable={onlyFulfillable}
          includedCount={includedTickers.size}
          serverEmpty={(listings ?? []).length === 0}
        />
      )}
      {filteredListings && filteredListings.length > 0 && (
        <ListingsList
          listings={filteredListings}
          pools={pools ?? []}
          offeredMembership={offeredMembership}
        />
      )}
    </div>
  );
}

function EmptyState({
  filterTicker,
  onlyFulfillable,
  includedCount,
  serverEmpty,
}: {
  filterTicker: string | null;
  onlyFulfillable: boolean;
  includedCount: number;
  /** True when the BE returned 0 listings (vs. filters narrowed to 0). */
  serverEmpty: boolean;
}) {
  // Pick the explanation that best matches WHY the list is empty so the
  // user knows whether to relax filters or create a listing themselves.
  const filtersActive = onlyFulfillable || includedCount > 0;
  const headline = serverEmpty
    ? filterTicker
      ? `no open listings targeting ${filterTicker}`
      : "no open listings yet"
    : filtersActive
      ? "no listings match your filters"
      : filterTicker
        ? `no open listings targeting ${filterTicker}`
        : "no open listings yet";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-6 text-sm text-zinc-400">
      <p className="font-medium text-zinc-200">{headline}</p>
      <p className="mt-1 text-zinc-500">
        {filtersActive && !serverEmpty
          ? "relax the filters above, or "
          : "be the first to "}
        <Link
          href="/p2p/new"
          className="text-zinc-300 underline-offset-2 hover:underline"
        >
          create one
        </Link>
        .
      </p>
    </div>
  );
}

function ListingsList({
  listings,
  pools,
  offeredMembership,
}: {
  listings: P2pListing[];
  pools: Pool[];
  /** Hoisted from the parent so the include-pools filter and the card
   *  ribbons share one query result. */
  offeredMembership: AssetPoolMembership | undefined;
}) {
  const tickerToRoot = useMemo(
    () =>
      Object.fromEntries(
        pools.map((p) => [p.ticker, p.merkle_root_hex] as const),
      ),
    [pools],
  );
  const rootToTicker = useMemo(
    () =>
      Object.fromEntries(
        pools.map((p) => [p.merkle_root_hex, p.ticker] as const),
      ),
    [pools],
  );

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {listings.map((l) => (
        <li key={`${l.tx_hash}#${l.output_index}`}>
          <ListingCard
            listing={l}
            tickers={
              offeredMembership?.[l.offered_nft_unit.slice(56).toLowerCase()] ??
              []
            }
            targetTicker={rootToTicker[l.accepted_merkle_root] ?? null}
            tickerToRoot={tickerToRoot}
          />
        </li>
      ))}
    </ul>
  );
}

function ListingCard({
  listing,
  tickers,
  targetTicker,
  tickerToRoot,
}: {
  listing: P2pListing;
  tickers: string[];
  targetTicker: string | null;
  tickerToRoot: Record<string, string>;
}) {
  void tickerToRoot; // reserved for a future "deep link to pool" affordance
  const meta = useNftMetadata(listing.offered_nft_unit);
  const name =
    meta.data?.name ?? asciiOrShortHex(listing.offered_nft_unit.slice(56));
  const imageUrl = meta.data?.image_url ?? null;
  const depositAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);
  // Tooltip breaks the locked ADA into its actual fates. Assumes the
  // collection's protocol_fee is ~1 ADA (true for v1 Hosky; a per-
  // collection lookup would tighten this when more collections come
  // online). The constants match DepositStep's ESTIMATED_BUYER_OUTPUT_MIN
  // (1.4) + ESTIMATED_TX_FEE (0.4); anything left over is the seller's
  // tx-fee cushion (not a tip).
  const chipTitle =
    `${depositAda} ADA locked by the buyer — covers chain costs only.\n` +
    `at swap time: 1 ADA → treasury, ~1.4 → returned to buyer w/ NFT, ~0.4 → seller's tx fee.\n` +
    `you get their NFT.`;
  // The offered NFT may carry traits for multiple pools; show all of
  // them in the "matches traits of" row. The target pool gets its own
  // row below ("wants traits of") so the two semantics are visually
  // separated — even if the offered NFT happens to also be in the
  // target pool's tree (unusual, but possible), the target ribbon
  // stays in its own row.
  const offeredTickers = tickers.filter((t) => t !== targetTicker);

  return (
    <Link
      href={`/p2p/${listing.tx_hash}/${listing.output_index}`}
      className="block overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40 transition hover:border-zinc-600"
    >
      <div className="relative aspect-square bg-zinc-900">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-zinc-600">
            …
          </div>
        )}
        {/* Chip shows the locked deposit — the listing's only ADA leg.
         *  Tooltip explains it covers chain costs only; the actual
         *  "what you get" is the offered NFT, prominent below. */}
        <span
          title={chipTitle}
          className="absolute right-2 top-2 flex flex-col items-end rounded-md bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur"
        >
          <span className="font-semibold text-amber-300">
            {depositAda} ADA deposit
          </span>
          <span className="text-[9px] text-zinc-500">
            covers chain costs
          </span>
        </span>
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate font-mono text-sm font-semibold">{name}</p>

        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-500">
            matches traits of
          </p>
          <div className="mt-0.5 flex min-h-[16px] flex-wrap gap-1">
            {offeredTickers.length > 0 ? (
              offeredTickers.map((t) => (
                <span
                  key={t}
                  className="rounded-sm bg-zinc-800 px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide text-zinc-300"
                >
                  {t}
                </span>
              ))
            ) : (
              <span className="text-[9px] uppercase tracking-wider text-zinc-700">
                no curated pool
              </span>
            )}
          </div>
        </div>

        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-500">
            wants traits of
          </p>
          <div className="mt-0.5 flex min-h-[16px] flex-wrap gap-1">
            <span
              className={
                "rounded-sm px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide " +
                (targetTicker
                  ? "bg-amber-500 text-zinc-950"
                  : "bg-zinc-800 text-zinc-500")
              }
            >
              {targetTicker ?? "unknown pool"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * Best-effort ASCII decode of a 0-32-byte CIP-25 asset_name. Falls back to
 * an 8-char hex preview when the bytes contain non-printable characters.
 */
function asciiOrShortHex(assetNameHex: string): string {
  if (!assetNameHex) return "(no name)";
  const bytes = new Uint8Array(assetNameHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(assetNameHex.slice(i * 2, i * 2 + 2), 16);
  }
  // CIP-25 asset names that hold ASCII tend to be printable [0x20..0x7e].
  const allPrintable = bytes.every((b) => b >= 0x20 && b <= 0x7e);
  if (allPrintable) {
    return new TextDecoder().decode(bytes);
  }
  return `${assetNameHex.slice(0, 8)}…${assetNameHex.slice(-4)}`;
}
