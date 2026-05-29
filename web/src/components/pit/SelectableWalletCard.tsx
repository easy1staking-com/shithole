"use client";

import { motion } from "framer-motion";

import { useNftMetadata } from "@/lib/api/hooks";
import type { WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";
import { PoolChips } from "@/components/PoolChips";

/**
 * A wallet NFT card with a tap-to-select checkbox overlay. Used in the
 * wallet drawer's "list mode" (the multi-select listing flow). Selection
 * state is owned by the parent — this component just renders + emits
 * toggles.
 *
 * <p>Visual: a checkmark badge appears in the top-right corner when
 * selected; the border switches to the accent color and the card scales
 * up slightly. Inverse of the DraggableWalletCard's gesture vocabulary.
 */
export function SelectableWalletCard({
  nft,
  accent,
  selected,
  onToggle,
  disabled = false,
  disabledTitle,
}: {
  nft: WalletCollectionNft;
  accent: string;
  selected: boolean;
  onToggle: (nft: WalletCollectionNft) => void;
  /** When true, the card is non-interactive and visually muted. */
  disabled?: boolean;
  /** Tooltip override when disabled — explains *why* it's disabled. */
  disabledTitle?: string;
}) {
  const meta = useNftMetadata(nft.unit);
  const name = meta.data?.name ?? utf8OrHex(nft.assetNameHex);
  const imageUrl = meta.data?.image_url ?? null;

  return (
    <motion.button
      type="button"
      onClick={() => {
        if (disabled) return;
        onToggle(nft);
      }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      animate={{ scale: selected ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={
        "relative overflow-hidden rounded-md border bg-zinc-900 text-left " +
        (disabled ? "cursor-not-allowed opacity-40" : "")
      }
      style={{
        borderColor: selected ? accent : "#3f3f46",
        boxShadow: selected ? `0 8px 24px ${accent}66` : undefined,
      }}
      aria-pressed={selected}
      aria-disabled={disabled}
      aria-label={`${selected ? "deselect" : "select"} ${name}`}
      title={
        disabled
          ? (disabledTitle ?? `${name}\nnot available`)
          : `${name}\ntap to ${selected ? "deselect" : "select"}`
      }
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
      <div className="space-y-1 px-2 py-1">
        <p className="truncate text-[0.65rem] text-zinc-300">{name}</p>
        <PoolChips traits={meta.data?.traits} />
      </div>
      {/* Checkbox badge */}
      <div
        className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all"
        style={{
          backgroundColor: selected ? accent : "rgba(0,0,0,0.55)",
          color: selected ? "#0a0a0a" : "#a1a1aa",
          border: selected ? "none" : "1px solid #52525b",
        }}
        aria-hidden
      >
        {selected ? "✓" : ""}
      </div>
    </motion.button>
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
