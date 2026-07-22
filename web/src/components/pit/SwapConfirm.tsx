"use client";

import { motion } from "framer-motion";

import { NftImage } from "@/components/NftImage";
import { useNftMetadata } from "@/lib/api/hooks";
import { useBreakpoint } from "@/lib/util/useMediaQuery";
import type { WalletCollectionNft } from "@/lib/wallet/useWalletCollectionNfts";

/**
 * Responsive confirm UI for the swap drop. The drag drop produces a
 * candidate (deposit NFT + matched consumed listing); this component
 * presents the commit step.
 *
 * <p>Layouts:
 * <ul>
 *   <li><b>Desktop (md+):</b> top-sliding bar across the pit area.</li>
 *   <li><b>Mobile:</b> bottom sheet sliding up from below the wallet
 *       drawer.</li>
 * </ul>
 *
 * <p>The "what NA you'll get" is intentionally hidden — full suspense
 * until the reveal animation post-confirm. The bar/sheet shows only the
 * deposit (NB) preview + the call to action.
 */
export function SwapConfirm({
  deposit,
  onCancel,
  onConfirm,
  submitting,
}: {
  deposit: WalletCollectionNft;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const isDesktop = useBreakpoint("md");
  return isDesktop ? (
    <ConfirmBar
      deposit={deposit}
      onCancel={onCancel}
      onConfirm={onConfirm}
      submitting={submitting}
    />
  ) : (
    <ConfirmSheet
      deposit={deposit}
      onCancel={onCancel}
      onConfirm={onConfirm}
      submitting={submitting}
    />
  );
}

type InnerProps = {
  deposit: WalletCollectionNft;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
};

function ConfirmBar({ deposit, onCancel, onConfirm, submitting }: InnerProps) {
  const meta = useNftMetadata(deposit.unit);
  const name = meta.data?.name ?? deposit.unit.slice(56);
  return (
    <motion.div
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -80, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="pointer-events-auto fixed inset-x-0 top-0 z-40 mx-auto flex w-full max-w-3xl items-center gap-4 rounded-b-2xl border border-t-0 border-zinc-700 bg-zinc-950/95 px-4 py-3 shadow-2xl backdrop-blur"
      role="dialog"
      aria-label="confirm swap"
    >
      <NftImage
        ipfsUri={meta.data?.image_ipfs_uri ?? null}
        url={meta.data?.image_url ?? null}
        alt={name}
        loading="eager"
        className="h-12 w-12 flex-none rounded-md object-cover"
        fallback={null}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">
          Drop <span className="font-semibold">{name}</span> in?
        </p>
        <p className="text-xs text-zinc-500">
          Sign to reveal what comes back out.
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs uppercase tracking-wide text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
      >
        cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-50 hover:bg-amber-500 disabled:opacity-50"
      >
        {submitting ? "swapping…" : "drop in"}
      </button>
    </motion.div>
  );
}

function ConfirmSheet({ deposit, onCancel, onConfirm, submitting }: InnerProps) {
  const meta = useNftMetadata(deposit.unit);
  const name = meta.data?.name ?? deposit.unit.slice(56);
  return (
    <>
      {/* Scrim — taps cancel. */}
      <motion.button
        type="button"
        aria-label="cancel"
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-30 bg-black/50"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-zinc-700 bg-zinc-950 px-5 py-6 shadow-2xl"
        role="dialog"
        aria-label="confirm swap"
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-zinc-700" />
        <div className="flex flex-col items-center gap-4">
          <NftImage
            ipfsUri={meta.data?.image_ipfs_uri ?? null}
            url={meta.data?.image_url ?? null}
            alt={name}
            loading="eager"
            className="h-28 w-28 rounded-lg object-cover shadow-lg"
            fallback={null}
          />
          <div className="text-center">
            <p className="text-base font-semibold text-zinc-100">{name}</p>
            <p className="mt-1 text-sm text-zinc-400">drop this one in?</p>
            <p className="mt-1 text-xs text-zinc-500">
              sign to reveal what comes back out
            </p>
          </div>
          <div className="flex w-full gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 rounded-lg border border-zinc-700 py-3 text-sm uppercase tracking-wide text-zinc-300 disabled:opacity-50"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="flex-1 rounded-lg bg-amber-600 py-3 text-sm font-semibold uppercase tracking-wide text-amber-50 disabled:opacity-50"
            >
              {submitting ? "swapping…" : "drop in"}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
