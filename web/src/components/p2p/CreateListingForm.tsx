"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { BountyStep } from "@/components/p2p/BountyStep";
import { NftPickerStep } from "@/components/p2p/NftPickerStep";
import { PoolPicker, PoolSummary } from "@/components/p2p/PoolPicker";
import { useCollection, useCurated } from "@/lib/api/hooks";
import {
  submitCreateP2pListing,
  type CreateP2pListingResult,
} from "@/lib/tx/createP2pListing";
import { makeClient } from "@/lib/tx/evolutionClient";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import type { WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { Pool } from "@/types/api";

/**
 * The v3 P2P "find another idiot" create-listing flow. Mobile-first single
 * column, three sequential steps that unlock as the user fills them in:
 *
 *   1. Pick which SPO pool to bait (which delegators care about your NFT)
 *   2. Pick the NFT you want to offload from your wallet
 *   3. Set the bounty + confirm the swap math
 *
 * Reads {@code ?collection=<slug>} from the URL. If absent, falls back to a
 * collection picker so users who landed here from the global nav can pick.
 *
 * <p>Step 3 is stubbed until the bounty input + tx builder land — this
 * commit ships steps 1+2 (pool + NFT picker) fully wired.
 */
export function CreateListingForm() {
  const params = useSearchParams();
  const collectionSlug = params.get("collection");

  if (!collectionSlug) {
    return <CollectionPickerStep />;
  }
  return <FlowForCollection slug={collectionSlug} />;
}

/* ============================================================ */
/* Stage 0 — collection picker (when no ?collection= present)   */
/* ============================================================ */

function CollectionPickerStep() {
  const { data: curated, isPending, isError, error } = useCurated();
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">first, what kind of s#!t are you offloading?</h2>
      <p className="text-sm text-zinc-400">
        each pit has its own crew of idiots delegated to specific pools. pick
        the collection — we&apos;ll find someone to take it.
      </p>
      {isPending && <p className="text-sm text-zinc-500">stirring the mud…</p>}
      {isError && (
        <p className="text-sm text-red-400" role="alert">
          could not load pits: {error.message}
        </p>
      )}
      {curated && curated.length === 0 && (
        <p className="text-sm text-zinc-500">no pits yet. come back when something dies.</p>
      )}
      {curated && curated.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {curated
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/p2p/new?collection=${encodeURIComponent(c.slug)}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600"
                >
                  <span className="font-semibold">{c.display_name}</span>
                  <p className="mt-1 font-mono text-xs text-zinc-500">/p2p/new?collection={c.slug}</p>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================ */
/* Stage 1+ — picked a collection, run the 3-step flow          */
/* ============================================================ */

function FlowForCollection({ slug }: { slug: string }) {
  const collection = useCollection(slug);
  const router = useRouter();
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  /**
   * Multi-select NFT state — a Map keyed by unit so React equality stays
   * cheap (only Map identity changes, not the entire selection set per
   * render). One Map entry = one wanted-listing UTxO that will be created.
   */
  const [selectedNfts, setSelectedNfts] = useState<Map<string, WalletCollectionNft>>(
    new Map(),
  );

  const handleSelectPool = useCallback(
    (pool: Pool) => {
      setSelectedPool(pool);
      // Reflect the selection in the URL so a refresh / share preserves
      // state. Use replace, not push, so the back button still goes
      // somewhere useful.
      const sp = new URLSearchParams();
      sp.set("collection", slug);
      sp.set("pool", pool.ticker);
      router.replace(`/p2p/new?${sp.toString()}`, { scroll: false });
    },
    [router, slug],
  );

  const handleToggleNft = useCallback((nft: WalletCollectionNft) => {
    setSelectedNfts((prev) => {
      const next = new Map(prev);
      if (next.has(nft.unit)) {
        next.delete(nft.unit);
      } else {
        next.set(nft.unit, nft);
      }
      return next;
    });
  }, []);

  const handleSetSelection = useCallback((nfts: WalletCollectionNft[]) => {
    setSelectedNfts(new Map(nfts.map((n) => [n.unit, n])));
  }, []);

  // Wallet bits the Step-3 submission needs.
  const api = useWalletStore((s) => s.api);
  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const addressBech32 = useWalletStore((s) => s.addressBech32);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<CreateP2pListingResult | null>(
    null,
  );

  const handleSubmitBounty = useCallback(
    async (bountyLovelace: bigint) => {
      if (!selectedPool || selectedNfts.size === 0) return;
      if (!api || !paymentKeyHashHex || !addressBech32 || !collection.data) {
        setSubmitError("connect your wallet first");
        return;
      }
      // Network derives from NEXT_PUBLIC_CARDANO_NETWORK — same helper v2
      // uses, so dev/preprod/mainnet builds pick the right networkId for
      // the script address.
      const network = toEvolutionNetwork(getNetworkName());

      setSubmitting(true);
      setSubmitError(null);
      try {
        const client = await makeClient(api);
        const result = await submitCreateP2pListing(client, {
          network,
          configNftPolicyHex: collection.data.config_nft_policy,
          buyerPkhHex: paymentKeyHashHex,
          buyerBech32Address: addressBech32,
          acceptedMerkleRootHex: selectedPool.merkle_root_hex,
          offeredNftUnits: Array.from(selectedNfts.keys()),
          bountyLovelace,
        });
        setSubmitResult(result);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [
      api,
      paymentKeyHashHex,
      addressBech32,
      collection.data,
      selectedPool,
      selectedNfts,
    ],
  );

  if (collection.isPending) {
    return <p className="text-sm text-zinc-500">looking up the pit…</p>;
  }
  if (collection.isError) {
    return (
      <p className="text-sm text-red-400" role="alert">
        could not load &apos;{slug}&apos;: {collection.error.message}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          find another idiot
        </h1>
        <p className="text-sm text-zinc-400">
          offload your{" "}
          <span className="font-medium text-zinc-200">
            {collection.data.display_name}
          </span>{" "}
          to a delegator who actually wants its traits. you pay them; they
          take it.
        </p>
      </header>

      <Step number={1} title="which pool's idiots?" complete={!!selectedPool}>
        <PoolPicker
          selectedTicker={selectedPool?.ticker ?? null}
          onSelect={handleSelectPool}
        />
        {selectedPool && (
          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs text-zinc-500">picked:</span>
            <PoolSummary pool={selectedPool} />
          </div>
        )}
      </Step>

      <Step
        number={2}
        title="pick the NFTs you want to get rid of"
        complete={selectedNfts.size > 0}
        disabled={!selectedPool}
      >
        {selectedPool ? (
          <NftPickerStep
            collectionPolicyHex={collection.data.collection_policy_id}
            accent={collection.data.theme?.accent_color ?? "#b87333"}
            selectedPoolTicker={selectedPool.ticker}
            selectedUnits={new Set(selectedNfts.keys())}
            onToggle={handleToggleNft}
            onSetSelection={handleSetSelection}
          />
        ) : (
          <p className="text-sm text-zinc-500">pick a pool first.</p>
        )}
      </Step>

      <Step
        number={3}
        title="how generous are you feeling?"
        complete={!!submitResult}
        disabled={!selectedPool || selectedNfts.size === 0}
      >
        {!selectedPool ? (
          <p className="text-sm text-zinc-500">pick a pool first.</p>
        ) : selectedNfts.size === 0 ? (
          <p className="text-sm text-zinc-500">pick at least one NFT first.</p>
        ) : submitResult ? (
          <SuccessPanel result={submitResult} />
        ) : (
          <>
            <BountyStep
              protocolFeeLovelace={BigInt(collection.data.config.protocol_fee)}
              listingCount={selectedNfts.size}
              onSubmit={handleSubmitBounty}
              submitting={submitting}
            />
            {submitError && (
              <p className="mt-3 text-xs text-red-400" role="alert">
                {submitError}
              </p>
            )}
          </>
        )}
      </Step>
    </div>
  );
}

/* ============================================================ */
/* Success panel                                                */
/* ============================================================ */

function SuccessPanel({ result }: { result: CreateP2pListingResult }) {
  const n = result.outputs.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-amber-200">
        {n === 1
          ? "bounty posted. waiting for some idiot to take the bait."
          : `${n} bounties posted. waiting for ${n} idiots to take the bait.`}
      </p>
      <dl className="space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="w-24 text-zinc-500">tx hash</dt>
          <dd className="font-mono text-zinc-300 break-all">{result.txHash}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 text-zinc-500">script</dt>
          <dd className="font-mono text-zinc-400 break-all">
            {result.wantedScriptAddress.slice(0, 14)}…{result.wantedScriptAddress.slice(-6)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 text-zinc-500">
            {n === 1 ? "output" : "outputs"}
          </dt>
          <dd className="font-mono text-zinc-400">
            {result.outputs.map((o) => `#${o.outputIndex}`).join(", ")}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500">
        the {n === 1 ? "listing" : "listings"} settle on chain in ~30-60s.
        your s#!t is locked at the script address with your bounty; you can
        reclaim {n === 1 ? "it" : "them"} any time.
      </p>
    </div>
  );
}


/* ============================================================ */
/* Step shell                                                   */
/* ============================================================ */

function Step({
  number,
  title,
  children,
  complete,
  disabled,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  complete: boolean;
  disabled?: boolean;
}) {
  return (
    <section
      className={
        "space-y-3 rounded-lg border p-4 transition " +
        (disabled
          ? "border-zinc-900 bg-zinc-950/30 opacity-60"
          : complete
            ? "border-amber-700/60 bg-amber-950/10"
            : "border-zinc-800 bg-zinc-950/40")
      }
      // No aria-disabled on <section>: not supported by role=region per
      // ARIA; we communicate disabled-ness via the muted styling above and
      // the disabled state of the child controls (PoolPicker buttons,
      // NftPickerStep cards) when prerequisites aren't met.
    >
      <h2 className="flex items-center gap-2 text-base font-medium">
        <span
          className={
            "inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs " +
            (complete
              ? "bg-amber-500 text-zinc-950"
              : disabled
                ? "bg-zinc-800 text-zinc-600"
                : "bg-zinc-800 text-zinc-300")
          }
          aria-hidden
        >
          {complete ? "✓" : number}
        </span>
        <span className={disabled ? "text-zinc-500" : ""}>{title}</span>
      </h2>
      <div>{children}</div>
    </section>
  );
}
