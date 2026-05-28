"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { EternlBridgeInit } from "@/lib/wallet/EternlBridgeInit";
import { installWalletFocusListeners } from "@/lib/wallet/walletStore";

import { MswGate } from "./MswBootstrap";

/**
 * Client-side providers tree. Mounted from the root layout.
 *
 * - QueryClient: per-mount instance so HMR doesn't share stale state.
 * - MswGate: starts MSW once on the client iff NEXT_PUBLIC_API_MODE === "mock"
 *   and blocks children from rendering (and therefore from firing fetches)
 *   until the worker is ready. In non-mock mode the gate is a passthrough.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // React Query has its own refetch-on-window-focus knob; we
            // leave it off and use the wallet-focus listener below to
            // drive selective revalidation (wallet state) rather than
            // refetching every query.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Re-poll connected wallet on tab focus / visibility change. CIP-30
  // exposes no native account-change event; this catches the case where
  // the user switched wallets or accounts while the tab was backgrounded.
  useEffect(() => installWalletFocusListeners(), []);

  return (
    <QueryClientProvider client={client}>
      {/* Eternl dApp-browser bridge (postMessage shim). No-op when the
          extension is installed or when SSR; only takes effect inside
          eternl.io and the iOS/Android in-wallet browsers, where
          window.cardano.eternl isn't injected directly. */}
      <EternlBridgeInit />
      <MswGate>{children}</MswGate>
    </QueryClientProvider>
  );
}
