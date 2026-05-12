"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  lastUsedWalletName,
  useWalletStore,
} from "./walletStore";
import { detectInstalledWallets, type Cip30WalletEntry } from "./cip30";

/** SSR-safe wallet detection via useSyncExternalStore. */
function useInstalledWallets() {
  return useSyncExternalStore(
    // No subscription — wallet injection happens at page load. Return a
    // noop unsubscribe so the hook stays a one-shot.
    () => () => {},
    () => detectInstalledWallets(),
    // Server snapshot: empty.
    () => [] as { name: string; entry: Cip30WalletEntry }[],
  );
}

function truncate(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/**
 * Small wallet-connect control. If no wallet is connected, shows an
 * "install/connect" dropdown listing the installed wallets in priority
 * order; if connected, shows the truncated bech32 address with a
 * disconnect affordance.
 */
export function WalletConnectButton({ className }: { className?: string }) {
  const {
    name,
    addressHex,
    addressBech32,
    connecting,
    error,
    connect,
    disconnect,
    setDecodedAddress,
  } = useWalletStore();
  const installed = useInstalledWallets();
  const [open, setOpen] = useState(false);

  // Decode the hex address once we have it. The helper is loaded lazily
  // so the WASM-backed CML doesn't enter the SSR bundle.
  useEffect(() => {
    if (!addressHex || addressBech32) return;
    let cancelled = false;
    void (async () => {
      try {
        const { decodeCip30Address } = await import("./decodeAddress");
        const decoded = await decodeCip30Address(addressHex);
        if (!cancelled) {
          setDecodedAddress(decoded.bech32, decoded.paymentKeyHashHex);
        }
      } catch (err) {
        // Don't deadlock the UI; surface the decode error via state.
        console.error("decodeCip30Address failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addressHex, addressBech32, setDecodedAddress]);

  // Silent re-connect on mount if the last-used wallet is still installed
  // and already approved (we don't auto-trigger `enable()`'s permission
  // prompt — we only re-connect if `isEnabled()` says yes).
  useEffect(() => {
    const lastName = lastUsedWalletName();
    if (!lastName || name) return;
    const entry = window.cardano?.[lastName];
    if (!entry || typeof entry.isEnabled !== "function") return;
    entry
      .isEnabled()
      .then((ok) => {
        if (ok) {
          void connect(lastName);
        }
      })
      .catch(() => {
        /* swallow — user can click connect */
      });
  }, [name, connect]);

  if (name && addressBech32) {
    return (
      <div className={`flex items-center gap-2 text-xs ${className ?? ""}`}>
        <span className="rounded-full bg-zinc-800 px-3 py-1 font-mono text-zinc-200">
          {name}: {truncate(addressBech32)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          className="text-zinc-400 hover:text-zinc-200"
        >
          disconnect
        </button>
      </div>
    );
  }

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:border-zinc-500 disabled:opacity-50"
      >
        {connecting ? "connecting…" : "connect wallet"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-zinc-800 bg-zinc-950 p-1 text-sm shadow-lg">
          {installed.length === 0 && (
            <div className="px-3 py-2 text-zinc-400">
              no Cardano wallet detected.{" "}
              <a
                href="https://eternl.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-200 underline"
              >
                install Eternl
              </a>
              .
            </div>
          )}
          {installed.map((w) => (
            <button
              key={w.name}
              type="button"
              onClick={() => {
                setOpen(false);
                void connect(w.name);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-zinc-100 hover:bg-zinc-800"
            >
              {w.entry.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={w.entry.icon}
                  alt=""
                  className="h-4 w-4"
                  aria-hidden
                />
              )}
              <span className="font-mono">{w.name}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="absolute right-0 top-full mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
