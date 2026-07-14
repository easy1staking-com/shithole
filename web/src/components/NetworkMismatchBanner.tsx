"use client";

/**
 * Persistent warning shown when the connected wallet's network doesn't
 * match the app's configured network. On a mismatch every tx silently
 * builds and then fails at submit, so this is a high-severity operational
 * warning — surfaced globally in the header, not per-flow.
 */

import { expectedNetworkId, getNetworkName } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

export function NetworkMismatchBanner() {
  const networkId = useWalletStore((s) => s.networkId);
  const connected = useWalletStore((s) => s.api != null);

  if (!connected || networkId == null) return null;

  const appNetwork = getNetworkName();
  if (networkId === expectedNetworkId(appNetwork)) return null;

  const walletNetwork = networkId === 1 ? "mainnet" : "a testnet";

  return (
    <div
      role="alert"
      className="border-b border-amber-900/70 bg-amber-950/60 px-3 py-1.5 text-center text-[11px] leading-tight text-amber-200 sm:text-xs"
    >
      <span className="font-semibold">Wrong network.</span> Your wallet is on{" "}
      {walletNetwork} but this app runs on <b>{appNetwork}</b> — switch networks
      in your wallet, or transactions will fail.
    </div>
  );
}
