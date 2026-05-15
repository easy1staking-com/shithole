"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import type { Listing } from "@/types/api";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

import { DraggableWalletCard } from "./DraggableWalletCard";
import { SelectableWalletCard } from "./SelectableWalletCard";

/**
 * Bottom "shore" drawer — the staging area for both actions on a pit:
 * <ul>
 *   <li><b>Swap mode</b>: drag an NFT into the pit (handled by the parent).</li>
 *   <li><b>List mode</b>: tap to select N NFTs, confirm to list them in
 *       one batch tx.</li>
 * </ul>
 *
 * <p>Mode is a local toggle (defaults to swap). Switching modes resets
 * the list-mode selection so a stale selection doesn't leak across.
 *
 * <p>Empty states:
 * <ul>
 *   <li>No wallet → connect button + nudge copy.</li>
 *   <li>Wrong network → muted nudge (no hard block, browsing is read-only).</li>
 *   <li>No NFTs of this collection → "your wallet has no shit to dump".</li>
 *   <li>List mode + every NFT already listed → "everything you own is already in the pit".</li>
 * </ul>
 */
export function WalletDrawer({
  collectionPolicyId,
  accentColor,
  pool,
  onDragStart,
  onDragEnd,
  onListSubmit,
  listing,
}: {
  collectionPolicyId: string;
  accentColor?: string | null;
  /** Current pool — used in list-mode to exclude already-listed NFTs of the user. */
  pool?: Listing[];
  /** Drag started: parent records the candidate + arms the pit. */
  onDragStart?: (nft: WalletCollectionNft) => void;
  /** Drag released at the given client-space coords. Parent decides
   *  if the release landed inside the pit. */
  onDragEnd?: (nft: WalletCollectionNft, clientX: number, clientY: number) => void;
  /** List-mode confirm. Parent builds + submits the tx + handles toasts. */
  onListSubmit?: (selected: WalletCollectionNft[]) => Promise<void> | void;
  /** True while a list submit is in flight — disables the CTA. */
  listing?: boolean;
}) {
  const { api, addressBech32, networkId, refresh: refreshWallet } = useWalletStore();
  const accent = accentColor ?? "#b87333";
  const queryClient = useQueryClient();

  const nfts = useWalletCollectionNfts(addressBech32, collectionPolicyId);

  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"swap" | "list">("swap");
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Force a full re-check of the connected wallet + the pit pool:
   * - re-polls the CIP-30 connection (catches "you switched accounts
   *   in another tab"),
   * - invalidates the wallet-collection cache (forces re-fetch from
   *   Blockfrost — picks up newly-acquired NFTs),
   * - invalidates the pool cache (in case someone else listed something
   *   while we were looking).
   */
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshWallet();
      await queryClient.invalidateQueries({
        queryKey: ["walletCollection"],
      });
      if (collectionPolicyId) {
        // Wider invalidation — pool + collection state, since the BE
        // indexer might also have new data the user wants to see.
        await queryClient.invalidateQueries({ queryKey: ["listings"] });
        await queryClient.invalidateQueries({ queryKey: ["collection"] });
      }
    } finally {
      // Short tail so the spinner is visible even if the network call
      // finishes faster than the eye can register.
      window.setTimeout(() => setRefreshing(false), 400);
    }
  };

  const notConnected = !api || !addressBech32;
  const wrongNetwork =
    !notConnected &&
    networkId !== null &&
    expectedNetworkId() !== networkId;

  // In list mode, hide NFTs that are already listed in the pool — you
  // can only list things that aren't already in the pit. (Multi-listing
  // the same NFT is impossible anyway under Cardano's 1-per-policy.)
  const listableNfts: WalletCollectionNft[] = useMemo(() => {
    if (!nfts.data) return [];
    if (mode !== "list") return nfts.data;
    const inPool = new Set(
      (pool ?? []).map((l) => l.current_nft_unit.toLowerCase()),
    );
    return nfts.data.filter((n) => !inPool.has(n.unit.toLowerCase()));
  }, [nfts.data, pool, mode]);

  const switchMode = (next: "swap" | "list") => {
    setMode(next);
    setSelectedUnits(new Set()); // reset selection across mode flips
  };

  // The selection-of-record (selectedUnits) is "what the user tapped";
  // the effective selection is the intersection with what's still
  // listable. If the pool refreshes mid-flow and a tapped unit becomes
  // non-listable, it just stops counting — no stale-click footgun, no
  // need to mutate selectedUnits from an effect (which React 19's lint
  // rejects).
  const effectivePicked = useMemo(
    () => listableNfts.filter((n) => selectedUnits.has(n.unit)),
    [listableNfts, selectedUnits],
  );

  const toggleSelect = (nft: WalletCollectionNft) => {
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(nft.unit)) next.delete(nft.unit);
      else next.add(nft.unit);
      return next;
    });
  };

  const handleListClick = async () => {
    if (!onListSubmit || effectivePicked.length === 0) return;
    await onListSubmit(effectivePicked);
    setSelectedUnits(new Set());
  };

  const draggable = mode === "swap" && onDragStart && onDragEnd;
  const selectable = mode === "list" && onListSubmit;

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
            // Address moved into the wallet pill on the right — keeping
            // it here as well crowded the row off the mobile viewport
            // edge. Now we just show the stash count + the accent dot
            // as the "connected" indicator.
            <>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <span className="text-zinc-200">
                {nfts.isLoading
                  ? "loading your stash…"
                  : nfts.data
                    ? `${nfts.data.length} ${nfts.data.length === 1 ? "NFT" : "NFTs"}`
                    : "—"}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!notConnected && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh your wallet stash (CIP-30 doesn't fire account-change events automatically)"
              aria-label="refresh wallet"
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
            >
              <span
                className="inline-block"
                style={{
                  // Spin when refreshing — pure CSS, no extra deps.
                  animation: refreshing
                    ? "spin 0.8s linear infinite"
                    : undefined,
                }}
              >
                ↻
              </span>
            </button>
          )}
          {!notConnected && nfts.data && nfts.data.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500"
              aria-expanded={expanded}
              aria-label={expanded ? "hide stash" : "show stash"}
              title={expanded ? "hide stash" : "show stash"}
            >
              {expanded ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M3 3l18 18" />
                  <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
                  <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.5c4.64 0 8.57 3 9.96 7.18a10.55 10.55 0 0 1-4.06 5.41" />
                  <path d="M6.1 6.1A10.55 10.55 0 0 0 2.04 11.68c1.39 4.18 5.32 7.18 9.96 7.18 1.51 0 2.95-.3 4.26-.85" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M2.04 12.32a1 1 0 0 1 0-.64C3.43 7.51 7.36 4.5 12 4.5c4.64 0 8.57 3.01 9.96 7.18.07.21.07.43 0 .64-1.39 4.17-5.32 7.18-9.96 7.18-4.64 0-8.57-3.01-9.96-7.18z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
          <WalletConnectButton />
        </div>
      </div>

      {/* Expanded stash */}
      {expanded && nfts.data && nfts.data.length > 0 && (
        <div className="border-t border-zinc-800/60 bg-zinc-950">
          {/* Mode tabs — only shown if the parent wired both modes. */}
          {onListSubmit && (draggable || true) && (
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 pt-3">
              <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
                <ModeTab
                  active={mode === "swap"}
                  onClick={() => switchMode("swap")}
                  accent={accent}
                >
                  swap
                </ModeTab>
                <ModeTab
                  active={mode === "list"}
                  onClick={() => switchMode("list")}
                  accent={accent}
                >
                  list
                </ModeTab>
              </div>
              <p className="text-[0.65rem] uppercase tracking-widest text-zinc-500">
                {mode === "swap"
                  ? "drag an NFT into the pit"
                  : "tap NFTs to list them"}
              </p>
            </div>
          )}

          {/* The grid */}
          {(mode === "list" ? listableNfts : nfts.data).length === 0 ? (
            <div className="px-6 py-6 text-center text-sm text-zinc-500">
              {mode === "list"
                ? "everything you own is already in the pit"
                : "your wallet has no s#!t to dump in this pit"}
            </div>
          ) : (
            // Cap the stash grid height + enable vertical scroll so a
            // wallet with many NFTs doesn't push the pit off-screen.
            // 40vh on desktop / 50vh on mobile leaves the pit + reveal
            // overlay visible while still showing a useful number of
            // cards above the fold.
            <div className="mx-auto w-full max-w-6xl max-h-[50vh] overflow-y-auto px-6 py-4 sm:max-h-[40vh]">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {(mode === "list" ? listableNfts : nfts.data).map((nft) =>
                selectable ? (
                  <SelectableWalletCard
                    key={nft.unit}
                    nft={nft}
                    accent={accent}
                    selected={selectedUnits.has(nft.unit)}
                    onToggle={toggleSelect}
                  />
                ) : draggable ? (
                  <DraggableWalletCard
                    key={nft.unit}
                    nft={nft}
                    accent={accent}
                    onDragStart={onDragStart!}
                    onDragEnd={onDragEnd!}
                  />
                ) : (
                  <WalletNftCard key={nft.unit} nft={nft} accent={accent} />
                ),
              )}
              </div>
            </div>
          )}

          {/* List-mode confirm bar — count reflects pickable units
           *  only (selection is intersected with listableNfts). */}
          {mode === "list" && onListSubmit && (
            <ListConfirmBar
              count={effectivePicked.length}
              accent={accent}
              submitting={!!listing}
              onClick={handleListClick}
            />
          )}
        </div>
      )}

      {!notConnected && nfts.data && nfts.data.length === 0 && !nfts.isLoading && (
        <div className="border-t border-zinc-800/60 bg-zinc-950 px-6 py-4 text-center text-sm text-zinc-500">
          your wallet has no s#!t to dump in this pit
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

function ModeTab({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-3 py-1 text-xs uppercase tracking-wide transition-colors"
      style={{
        backgroundColor: active ? accent : "transparent",
        color: active ? "#0a0a0a" : "#a1a1aa",
        fontWeight: active ? 600 : 400,
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function ListConfirmBar({
  count,
  accent,
  submitting,
  onClick,
}: {
  count: number;
  accent: string;
  submitting: boolean;
  onClick: () => void;
}) {
  const disabled = count === 0 || submitting;
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t border-zinc-800/60 px-6 py-3">
      <p className="text-xs text-zinc-400">
        {count === 0
          ? "tap any of yours to dump them into the pit"
          : count === 1
            ? "1 selected · ~2 ADA min-utxo will lock per listing"
            : `${count} selected · ~${count * 2} ADA min-utxo will lock`}
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          backgroundColor: disabled ? "#3f3f46" : accent,
          color: disabled ? "#a1a1aa" : "#0a0a0a",
        }}
      >
        {submitting
          ? "dumping…"
          : count === 0
            ? "list nothing"
            : count === 1
              ? "list 1 piece"
              : `list ${count} pieces`}
      </button>
    </div>
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
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c === 0x7f) return hex;
    }
    return s;
  } catch {
    return hex;
  }
}
