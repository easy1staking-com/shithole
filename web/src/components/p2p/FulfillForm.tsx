"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import {
  ConfirmationChip,
  type ChainConfirmation,
} from "@/components/ConfirmationChip";
import { ErrorView } from "@/components/ErrorView";
import { Notice } from "@/components/Notice";
import { MultiSelectPopover } from "@/components/p2p/MultiSelectPopover";
import { SelectableWalletCard } from "@/components/pit/SelectableWalletCard";
import { describeError } from "@/lib/errors";
import {
  useAssetPoolMembership,
  useCurated,
  useCollection,
  useP2pListings,
  usePoolByRoot,
  usePools,
  useProof,
} from "@/lib/api/hooks";
import { useRefreshHistory } from "@/lib/me/useRefreshHistory";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { fetchUtxoByOutRef, findConfigUtxo } from "@/lib/tx/swap";
import { submitFulfillP2p } from "@/lib/tx/fulfillP2p";
import { makeClient } from "@/lib/tx/evolutionClient";
import { addressViewToBech32 } from "@/lib/util/addressView";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { P2pListing } from "@/types/api";

/**
 * Seller-side fulfill form. Loads the listing by outref via the BE
 * (instead of a chain query), so we have decoded WantedDatum fields
 * already without re-decoding client-side.
 */
export function FulfillForm({
  txHash,
  outputIndex,
}: {
  txHash: string;
  outputIndex: number;
}) {
  // The /p2p/listings endpoint returns active+filterable; we don't have
  // a "by outref" endpoint yet, so as a quick approach we pull active
  // listings and find ours. For v1 with small open-listing volume this
  // is fine; revisit when listings count >> 50.
  const { data: listings, isPending, isError, error } = useP2pListings({ size: 100 });
  const listing = useMemo(
    () =>
      listings?.find(
        (l) => l.tx_hash === txHash && l.output_index === outputIndex,
      ),
    [listings, txHash, outputIndex],
  );

  if (isPending) return <p className="text-sm text-zinc-500">looking up the listing…</p>;
  if (isError) {
    return (
      <p className="text-sm text-red-400" role="alert">
        couldn&apos;t load: {error.message}
      </p>
    );
  }
  if (!listing) {
    return (
      <div className="space-y-2">
        <Notice severity="warning" title="This offer's gone">
          Someone already filled it, or the seller reclaimed it. Grab another.
        </Notice>
        <Link href="/p2p" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← back to open listings
        </Link>
      </div>
    );
  }
  return <FulfillStage listing={listing} />;
}

function FulfillStage({ listing }: { listing: P2pListing }) {
  const targetPool = usePoolByRoot(listing.accepted_merkle_root);
  // Map listing.config_nft_policy → curated slug → CollectionState. We
  // need the collection envelope for protocol_fee + treasury.
  const { data: curated } = useCurated();
  const slug = useMemo(
    () =>
      curated?.find((c) => c.config_nft_policy === listing.config_nft_policy)
        ?.slug ?? null,
    [curated, listing.config_nft_policy],
  );
  const collection = useCollection(slug ?? "");

  if (!slug) {
    return (
      <p className="text-sm text-zinc-500">
        finding the collection for this listing…
      </p>
    );
  }
  if (collection.isPending) {
    return <p className="text-sm text-zinc-500">looking up the pit…</p>;
  }
  if (collection.isError || !collection.data) {
    return (
      <p className="text-sm text-red-400" role="alert">
        couldn&apos;t load the collection&apos;s config.
      </p>
    );
  }

  return (
    <FulfillBody
      listing={listing}
      targetPoolTicker={targetPool.data?.ticker ?? null}
      protocolFeeLovelace={BigInt(collection.data.config.protocol_fee)}
      treasuryAddr={collection.data.config.treasury_addr}
    />
  );
}

