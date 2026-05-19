"use client";

/**
 * Small chain-confirmation pill — pairs with the tx-submitted success
 * state to surface whether {@code awaitTxConfirmation} has seen the tx
 * on chain. Three explicit states; renders nothing for {@code null}
 * (caller hasn't started watching).
 */
export type ChainConfirmation =
  | "confirming"
  | "confirmed"
  | "rejected"
  | null;

export function ConfirmationChip({ status }: { status: ChainConfirmation }) {
  if (status === "confirming") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        confirming on chain…
      </span>
    );
  }
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-950/60 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
        ✓ confirmed
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-red-950/60 px-1.5 py-0.5 font-mono text-[10px] text-red-200">
        ✗ not seen on chain — check the explorer
      </span>
    );
  }
  return null;
}
