"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Starts the MSW worker once on the client when NEXT_PUBLIC_API_MODE === "mock"
 * and blocks rendering of `children` until the worker is registered. This
 * prevents the first burst of fetches from racing the service-worker
 * registration in dev (which otherwise leads to spurious 404s from Next
 * before the SW takes control).
 *
 * In any other mode (pointing at a real BE, or unset env var in prod
 * builds) this is a transparent passthrough.
 */
export function MswGate({ children }: { children: ReactNode }) {
  // Default to mock mode in dev unless explicitly overridden to "live".
  // Explicit values: "mock" forces on, "live" forces off.
  const apiMode = process.env.NEXT_PUBLIC_API_MODE;
  const useMocks =
    apiMode === "mock" ||
    (apiMode !== "live" && process.env.NODE_ENV === "development");
  const [ready, setReady] = useState(!useMocks);

  useEffect(() => {
    if (!useMocks) return;
    let cancelled = false;
    (async () => {
      const { worker } = await import("@/mocks/browser");
      await worker.start({
        // Let unmatched requests (Next assets, fonts, HMR) hit the network.
        onUnhandledRequest: "bypass",
        serviceWorker: { url: "/mockServiceWorker.js" },
      });
      if (!cancelled) setReady(true);
    })().catch((err: unknown) => {
      // Don't deadlock the UI if MSW fails to register — unblock rendering
      // and let real fetches fail loudly in the console.
      console.error("[MSW] failed to start", err);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [useMocks]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-zinc-500">
        warming up the mud…
      </div>
    );
  }
  return <>{children}</>;
}
