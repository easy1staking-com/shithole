"use client";

import { AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { use, useCallback, useEffect, useRef, useState } from "react";

import { PitDropZone } from "@/components/pit/PitDropZone";
import { PitHeader } from "@/components/pit/PitHeader";
import { SwapConfirm } from "@/components/pit/SwapConfirm";
import {
  SwapRevealOverlay,
  type ConfirmationStatus,
  type SwapStatus,
} from "@/components/pit/SwapRevealOverlay";
import { WalletDrawer } from "@/components/pit/WalletDrawer";
import { useCollection, useListings } from "@/lib/api/hooks";
import { useMatchability } from "@/lib/pit/useMatchability";
import type { Match } from "@/lib/pit/bucketMath";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { submitList } from "@/lib/tx/list";
import { makeLucid } from "@/lib/tx/lucidClient";
import {
  fetchUtxoByOutRef,
  findConfigUtxo,
  findUtxoCarrying,
  submitSwap,
} from "@/lib/tx/swap";
import { addressViewToBech32 } from "@/lib/util/addressView";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletCollectionNfts, type WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Pit page — iteration 2A scaffolding.
 *
 * <p>Layers added on top of iter-1:
 * <ul>
 *   <li>Eager bucket-matchability via {@link useMatchability}: cheap
 *       precompute over (wallet × pool); the result map drives the
 *       drop-time decision but is invisible in the UI until the user
 *       actually drops something unmatchable.</li>
 *   <li>Drag-and-drop on wallet cards (Framer Motion drag; works for both
 *       mouse and long-press touch). Drop hit-test against the pit's
 *       bounding rect.</li>
 *   <li>Responsive confirm UI (top bar on md+, bottom sheet below md).</li>
 *   <li>Error toast on unmatchable drops; transient "you're swapping…"
 *       placeholder on confirm (real submit lands in iter-2B).</li>
 * </ul>
 *
 * <p>No transactions yet — the confirm handler just flips the swap state
 * to "submitting" for a beat, logs the intended swap, then resets. Iter-2B
 * replaces that stub with the real Lucid tx + reveal animation.
 */
type Params = { slug: string };

type SwapState =
  | { kind: "idle" }
  | { kind: "dragging"; nft: WalletCollectionNft }
  | { kind: "confirming"; nft: WalletCollectionNft; match: Match }
  | { kind: "submitting"; nft: WalletCollectionNft; match: Match }
  | { kind: "error"; message: string };

export default function PitPage({ params }: { params: Promise<Params> }) {
  const { slug } = use(params);
  const collection = useCollection(slug);
  const listings = useListings(slug, { page: 0, size: 50 });
  const queryClient = useQueryClient();

  const { api, addressBech32, paymentKeyHashHex } = useWalletStore();
  const collectionPolicyId = collection.data?.collection_policy_id;
  const walletNfts = useWalletCollectionNfts(
    addressBech32 ?? null,
    collectionPolicyId ?? null,
  );

  const matches = useMatchability(
    walletNfts.data,
    listings.data?.data,
    collectionPolicyId,
    collection.data?.config.m,
  );

  const pitRef = useRef<HTMLDivElement | null>(null);
  // Pit hover state — updated by the window-level pointer tracker while
  // a drag is in flight. Kept as state (not derived from a ref during
  // render) so React's "no refs during render" lint stays happy.
  const [hovering, setHovering] = useState(false);
  const [swap, setSwap] = useState<SwapState>({ kind: "idle" });
  // Transient toast text — shown for ~3s.
  const [toast, setToast] = useState<string | null>(null);
  // Reveal overlay state — independent of `swap` so the animation can
  // outlive the submit (e.g. show "stuck" overlay after the swap state
  // already cleared to idle).
  const [revealStatus, setRevealStatus] = useState<SwapStatus | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationStatus>(null);
  const [reveal, setReveal] = useState<
    { depositUnit: string; outcomeUnit: string; txHash?: string } | null
  >(null);

  const handleDragStart = useCallback((nft: WalletCollectionNft) => {
    setSwap({ kind: "dragging", nft });
    setToast(null);
  }, []);

  const handleDragEnd = useCallback(
    (nft: WalletCollectionNft, clientX: number, clientY: number) => {
      setHovering(false);
      const rect = pitRef.current?.getBoundingClientRect();
      const hitPit =
        !!rect &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
      if (!hitPit) {
        // Release outside the pit → just snap back (Framer Motion does
        // that on its own) + reset state.
        setSwap({ kind: "idle" });
        return;
      }
      const match = matches.get(nft.unit);
      if (!match) {
        setSwap({ kind: "idle" });
        setToast("no s#!t in this pit matches yours. try another.");
        // Auto-dismiss the toast.
        window.setTimeout(() => setToast(null), 3500);
        return;
      }
      setSwap({ kind: "confirming", nft, match });
    },
    [matches],
  );

  const handleCancel = useCallback(() => {
    setSwap({ kind: "idle" });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (swap.kind !== "confirming") return;
    if (!api || !addressBech32 || !collection.data || !collectionPolicyId) {
      setSwap({ kind: "idle" });
      setToast("connect a wallet first");
      window.setTimeout(() => setToast(null), 3500);
      return;
    }

    const deposit = swap.nft;
    const match = swap.match;

    // Locate the full Listing row (we need lister_pkh + lovelace, which
    // aren't on the bucket-math PoolListingRef).
    const consumedListing = listings.data?.data.find(
      (l) =>
        l.utxo_ref.tx_id === match.consumed.txHex &&
        l.utxo_ref.output_index === match.consumed.outputIndex,
    );
    if (!consumedListing) {
      setSwap({ kind: "idle" });
      setToast("the matched listing vanished from the pool — try again");
      window.setTimeout(() => setToast(null), 3500);
      return;
    }

    // Fire the animation IMMEDIATELY (parallel to chain submission, per
    // SPEC §11 / Giovanni's UX call: animation timing independent of latency).
    setSwap({ kind: "submitting", nft: deposit, match });
    setReveal({ depositUnit: deposit.unit, outcomeUnit: match.consumed.unit });
    setRevealStatus("pending");
    setConfirmation(null);
    setRevealError(null);

    try {
      const network = toEvolutionNetwork(getNetworkName());
      const lucid = await makeLucid(api);

      const [configUtxo, depositUtxo, consumedUtxo] = await Promise.all([
        findConfigUtxo(lucid, network, collection.data.config_nft_policy),
        findUtxoCarrying(lucid, deposit.unit),
        fetchUtxoByOutRef(
          lucid,
          match.consumed.txHex,
          match.consumed.outputIndex,
        ),
      ]);
      if (!depositUtxo) {
        throw new Error(`wallet UTxO holding ${deposit.unit} not found`);
      }

      const treasuryBech32 = addressViewToBech32(
        collection.data.config.treasury_addr,
        network,
      );

      const result = await submitSwap(lucid, {
        network,
        collectionPolicyHex: collectionPolicyId,
        configNftPolicyHex: collection.data.config_nft_policy,
        listingScriptAddress: collection.data.listing_script_address,
        treasuryAddrBech32: treasuryBech32,
        protocolFeeLovelace: BigInt(collection.data.config.protocol_fee),
        listerFeeLovelace: BigInt(collection.data.config.lister_fee),
        consumed: consumedUtxo,
        consumedAssetNameHex: match.consumed.unit.slice(56),
        consumedListerPkhHex: consumedListing.lister_pkh,
        depositUtxo,
        depositAssetNameHex: deposit.assetNameHex,
        configUtxo,
      });

      console.log("swap submitted:", result.txHash);
      // Submission succeeded → flip the swirl to reveal. Confirmation
      // continues in the background; the chip on the settled phase
      // tells the user whether the chain actually landed it.
      // Capture txHash so the share-card URL can include it.
      setReveal((prev) =>
        prev ? { ...prev, txHash: result.txHash } : prev,
      );
      setRevealStatus("success");
      setConfirmation("confirming");

      awaitTxConfirmation(lucid, result.txHash)
        .then(() => {
          setConfirmation("confirmed");
          // The BE indexer reads on confirmation, so invalidate now —
          // not at submit time. Invalidating earlier just refetches
          // stale data.
          queryClient.invalidateQueries({
            queryKey: [
              "walletCollection",
              addressBech32,
              collectionPolicyId,
            ],
          });
          queryClient.invalidateQueries({ queryKey: ["listings", slug] });
          queryClient.invalidateQueries({ queryKey: ["collection", slug] });
        })
        .catch((chainErr) => {
          const chainMsg =
            chainErr instanceof Error ? chainErr.message : String(chainErr);
          console.warn("chain did not confirm:", chainMsg);
          setConfirmation("rejected");
        });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      console.error("swap failed:", message);
      // Submit-side failure → the "stuck in the pipes" overlay. Chain
      // never saw the tx, so wallet/pool state is unchanged — no
      // invalidation needed.
      setRevealStatus("error");
      setRevealError(message);
    }
  }, [
    swap,
    api,
    addressBech32,
    collection.data,
    collectionPolicyId,
    listings.data,
    queryClient,
    slug,
  ]);

  const handleRevealDismiss = useCallback(() => {
    const wasSuccess = revealStatus === "success";
    const wasConfirmed = confirmation === "confirmed";
    const outcomeUnit = reveal?.outcomeUnit;
    setReveal(null);
    setRevealStatus(null);
    setConfirmation(null);
    setRevealError(null);
    setSwap({ kind: "idle" });
    if (wasSuccess && wasConfirmed && outcomeUnit) {
      setToast(`fished out ${shortName(outcomeUnit)} — check your stash`);
      window.setTimeout(() => setToast(null), 4500);
    }
  }, [revealStatus, confirmation, reveal]);

  const handleRevealRetry = useCallback(() => {
    // Tear down the overlay; the user is back at "drag your NFT in".
    setReveal(null);
    setRevealStatus(null);
    setConfirmation(null);
    setRevealError(null);
    setSwap({ kind: "idle" });
  }, []);

  /* ------------------------------------------------------------------ */
  /* List flow (iter-3): batch-list 1..N NFTs at the listing-script addr */
  /* ------------------------------------------------------------------ */

  const [listing, setListing] = useState(false);

  const handleListSubmit = useCallback(
    async (picked: WalletCollectionNft[]) => {
      if (!api || !addressBech32 || !collection.data || !collectionPolicyId) {
        setToast("connect a wallet first");
        window.setTimeout(() => setToast(null), 3500);
        return;
      }
      if (!paymentKeyHashHex) {
        setToast("wallet address still decoding — try again in a moment");
        window.setTimeout(() => setToast(null), 3500);
        return;
      }
      if (picked.length === 0) return;
      setListing(true);
      setToast(
        picked.length === 1
          ? "dumping 1 piece of s#!t into the pit…"
          : `dumping ${picked.length} pieces of s#!t into the pit…`,
      );
      try {
        const lucid = await makeLucid(api);
        const result = await submitList(lucid, {
          listingScriptAddress: collection.data.listing_script_address,
          listerPkhHex: paymentKeyHashHex,
          nfts: picked.map((n) => ({ unit: n.unit })),
        });
        setToast(
          picked.length === 1
            ? "submitted. settling on chain…"
            : `submitted ${picked.length} listings. settling on chain…`,
        );
        try {
          await awaitTxConfirmation(lucid, result.txHash);
          setToast(
            picked.length === 1
              ? "your s#!t is in the pit"
              : `${picked.length} pieces dumped — they're in the pit`,
          );
          queryClient.invalidateQueries({
            queryKey: ["walletCollection", addressBech32, collectionPolicyId],
          });
          queryClient.invalidateQueries({ queryKey: ["listings", slug] });
          queryClient.invalidateQueries({ queryKey: ["collection", slug] });
        } catch (chainErr) {
          const chainMsg =
            chainErr instanceof Error ? chainErr.message : String(chainErr);
          console.warn("list did not confirm:", chainMsg);
          setToast("chain didn't accept the listing — try again");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("list failed:", message);
        setToast(`couldn't list: ${message.slice(0, 100)}`);
      } finally {
        setListing(false);
        window.setTimeout(() => setToast(null), 5000);
      }
    },
    [
      api,
      addressBech32,
      collection.data,
      collectionPolicyId,
      paymentKeyHashHex,
      queryClient,
      slug,
    ],
  );

  // Window-level pointermove listener while dragging — Framer Motion's
  // onDrag fires on the dragged element which isn't a stable target for
  // "is the pointer over the pit" hit-testing during drag (the element
  // moves with the cursor). A window listener gives us the raw cursor;
  // we hit-test inside the effect (refs are fine there) and set hovering.
  usePitHoverTracker(swap.kind === "dragging", pitRef, setHovering);

  const bgUrl = collection.data?.theme?.background_url ?? null;

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={
        bgUrl
          ? {
              backgroundImage: `linear-gradient(rgba(8,8,12,0.85), rgba(8,8,12,0.95)), url(${bgUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 pb-40 pt-8">
        {collection.isLoading && (
          <p className="text-sm text-zinc-500">peering into the pit…</p>
        )}
        {collection.error && (
          <p className="text-sm text-red-400" role="alert">
            could not load this pit: {collection.error.message}
          </p>
        )}

        {collection.data && (
          <>
            <PitHeader collection={collection.data} />

            <div className="relative">
              {listings.isLoading && (
                <p className="text-xs text-zinc-500">counting NFTs in the mud…</p>
              )}
              <PitDropZone
                ref={pitRef}
                listings={listings.data?.data ?? []}
                accentColor={collection.data.theme?.accent_color}
                armed={swap.kind === "dragging"}
                hovering={hovering}
              />
              {listings.data && listings.data.data.length === 0 && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <p className="rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-zinc-300 backdrop-blur">
                    nobody has dumped anything here yet
                  </p>
                </div>
              )}
            </div>

            {listings.data && listings.data.data.length > 0 && (
              <p className="text-center text-xs text-zinc-500">
                showing a sample of{" "}
                <span className="text-zinc-300">
                  {Math.min(listings.data.data.length, 12)}
                </span>{" "}
                from{" "}
                <span className="text-zinc-300">{listings.data.total}</span>{" "}
                drowned souls
              </p>
            )}
          </>
        )}
      </main>

      {collection.data && collectionPolicyId && (
        <WalletDrawer
          collectionPolicyId={collectionPolicyId}
          accentColor={collection.data.theme?.accent_color}
          pool={listings.data?.data ?? []}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onListSubmit={handleListSubmit}
          listing={listing}
        />
      )}

      {/* Toast — error or stubbed success. */}
      <AnimatePresence>
        {toast && (
          <Toast key="toast" message={toast} />
        )}
      </AnimatePresence>

      {/* Confirm UI — bar (desktop) or sheet (mobile). Hidden once the
       *  reveal overlay takes over so they don't stack. */}
      <AnimatePresence>
        {(swap.kind === "confirming" ||
          (swap.kind === "submitting" && !reveal)) && (
          <SwapConfirm
            key={swap.nft.unit}
            deposit={swap.nft}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            submitting={swap.kind === "submitting"}
          />
        )}
      </AnimatePresence>

      {/* Reveal overlay — splash/swirl/reveal, independent of `swap`
       *  so the chain success/error can resolve into the same animation. */}
      <AnimatePresence>
        {reveal && revealStatus && (
          <SwapRevealOverlay
            key="reveal"
            status={revealStatus}
            errorMessage={revealError}
            depositUnit={reveal.depositUnit}
            outcomeUnit={reveal.outcomeUnit}
            confirmation={confirmation}
            accentColor={collection.data?.theme?.accent_color}
            shareContext={
              collection.data
                ? {
                    slug,
                    displayName: collection.data.display_name,
                    txHash: reveal.txHash,
                  }
                : undefined
            }
            onDismiss={handleRevealDismiss}
            onRetry={handleRevealRetry}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pit hover tracker — window pointermove + ref hit-test, both in an effect   */
/* -------------------------------------------------------------------------- */

function usePitHoverTracker(
  active: boolean,
  pitRef: React.RefObject<HTMLDivElement | null>,
  setHovering: (h: boolean) => void,
) {
  useEffect(() => {
    if (!active) {
      setHovering(false);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const rect = pitRef.current?.getBoundingClientRect();
      if (!rect) {
        setHovering(false);
        return;
      }
      setHovering(
        e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom,
      );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [active, pitRef, setHovering]);
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

function Toast({ message }: { message: string }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex w-full max-w-md justify-center px-6"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-full bg-zinc-900/95 px-4 py-2 text-sm text-zinc-200 shadow-lg ring-1 ring-zinc-700 backdrop-blur">
        {message}
      </div>
    </div>
  );
}

function shortName(unit: string): string {
  const tail = unit.slice(56);
  try {
    const bytes = new Uint8Array(
      (tail.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return tail.slice(0, 12);
  }
}
