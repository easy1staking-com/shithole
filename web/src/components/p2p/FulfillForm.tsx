"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { SelectableWalletCard } from "@/components/pit/SelectableWalletCard";
import {
  useCurated,
  useCollection,
  useP2pListings,
  usePoolByRoot,
  useProof,
} from "@/lib/api/hooks";
import { fetchUtxoByOutRef, findConfigUtxo } from "@/lib/tx/swap";
import { submitFulfillP2p } from "@/lib/tx/fulfillP2p";
import { makeClient } from "@/lib/tx/evolutionClient";
import { addressViewToBech32 } from "@/lib/util/addressView";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
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
        <p className="text-sm text-red-400" role="alert">
          listing not found, or already taken.
        </p>
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

  // Proof for the chosen NFT against the listing's merkle root. Empty
  // means the wallet's NFT doesn't qualify; UI guides the user away.
  const proofQuery = useProof(
    listing.accepted_merkle_root,
    selected?.assetNameHex ?? "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ txHash: string } | null>(
    null,
  );

  const eligible = useMemo(() => {
    if (!walletNfts) return [];
    // For v1, "eligible" = NFTs whose hex matches the merkle root's set —
    // but we don't ship the full set to the FE. So we leave eligibility
    // for the proof query to confirm after picking. UI guidance: pick
    // any of your NFTs; we'll tell you if it doesn't qualify.
    return walletNfts;
  }, [walletNfts]);

  const onSubmit = useCallback(async () => {
    if (!selected || !proofQuery.data || !api || !addressBech32) {
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
        depositNftUnit: selected.unit,
        merkleProof: proofQuery.data.proof.map((s) => ({
          side: s.side,
          hashHex: s.hash_hex,
        })),
      });
      setSubmitResult(result);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    selected,
    proofQuery.data,
    api,
    addressBech32,
    listing,
    protocolFeeLovelace,
    treasuryAddr,
  ]);

  if (!addressBech32) {
    return (
      <div className="space-y-4">
        <ListingSummary listing={listing} targetPoolTicker={targetPoolTicker} />
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
          <p className="mb-2 text-sm text-zinc-400">
            connect your wallet to see if any of your NFTs match this
            listing&apos;s accepted pool.
          </p>
          <WalletConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ListingSummary listing={listing} targetPoolTicker={targetPoolTicker} />

      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-base font-medium">pick the NFT to deposit</h2>
        {walletPending && <p className="text-sm text-zinc-500">peeking inside your wallet…</p>}
        {!walletPending && eligible.length === 0 && (
          <p className="text-sm text-zinc-500">
            no NFTs from this collection in your wallet.
          </p>
        )}
        {eligible.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {eligible.map((nft) => (
              <SelectableWalletCard
                key={nft.unit}
                nft={nft}
                accent="#ff8c1a"
                selected={selected?.unit === nft.unit}
                onToggle={() => setSelected(nft)}
              />
            ))}
          </div>
        )}
        {selected && (
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
        />
      ) : (
        <button
          type="button"
          disabled={!selected || !proofQuery.data || submitting}
          onClick={onSubmit}
          className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {submitting
            ? "submitting…"
            : !selected
              ? "pick an NFT first"
              : !proofQuery.data
                ? proofQuery.isPending
                  ? "checking proof…"
                  : "this NFT doesn't qualify"
                : "fulfill — take the bounty"}
        </button>
      )}
      {submitError && (
        <p className="text-xs text-red-400" role="alert">
          {submitError}
        </p>
      )}
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
  const bountyAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);
  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
      <h2 className="text-base font-medium">the listing</h2>
      <dl className="space-y-1 text-xs">
        <Row label="offered" value={listing.offered_nft_unit.slice(56) || "(empty asset)"} mono />
        <Row label="bounty" value={`${bountyAda} ADA`} mono />
        <Row label="target pool" value={targetPoolTicker ?? "unknown"} mono />
        <Row label="buyer" value={`${listing.buyer_pkh.slice(0, 12)}…`} mono />
      </dl>
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
    return <p className="text-xs text-red-400">couldn&apos;t fetch proof</p>;
  }
  if (proofMissing) {
    return (
      <p className="text-xs text-red-300">
        this NFT isn&apos;t in {targetPool ?? "the target pool"}&apos;s tree — pick a different one.
      </p>
    );
  }
  if (ready) {
    return (
      <p className="text-xs text-amber-300">
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
}: {
  txHash: string;
  offeredUnit: string;
}) {
  const net = getNetworkName();
  const sub = net === "mainnet" ? "" : `${net}.`;
  const explorerUrl = `https://${sub}cardanoscan.io/transaction/${txHash}`;
  const assetNameAscii = asciiOrShortHex(offeredUnit.slice(56));
  return (
    <div className="space-y-4 rounded-md border border-amber-700/40 bg-amber-950/20 p-4 text-sm">
      <p className="text-amber-200">
        ✓ fulfilled. you got{" "}
        <span className="font-mono text-amber-100">{assetNameAscii}</span>{" "}
        + the bounty. another idiot is now slightly more delegated.
      </p>
      <dl className="text-xs text-zinc-400">
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
      </dl>
      <p className="text-xs text-zinc-500">
        settles on chain in ~30-60s. the NFT lands in your wallet via the
        same address that fulfilled.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href="/p2p"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
        >
          browse more listings →
        </Link>
        <Link
          href="/me"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          your s#!t
        </Link>
        <Link
          href="/"
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          home
        </Link>
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
