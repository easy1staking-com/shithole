"use client";

import { AnimatePresence } from "framer-motion";
import { use, useCallback, useEffect, useRef, useState } from "react";

import { PitDropZone } from "@/components/pit/PitDropZone";
import { PitHeader } from "@/components/pit/PitHeader";
import { SwapConfirm } from "@/components/pit/SwapConfirm";
import { WalletDrawer } from "@/components/pit/WalletDrawer";
import { useCollection, useListings } from "@/lib/api/hooks";
import { useMatchability } from "@/lib/pit/useMatchability";
import type { Match } from "@/lib/pit/bucketMath";
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

  const { addressBech32 } = useWalletStore();
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
        setToast("no shit in this pit matches yours. try another.");
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

  const handleConfirm = useCallback(() => {
    if (swap.kind !== "confirming") return;
    setSwap({ kind: "submitting", nft: swap.nft, match: swap.match });
    // Stub: real swap tx + reveal animation lands in iter-2B. For now,
    // log the intended swap + return to idle after a short beat so the
    // dev can see the "swapping…" pulse on the button.
    console.log(
      "[2A stub] would swap",
      swap.nft.unit,
      "<=>",
      swap.match.consumed.unit,
      "at bucket",
      swap.match.bucket,
    );
    window.setTimeout(() => {
      setSwap({ kind: "idle" });
      setToast(
        `(stub) would deposit ${shortName(swap.nft.unit)} and take ${shortName(swap.match.consumed.unit)} out`,
      );
      window.setTimeout(() => setToast(null), 4500);
    }, 1200);
  }, [swap]);

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
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      )}

      {/* Toast — error or stubbed success. */}
      <AnimatePresence>
        {toast && (
          <Toast key="toast" message={toast} />
        )}
      </AnimatePresence>

      {/* Confirm UI — bar (desktop) or sheet (mobile). */}
      <AnimatePresence>
        {(swap.kind === "confirming" || swap.kind === "submitting") && (
          <SwapConfirm
            key={swap.nft.unit}
            deposit={swap.nft}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            submitting={swap.kind === "submitting"}
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