function FulfillBody({
  listing,
  targetPoolTicker,
  protocolFeeLovelace,
  treasuryAddr,
}: {
  listing: P2pListing;
  targetPoolTicker: string | null;
  protocolFeeLovelace: bigint;
  treasuryAddr: import("@/types/api").AddressView;
}) {
  // Walk the curated → collection chain to find the config (protocol_fee
  // + treasury + collection_policy_id) for this listing.
  const collectionPolicyHex = listing.offered_nft_unit.slice(0, 56);

  // The wallet picker queries by collection_policy_id; we already have it.
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const api = useWalletStore((s) => s.api);
  const { data: walletNfts, isPending: walletPending } =
    useWalletCollectionNfts(addressBech32, collectionPolicyHex);
  const [selected, setSelected] = useState<WalletCollectionNft | null>(null);

  // Pool membership for every wallet NFT — drives both the ribbon row
  // (which pools accept this NFT) and the greying logic (NFT is only
  // depositable if its tickers include the listing's target pool).
  const walletAssetNamesHex = useMemo(
    () => (walletNfts ?? []).map((n) => n.assetNameHex),
    [walletNfts],
  );
  const { data: membership, isPending: membershipPending } =
    useAssetPoolMembership(walletAssetNamesHex);
  const membershipReady = !membershipPending && !!membership;

  // Pool catalog for the exclude-pools dropdown options. We filter to
  // pools the user has at least one NFT in — excluding HOSKY when you
  // have zero HOSKY-eligible NFTs would be noise.
  const { data: pools } = usePools();
  const walletTickers = useMemo(() => {
    const out = new Set<string>();
    if (!membership) return out;
    for (const tickers of Object.values(membership)) {
      for (const t of tickers) out.add(t);
    }
    return out;
  }, [membership]);
  const excludeOptions = useMemo(
    () =>
      (pools ?? [])
        .filter((p) => walletTickers.has(p.ticker))
        // The target pool is never an "exclude" candidate: excluding the
        // pool you're trying to fulfill would just grey out every NFT.
        .filter((p) => p.ticker !== targetPoolTicker)
        .map((p) => ({ value: p.ticker, label: p.ticker })),
    [pools, walletTickers, targetPoolTicker],
  );

  // "Exclude pools" — when non-empty, NFTs whose ticker set intersects
  // these are greyed and unselectable. Mental model: "I'm fine swapping
  // most of my NFTs, but NOT ones I keep for X-pool rewards."
  const [excludedTickers, setExcludedTickers] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleExcluded = (ticker: string) => {
    setExcludedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };
  // If the currently-selected NFT is in an excluded pool (user toggled
  // pools after picking), treat it as unselected so submit can't fire.
  // Derive instead of useEffect+setSelected — cleaner re: render cycles.
  const effectiveSelected = useMemo(() => {
    if (!selected) return null;
    if (!membership) return selected;
    const tickers = membership[selected.assetNameHex.toLowerCase()] ?? [];
    if (tickers.some((t) => excludedTickers.has(t))) return null;
    return selected;
  }, [selected, membership, excludedTickers]);

  // Proof for the chosen NFT against the listing's merkle root. Empty
  // means the wallet's NFT doesn't qualify; UI guides the user away.
  const proofQuery = useProof(
    listing.accepted_merkle_root,
    effectiveSelected?.assetNameHex ?? "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitResult, setSubmitResult] = useState<{ txHash: string } | null>(
    null,
  );
  // Two-axis status, mirroring the pit swap (`/pit/[slug]/page.tsx`):
  // submitResult flips on submit success; `confirmation` tracks the
  // independent chain-side state via Evolution's awaitTx.
  const [confirmation, setConfirmation] = useState<ChainConfirmation>(null);
  const queryClient = useQueryClient();
  const refreshHistory = useRefreshHistory();

  // Each wallet NFT is depositable iff (a) the target pool accepts it
  // and (b) none of its other pools are in the user's exclude set.
  // We compute the per-NFT verdict once so the picker and the count
  // chip stay in sync.
  type Verdict = {
    disabled: boolean;
    reason: string | null;
    tickers: string[];
  };
  const verdicts: Map<string, Verdict> = useMemo(() => {
    const m = new Map<string, Verdict>();
    for (const nft of walletNfts ?? []) {
      const tickers = membership?.[nft.assetNameHex.toLowerCase()] ?? [];
      if (!membershipReady) {
        m.set(nft.unit, { disabled: false, reason: null, tickers });
        continue;
      }
      if (targetPoolTicker && !tickers.includes(targetPoolTicker)) {
        m.set(nft.unit, {
          disabled: true,
          reason: `not accepted by ${targetPoolTicker}`,
          tickers,
        });
        continue;
      }
      const hitsExcluded = tickers.find((t) => excludedTickers.has(t));
      if (hitsExcluded) {
        m.set(nft.unit, {
          disabled: true,
          reason: `excluded — also in ${hitsExcluded}`,
          tickers,
        });
        continue;
      }
      m.set(nft.unit, { disabled: false, reason: null, tickers });
    }
    return m;
  }, [walletNfts, membership, membershipReady, targetPoolTicker, excludedTickers]);

  const eligibleCount = useMemo(() => {
    let n = 0;
    for (const v of verdicts.values()) if (!v.disabled) n++;
    return n;
  }, [verdicts]);

  const onSubmit = useCallback(async () => {
    if (!effectiveSelected || !proofQuery.data || !api || !addressBech32) {
      setSubmitError("missing pieces — wallet, proof, or NFT");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const network = toEvolutionNetwork(getNetworkName());
      const client = await makeClient(api);
      const [listingUtxo, configRefUtxo] = await Promise.all([
        fetchUtxoByOutRef(client, listing.tx_hash, listing.output_index),
        findConfigUtxo(client, network, listing.config_nft_policy),
      ]);
      const treasuryBech32 = addressViewToBech32(treasuryAddr, network);
      const result = await submitFulfillP2p(client, {
        network,
        configRefUtxo,
        treasuryAddrBech32: treasuryBech32,
        protocolFeeLovelace,
        configNftPolicyHex: listing.config_nft_policy,
        listingUtxo,
        buyerBech32Address: listing.buyer_address_bech32,
        depositNftUnit: effectiveSelected.unit,
        merkleProof: proofQuery.data.proof.map((s) => ({
          side: s.side,
          hashHex: s.hash_hex,
        })),
      });
      setSubmitResult(result);
      setConfirmation("confirming");
      // Background-wait for chain confirmation. BE indexer reads on
      // confirmation, so invalidate active-listing + wallet queries
      // only after the chain actually lands it.
      awaitTxConfirmation(client, result.txHash)
        .then(() => {
          setConfirmation("confirmed");
          queryClient.invalidateQueries({ queryKey: ["p2pListings"] });
          queryClient.invalidateQueries({
            queryKey: ["walletCollection", addressBech32, collectionPolicyHex],
          });
          refreshHistory();
        })
        .catch((chainErr) => {
          const chainMsg =
            describeError(chainErr);
          console.warn("p2p fulfill chain did not confirm:", chainMsg);
          setConfirmation("rejected");
        });
    } catch (e) {
      setSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  }, [
    effectiveSelected,
    proofQuery.data,
    api,
    addressBech32,
    listing,
    protocolFeeLovelace,
    treasuryAddr,
    collectionPolicyHex,
    queryClient,
  ]);

  if (!addressBech32) {
    return (
      <div className="space-y-4">
        <ListingSummary listing={listing} targetPoolTicker={targetPoolTicker} />
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
          <p className="text-sm text-zinc-400">
            connect your wallet via the chip in the top-right ↗ to see if any
            of your NFTs match this listing&apos;s accepted pool.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ListingSummary listing={listing} targetPoolTicker={targetPoolTicker} />

      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">pick the NFT to deposit</h2>
          {(walletNfts?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">
                {membershipReady
                  ? `${eligibleCount} of ${walletNfts?.length ?? 0} can fulfill`
                  : "loading pool data…"}
              </span>
              {excludeOptions.length > 0 && (
                <MultiSelectPopover
                  label="exclude pools"
                  options={excludeOptions}
                  selected={excludedTickers}
                  onToggle={toggleExcluded}
                  onClear={() => setExcludedTickers(new Set())}
                />
              )}
            </div>
          )}
        </div>

        {excludedTickers.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">
              keeping NFTs from:
            </span>
            {[...excludedTickers].sort().map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleExcluded(t)}
                className="rounded-sm bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-200 hover:bg-amber-900/40"
                title={`stop excluding ${t}`}
              >
                {t} <span className="text-amber-200/60">×</span>
              </button>
            ))}
          </div>
        )}

        {walletPending && <p className="text-sm text-zinc-500">peeking inside your wallet…</p>}
        {!walletPending && (walletNfts?.length ?? 0) === 0 && (
          <p className="text-sm text-zinc-500">
            no NFTs from this collection in your wallet.
          </p>
        )}
        {(walletNfts?.length ?? 0) > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {walletNfts!.map((nft) => {
              const v = verdicts.get(nft.unit) ?? {
                disabled: false,
                reason: null,
                tickers: [],
              };
              return (
                <NftCardWithRibbon
                  key={nft.unit}
                  nft={nft}
                  accent="#ff8c1a"
                  selected={effectiveSelected?.unit === nft.unit}
                  disabled={v.disabled}
                  disabledReason={v.reason}
                  onToggle={() => setSelected(nft)}
                  tickers={v.tickers}
                  membershipReady={membershipReady}
                  targetPoolTicker={targetPoolTicker}
                  excludedTickers={excludedTickers}
                />
              );
            })}
          </div>
        )}
        {effectiveSelected && (
          <ProofStatus
            isPending={proofQuery.isPending}
            isError={proofQuery.isError}
            proofMissing={
              !proofQuery.isPending && !proofQuery.isError && !proofQuery.data
            }
            ready={Boolean(proofQuery.data)}
            targetPool={targetPoolTicker}
          />
        )}
      </section>

      {submitResult ? (
        <FulfillSuccess
          txHash={submitResult.txHash}
          offeredUnit={listing.offered_nft_unit}
          confirmation={confirmation}
        />
      ) : (
        <button
          type="button"
          disabled={!effectiveSelected || !proofQuery.data || submitting}
          onClick={onSubmit}
          className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {submitting
            ? "submitting…"
            : !effectiveSelected
              ? "pick an NFT first"
              : !proofQuery.data
                ? proofQuery.isPending
                  ? "checking proof…"
                  : "this NFT doesn't qualify"
                : "fulfill — make the swap"}
        </button>
      )}
      {submitError ? (
        <ErrorView
          error={submitError}
          context={{ action: "fulfilled", subject: "offer" }}
        />
      ) : null}
    </div>
  );
}

