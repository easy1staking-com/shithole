"use client";

import { initCardanoDAppConnectorBridge } from "@eternl/cardano-dapp-connector-bridge";
import { useEffect } from "react";

import { useWalletStore } from "./walletStore";

/**
 * Init Eternl's CIP-30 connector bridge once on the client. Required
 * when the dApp is loaded inside Eternl's dApp browser — desktop tab on
 * eternl.io, the iOS / Android in-app browser, or any iframed surface —
 * because Eternl doesn't inject `window.cardano.eternl` into the
 * webview. The bridge wires postMessage so the standard CIP-30 surface
 * appears once Eternl handshakes the iframe.
 *
 * <p>SSR-safe: the underlying init no-ops when `window` is undefined.
 * Idempotent: also no-ops when `window.cardano.eternl` already exists
 * (extension is installed). So mounting unconditionally in the root
 * provider tree has zero effect outside the dApp-browser case.
 *
 * <p><b>On handshake → auto-connect.</b> Inside a dApp browser the user
 * already trusted us by typing/picking us in their wallet UI, so we
 * skip the wallet picker entirely and call {@code connect("eternl")}
 * directly. This also sidesteps a re-render trap: our installed-wallet
 * snapshot caches by {@code window.cardano} object identity, and the
 * bridge mutates a property on that object (doesn't replace it), so
 * the picker would otherwise never observe the new entry.
 */
export function EternlBridgeInit() {
  useEffect(() => {
    try {
      initCardanoDAppConnectorBridge(() => {
        const store = useWalletStore.getState();
        if (store.name || store.connecting) return;
        void store.connect("eternl");
      });
    } catch (err) {
      console.warn("Eternl dApp-bridge init failed", err);
    }
  }, []);
  return null;
}
