"use client";

import { useEffect } from "react";

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
 */
export function EternlBridgeInit() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@eternl/cardano-dapp-connector-bridge");
        if (cancelled) return;
        mod.initCardanoDAppConnectorBridge(() => {
          // The wallet has handshaken with the iframe. By now
          // window.cardano.eternl is populated; the existing wallet
          // picker + persisted-reconnect machinery can find it via the
          // normal discovery path on the next render. No further action
          // required here.
        });
      } catch (err) {
        console.warn("Eternl dApp-bridge init failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