function ListingSummary({
  listing,
  targetPoolTicker,
}: {
  listing: P2pListing;
  targetPoolTicker: string | null;
}) {
  const depositAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);
  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
      <h2 className="text-base font-medium">the listing</h2>
      <dl className="space-y-1 text-xs">
        <Row label="offered" value={listing.offered_nft_unit.slice(56) || "(empty asset)"} mono />
        <Row label="deposit" value={`${depositAda} ADA`} mono />
        <Row label="target pool" value={targetPoolTicker ?? "unknown"} mono />
        <Row label="buyer" value={`${listing.buyer_pkh.slice(0, 12)}…`} mono />
      </dl>
      {/* Inline risk disclosure for the seller side. The swap is atomic
          and final; once you sign you've given up the deposited NFT.
          Permissionless contract — counterparty could be anyone. */}
      <p className="pt-2 text-[11px] leading-snug text-zinc-500">
        the swap is atomic and final — no refunds, no take-backs. the
        listed offer could have been posted by anyone (human or
        automated); the contract rules are identical either way.
      </p>
    </section>
  );
}

function ProofStatus({
  isPending,
  isError,
  proofMissing,
  ready,
  targetPool,
}: {
  isPending: boolean;
  isError: boolean;
  proofMissing: boolean;
  ready: boolean;
  targetPool: string | null;
}) {
  if (isPending) {
    return <p className="text-xs text-zinc-500">checking if this NFT qualifies…</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="text-xs text-red-400">
        couldn&apos;t fetch proof
      </p>
    );
  }
  if (proofMissing) {
    return (
      <p role="alert" className="text-xs text-red-300">
        this NFT isn&apos;t in {targetPool ?? "the target pool"}&apos;s tree — pick a different one.
      </p>
    );
  }
  if (ready) {
    return (
      <p aria-live="polite" className="text-xs text-amber-300">
        ✓ qualifies for {targetPool ?? "this pool"}. ready to fulfill.
      </p>
    );
  }
  return null;
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 text-zinc-500">{label}</dt>
      <dd className={mono ? "font-mono text-zinc-300 break-all" : "text-zinc-300"}>
        {value}
      </dd>
    </div>
  );
}

