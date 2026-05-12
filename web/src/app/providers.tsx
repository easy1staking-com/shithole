"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

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
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <MswGate>{children}</MswGate>
    </QueryClientProvider>
  );
}
