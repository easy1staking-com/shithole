"use client";

import { useMemo } from "react";

import { ErrorView } from "@/components/ErrorView";
import { SelectableWalletCard } from "@/components/pit/SelectableWalletCard";
import { useAssetPoolMembership } from "@/lib/api/hooks";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Step 2 of the p2p create flow — MULTI-select NFT picker with pool
 * membership ribbons.
 *
 * <p>Each NFT card shows:
 * <ul>
 *   <li>the standard {@link SelectableWalletCard} (checkbox-style selection)</li>
 *   <li>a small chip strip listing pool tickers whose merkle tree accepts
 *       this asset_name — the currently-selected pool is highlighted as
 *       "primary"; others are muted</li>
 * </ul>
 *
 * <p>"Select unmatched" button: bulk-selects every NFT that is NOT in the
 * currently-selected pool. Mental model: if you're targeting HOSKY-pool
 * delegators and you have 10 NFTs in your wallet, the unmatched ones are
 * the candidates you want to offload (the matched ones are already
 * "well-placed"). One tap, batch them all.
 *
 * <p>NFTs whose merkle-membership lookup is still loading get pending
 * ribbons; failed lookups get nothing. Either way the selection mechanics
 * still work — pool ribbons are decoration, not a gate.
 */
export function NftPickerStep({
  collectionPolicyHex,
  accent,
  selectedPoolTicker,
  selectedUnits,
  onToggle,
  onSetSelection,
}: {
  collectionPolicyHex: string;
  accent: string;
  /** The pool the user picked in Step 1; null if none yet. */
  selectedPoolTicker: string | null;
  /** Currently-selected NFT units (multi-select). */
  selectedUnits: Set<string>;
  /** Toggle a single NFT's selection. */
  onToggle: (nft: WalletCollectionNft) => void;
  /** Replace the entire selection set (used by "select unmatched"). */
  onSetSelection: (units: WalletCollectionNft[]) => void;
}) {
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const {
    data: nfts,
    isPending: nftsPending,
    isError: nftsError,
    error: nftsErrorObj,
  } = useWalletCollectionNfts(addressBech32, collectionPolicyHex);

  const assetNamesHex = useMemo(
    () => (nfts ?? []).map((n) => n.assetNameHex),
    [nfts],
  );
  const membership = useAssetPoolMembership(assetNamesHex);

  if (!addressBech32) {
    return (
      <p className="text-sm text-zinc-400">
        connect your wallet via the chip in the top-right ↗ so we can see
        what s#!t you&apos;re willing to part with.
      </p>
    );
  }

  if (nftsPending) {
    return <p className="text-sm text-zinc-500">peeking inside your wallet…</p>;
  }

  if (nftsError) {
    return <ErrorView error={nftsErrorObj} context={{ subject: "wallet" }} />;
  }

  if (!nfts || nfts.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        your wallet has no s#!t from this pit. either you&apos;re already
        clean or you&apos;re in the wrong pit.
      </p>
    );
  }

  // Compute the "unmatched" set: NFTs whose pool membership does NOT
  // include the selected pool. If membership is still loading we treat
  // all NFTs as unknown (button disabled).
  const membershipReady = !membership.isPending && !!membership.data;
  const unmatched = membershipReady
    ? nfts.filter((n) => {
        const tickers = membership.data?.[n.assetNameHex.toLowerCase()] ?? [];
        return selectedPoolTicker
          ? !tickers.includes(selectedPoolTicker)
          : true;
      })
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {selectedUnits.size === 0
            ? `${nfts.length} in wallet — tap any to add`
            : `${selectedUnits.size} of ${nfts.length} selected`}
        </span>
        <div className="flex gap-2">
          {selectedUnits.size > 0 && (
            <button
              type="button"
              onClick={() => onSetSelection([])}
              className="rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              clear
            </button>
          )}
          <button
            type="button"
            disabled={!selectedPoolTicker || !membershipReady || unmatched.length === 0}
            onClick={() => onSetSelection(unmatched)}
            className="rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
            title={
              !selectedPoolTicker
                ? "pick a pool first"
                : !membershipReady
                  ? "loading pool membership…"
                  : unmatched.length === 0
                    ? "every NFT in your wallet is already in this pool"
                    : `select all ${unmatched.length} NFTs that aren't in ${selectedPoolTicker}`
            }
          >
            select unmatched ({unmatched.length})
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-label="your NFTs from this collection"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
      >
        {nfts.map((nft) => {
          const tickers =
            membership.data?.[nft.assetNameHex.toLowerCase()] ?? [];
          return (
            <NftCardWithRibbon
              key={nft.unit}
              nft={nft}
              accent={accent}
              selected={selectedUnits.has(nft.unit)}
              onToggle={onToggle}
              tickers={tickers}
              membershipReady={membershipReady}
              selectedPoolTicker={selectedPoolTicker}
            />
          );
        })}
      </div>
    </div>
  );
}

function NftCardWithRibbon({
  nft,
  accent,
  selected,
  onToggle,
  tickers,
  membershipReady,
  selectedPoolTicker,
}: {
  nft: WalletCollectionNft;
  accent: string;
  selected: boolean;
  onToggle: (nft: WalletCollectionNft) => void;
  tickers: string[];
  membershipReady: boolean;
  selectedPoolTicker: string | null;
}) {
  // Order tickers so the selected pool (if any) is first.
  const orderedTickers = useMemo(() => {
    if (!selectedPoolTicker) return tickers;
    const primary = tickers.filter((t) => t === selectedPoolTicker);
    const rest = tickers.filter((t) => t !== selectedPoolTicker);
    return [...primary, ...rest];
  }, [tickers, selectedPoolTicker]);

  const isPrimary =
    selectedPoolTicker !== null && tickers.includes(selectedPoolTicker);

  return (
    <div className="flex flex-col gap-1">
      <SelectableWalletCard
        nft={nft}
        accent={accent}
        selected={selected}
        onToggle={onToggle}
      />
      {/* Pool ribbon row. Heights are constant whether membership loads
          or not so the grid doesn't reflow when data arrives. */}
      <div className="flex min-h-[18px] flex-wrap items-center gap-1">
        {!membershipReady ? (
          <span className="h-[14px] w-12 animate-pulse rounded-sm bg-zinc-800/60" />
        ) : orderedTickers.length === 0 ? (
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">
            no pool
          </span>
        ) : (
          orderedTickers.map((ticker) => {
            const isThisOnePrimary =
              ticker === selectedPoolTicker && isPrimary;
            return (
              <span
                key={ticker}
                className={
                  "rounded-sm px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide " +
                  (isThisOnePrimary
                    ? "bg-amber-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400")
                }
                title={
                  isThisOnePrimary
                    ? `accepted by ${ticker} (the pool you're targeting)`
                    : `also accepted by ${ticker}`
                }
              >
                {ticker}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
