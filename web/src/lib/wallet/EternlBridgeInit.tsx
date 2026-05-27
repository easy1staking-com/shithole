"use client";

import { initCardanoDAppConnectorBridge } from "@eternl/cardano-dapp-connector-bridge";

import { useWalletStore } from "./walletStore";

/**
 * Init Eternl's CIP-30 connector bridge as early as possible on the
 * client. Required when the dApp is loaded inside Eternl's dApp browser
 * — eternl.io desktop tab, the iOS / Android in-app browser, or any
 * iframed surface — because Eternl doesn't inject `window.cardano.eternl`
 * into the webview. The bridge wires postMessage so the standard CIP-30
 * surface appears once Eternl handshakes the iframe.
 *
 * <p><b>Why module-level (not a useEffect).</b> Eternl's parent frame
 * sends the `connect` postMessage when the iframe's <code>load</code>
 * event fires. If our message listener is attached inside a useEffect,
 * it's queued behind React hydration and can land AFTER the connect
 * message has been posted (the bridge fires once, no retry). Attaching
 * at module-eval time runs synchronously during bundle execution —
 * strictly before hydration, strictly before the iframe load event —
 * so the handshake is never raced.
 *
 * <p>SSR-safe: the underlying init no-ops when `window` is undefined,
 * and we belt-and-brace with a `typeof window` guard here too.
 * Idempotent: the bridge no-ops if `window.cardano.eternl` already
 * exists (extension is installed), and a module-scope flag prevents
 * duplicate listener registration under HMR.
 *
 * <p><b>On handshake → auto-connect.</b> Inside a dApp browser the user
 * already trusted us by opening shithole there, so we skip the wallet
 * picker entirely and call {@code connect("eternl")} directly. This
 * also sidesteps a re-render trap: our installed-wallet snapshot
 * caches by {@code window.cardano} object identity, and the bridge
 * mutates a property on that object (doesn't replace it), so the
 * picker would otherwise never observe the new entry.
 */

const LOG_PREFIX = "[EternlBridge]";
let bridgeInitialised = false;

function initBridgeOnce(): void {
  if (bridgeInitialised) return;
  if (typeof window === "undefined") return;
  bridgeInitialised = true;
  try {
    console.log(`${LOG_PREFIX} attaching bridge listener`);
    initCardanoDAppConnectorBridge(() => {
      console.log(`${LOG_PREFIX} handshake complete → auto-connect`);
      const store = useWalletStore.getState();
      if (store.name || store.connecting) {
        console.log(`${LOG_PREFIX} skip auto-connect (already connected)`);
        return;
      }
      void store.connect("eternl");
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} init failed`, err);
  }
}

initBridgeOnce();

export function EternlBridgeInit() {
  return null;
}
