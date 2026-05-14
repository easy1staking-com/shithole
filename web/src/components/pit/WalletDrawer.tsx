"use client";

import { useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

import { DraggableWalletCard } from "./DraggableWalletCard";

/**
 * Bottom "shore" drawer — shows the connected wallet's holdings of THIS
 * pit's collection. The wallet drawer is the staging area for both
 * actions:
 * <ul>
 *   <li>Listing: tap one or more cards → "drop into pit" CTA.</li>
 *   <li>Swap: tap one card → bucket-match → "drop to swap" CTA.</li>
 * </ul>
 *
 * <p>Iteration 1: just the visual + the "you've got N NFTs of this
 * collection" grid. The action CTAs land in iteration 2.
 *
 * <p>Empty states:
 * <ul>
 *   <li>No wallet → connect button + nudge copy.</li>
 *   <li>Wrong network → muted nudge to switch (no hard block, since
 *       browsing is read-only).</li>
 *   <li>Wallet has no NFTs of this collection → "your wallet has no shit
 *       to dump" placeholder.</li>
 * </ul>
 */
export function WalletDrawer({
  collectionPolicyId,
  accentColor,
  onDragStart,
  onDragEnd,
}: {
  collectionPolicyId: string;
  accentColor?: string | null;
  /** Drag started: parent records the candidate + arms the pit. */
  onDragStart?: (nft: WalletCollectionNft) => void;
  /** Drag released at the given client-space coords. Parent decides
   *  if the release landed inside the pit. */
  onDragEnd?: (nft: WalletCollectionNft, clientX: number, clientY: number) => void;
}) {
  const { api, addressBech32, networkId } = useWalletStore();
  const accent = accentColor ?? "#b87333";

  const nfts = useWalletCollectionNfts(addressBech32, collectionPolicyId);

  const [expanded, setExpanded] = useState(false);

  // Determine the empty-state copy.
  const notConnected = !api || !addressBech32;
  const wrongNetwork =
    !notConnected &&
    networkId !== null &&
    expectedNetworkId() !== networkId;

  return (
    <section
      className="sticky bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur"
      aria-label="your wallet"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          {notConnected && (
            <span className="text-zinc-400">connect a wallet to interact</span>
          )}
          {!notConnected && wrongNetwork && (
            <span className="text-amber-400">
              wallet is on the wrong network for this pit
            </span>
          )}
          {!notConnected && !wrongNetwork && (
            <>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <span className="font-mono text-xs text-zinc-400">
                {addressBech32!.slice(0, 12)}…{addressBech32!.slice(-8)}
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-200">
                {nfts.isLoading
                  ? "loading your stash…"
                  : nfts.data
                    ? `${nfts.data.length} ${nfts.data.length === 1 ? "NFT" : "NFTs"} of this collection`
                    : "—"}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!notConnected && nfts.data && nfts.data.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
              aria-expanded={expanded}
            >
              {expanded ? "hide stash" : "show stash"}
            </button>
          )}
          <WalletConnectButton />
        </div>
      </div>

      {expanded && nfts.data && nfts.data.length > 0 && (
        <div className="border-t border-zinc-800/60 bg-zinc-950">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-3 gap-3 px-6 py-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {nfts.data.map((nft) =>
              onDragStart && onDragEnd ? (
                <DraggableWalletCard
                  key={nft.unit}
                  nft={nft}
                  accent={accent}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ) : (
                <WalletNftCard key={nft.unit} nft={nft} accent={accent} />
              ),
            )}
          </div>
        </div>
      )}

      {!notConnected && nfts.data && nfts.data.length === 0 && !nfts.isLoading && (
        <div className="border-t border-zinc-800/60 bg-zinc-950 px-6 py-4 text-center text-sm text-zinc-500">
          your wallet has no shit to dump in this pit
        </div>
      )}

      {nfts.error && (
        <div className="border-t border-zinc-800/60 bg-zinc-950 px-6 py-3 text-xs text-red-400">
          couldn&apos;t enumerate your stash: {nfts.error.message}
        </div>
      )}
    </section>
  );
}

function WalletNftCard({
  nft,
  accent,
}: {
  nft: WalletCollectionNft;
  accent: string;
}) {
  const meta = useNftMetadata(nft.unit);
  const name = meta.data?.name ?? utf8OrHex(nft.assetNameHex);
  const imageUrl = meta.data?.image_url ?? null;
  return (
    <div
      className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900"
      title={`${name}\n${nft.unit}`}
    >
      <div className="aspect-square bg-zinc-950">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="grid h-full w-full place-items-center text-[0.6rem]"
            style={{ color: accent }}
          >
            …
          </div>
        )}
      </div>
      <p className="truncate px-2 py-1 text-[0.65rem] text-zinc-300">{name}</p>
    </div>
  );
}

function expectedNetworkId(): 0 | 1 {
  const n = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? "preprod").toLowerCase();
  return n === "mainnet" ? 1 : 0;
}

function utf8OrHex(hex: string): string {
  if (!hex) return "";
  if (typeof window === "undefined") return hex;
  try {
    const bytes = new Uint8Array(
      (hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Reject control chars and unprintable.
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c === 0x7f) return hex;
    }
    return s;
  } catch {
    return hex;
  }
}