/* ============================================================ */
/* Success state — post-fulfill CTAs                            */
/* ============================================================ */

function FulfillSuccess({
  txHash,
  offeredUnit,
  confirmation,
}: {
  txHash: string;
  offeredUnit: string;
  confirmation: ChainConfirmation;
}) {
  const net = getNetworkName();
  const sub = net === "mainnet" ? "" : `${net}.`;
  const explorerUrl = `https://${sub}cardanoscan.io/transaction/${txHash}`;
  const assetNameAscii = asciiOrShortHex(offeredUnit.slice(56));
  return (
    <div className="space-y-4 rounded-md border border-amber-700/40 bg-amber-950/20 p-4 text-lg">
      <p className="text-amber-200">
        ✓ fulfilled. you got{" "}
        <span className="font-mono text-amber-100">{assetNameAscii}</span>.
        another idiot is now slightly more delegated.
      </p>
      <dl className="text-base text-zinc-400">
        <div className="flex gap-2">
          <dt className="w-16 text-zinc-500">tx</dt>
          <dd className="font-mono break-all">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 underline-offset-2 hover:underline"
            >
              {txHash}
            </a>
          </dd>
        </div>
        <div className="mt-1 flex gap-2">
          <dt className="w-16 text-zinc-500">chain</dt>
          <dd>
            <ConfirmationChip status={confirmation} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href="/p2p"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-base font-semibold text-zinc-950 hover:bg-amber-400"
        >
          browse more listings →
        </Link>
        <Link
          href="/me"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-base text-zinc-200 hover:bg-zinc-800"
        >
          your s#!t
        </Link>
        <Link
          href="/"
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-base text-zinc-400 hover:text-zinc-200"
        >
          home
        </Link>
      </div>
    </div>
  );
}

