"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import type { WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";

/**
 * A wallet NFT card that can be dragged with the mouse or a long-press on
 * touch. Drag is the candidate-selection gesture: the parent's
 * {@code onDropRelease} callback receives the release coords and decides
 * whether the drop happened over the pit (the actual commit is a separate
 * confirm step, so dropping is just "this is what I'd like to swap").
 *
 * <p>The card itself snaps back to its origin via Framer Motion's
 * {@code dragSnapToOrigin} when the parent rejects the drop (e.g. release
 * was off-pit, or the parent decides the NFT isn't matchable in the
 * current pool). The parent signals "rejected" by setting {@code revertKey}
 * to a new value — Framer Motion remounts the drag layer, triggering the
 * snap.
 */
export function DraggableWalletCard({
  nft,
  accent,
  onDragStart,
  onDragEnd,
}: {
  nft: WalletCollectionNft;
  accent: string;
  onDragStart: (nft: WalletCollectionNft) => void;
  /** Called on drag release with the client-space release coords. */
  onDragEnd: (nft: WalletCollectionNft, clientX: number, clientY: number) => void;
}) {
  const meta = useNftMetadata(nft.unit);
  const name = meta.data?.name ?? utf8OrHex(nft.assetNameHex);
  const imageUrl = meta.data?.image_url ?? null;
  const [dragging, setDragging] = useState(false);

  return (
    <motion.div
      drag
      dragSnapToOrigin
      dragElastic={0.5}
      dragMomentum={false}
      whileDrag={{ scale: 1.08, zIndex: 50 }}
      whileTap={{ scale: 0.98 }}
      onDragStart={() => {
        setDragging(true);
        onDragStart(nft);
      }}
      onDragEnd={(event) => {
        setDragging(false);
        // event.clientX/Y aren't on the framer-motion PanInfo type; pull
        // from the underlying PointerEvent.
        const e = event as PointerEvent;
        onDragEnd(nft, e.clientX, e.clientY);
      }}
      className={`relative cursor-grab touch-none select-none overflow-hidden rounded-md border bg-zinc-900 transition-shadow active:cursor-grabbing ${
        dragging ? "shadow-2xl" : "shadow-md"
      }`}
      style={{ borderColor: dragging ? accent : "#3f3f46" }}
      title={`${name}\ndrag into the pit to swap`}
    >
      <div className="aspect-square bg-zinc-950">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="pointer-events-none h-full w-full object-cover"
            loading="lazy"
            draggable={false}
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
    </motion.div>
  );
}

function utf8OrHex(hex: string): string {
  if (!hex) return "";
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