function NftCardWithRibbon({
  nft,
  accent,
  selected,
  disabled,
  disabledReason,
  onToggle,
  tickers,
  membershipReady,
  targetPoolTicker,
  excludedTickers,
}: {
  nft: WalletCollectionNft;
  accent: string;
  selected: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onToggle: (nft: WalletCollectionNft) => void;
  tickers: string[];
  membershipReady: boolean;
  targetPoolTicker: string | null;
  excludedTickers: Set<string>;
}) {
  // Surface the target pool first (the "good" ribbon), then excluded
  // pools (the "bad" ribbons), then the rest. Helps the user understand
  // at a glance why a card is greyed.
  const orderedTickers = useMemo(() => {
    const primary = tickers.filter((t) => t === targetPoolTicker);
    const excluded = tickers.filter(
      (t) => t !== targetPoolTicker && excludedTickers.has(t),
    );
    const rest = tickers.filter(
      (t) => t !== targetPoolTicker && !excludedTickers.has(t),
    );
    return [...primary, ...excluded, ...rest];
  }, [tickers, targetPoolTicker, excludedTickers]);

  return (
    <div className="flex flex-col gap-1">
      <SelectableWalletCard
        nft={nft}
        accent={accent}
        selected={selected}
        onToggle={onToggle}
        disabled={disabled}
        disabledTitle={disabledReason ?? undefined}
      />
      <div className="flex min-h-[18px] flex-wrap items-center gap-1">
        {!membershipReady ? (
          <span className="h-[14px] w-12 animate-pulse rounded-sm bg-zinc-800/60" />
        ) : orderedTickers.length === 0 ? (
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">
            no pool
          </span>
        ) : (
          orderedTickers.map((t) => {
            const isTarget = t === targetPoolTicker;
            const isExcluded = !isTarget && excludedTickers.has(t);
            return (
              <span
                key={t}
                className={
                  "rounded-sm px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide " +
                  (isTarget
                    ? "bg-amber-500 text-zinc-950"
                    : isExcluded
                      ? "bg-red-900/60 text-red-200"
                      : "bg-zinc-800 text-zinc-400")
                }
                title={
                  isTarget
                    ? `accepted by ${t} (the pool you're targeting)`
                    : isExcluded
                      ? `excluded by you — also in ${t}`
                      : `also accepted by ${t}`
                }
              >
                {t}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function asciiOrShortHex(hex: string): string {
  if (!hex) return "(no name)";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.every((b) => b >= 0x20 && b <= 0x7e)) {
    return new TextDecoder().decode(bytes);
  }
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
