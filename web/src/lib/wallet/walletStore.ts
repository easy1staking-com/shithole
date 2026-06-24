/**
 * Wallet connection state — Zustand store. Mounted once at the app root
 * (no React context wrapping needed: Zustand stores are global).
 *
 * Persists the last-used wallet name in localStorage so a refresh can
 * silently re-connect without prompting the user.
 */

"use client";

import { create } from "zustand";

import { describeError } from "@/lib/errors";

import {
  detectInstalledWallets,
  type Cip30Api,
  type Cip30WalletEntry,
} from "./cip30";

const LAST_USED_WALLET_KEY = "shithole.lastUsedWallet";

// Dev-only diagnostic logging for the focus listener + refresh path.
// User reported "auto-reconnect doesn't always work" — these traces
// let them watch the listener fire in the browser console. Stripped
// out by Next's prod minifier (NODE_ENV=production).
const DEBUG_WALLET = process.env.NODE_ENV !== "production";
function debugWallet(...args: unknown[]) {
  if (DEBUG_WALLET) console.debug("[wallet]", ...args);
}

let refreshInFlight: Promise<boolean> | null = null;

export type WalletState = {
  /** The wallet name (eternl / vespr / lace / …). */
  name: string | null;
  /** The post-enable API. Held in memory; cleared on disconnect. */
  api: Cip30Api | null;
  /** First used address — hex bytes as returned by CIP-30. */
  addressHex: string | null;
  /** Same address as bech32. Filled lazily by the connect flow. */
  addressBech32: string | null;
  /** Payment-key hash of the connected address (28-byte hex). */
  paymentKeyHashHex: string | null;
  /** Network id as reported by the wallet (0 = testnet, 1 = mainnet). */
  networkId: number | null;
  /** True while a connect is in flight. */
  connecting: boolean;
  /** Last connect error message, if any. */
  error: string | null;
};

export type WalletActions = {
  /** Detect installed wallets in priority order. */
  list: () => { name: string; entry: Cip30WalletEntry }[];
  /**
   * Connect to a wallet by name. Resolves the first used address and its
   * payment-key hash. Persists the wallet name in localStorage on success.
   */
  connect: (name: string) => Promise<void>;
  /**
   * Disconnect from the wallet.
   *
   * <p>{@code reason="user"} (default) means the user explicitly clicked
   * the disconnect affordance — clears the "last-used wallet" sticky
   * record so we don't silently reconnect on next page load.
   *
   * <p>{@code reason="auto"} means the focus listener detected the
   * wallet is no longer authorising us (revoked, closed, etc.) —
   * preserve the lastUsedWallet record so we CAN silently reconnect if
   * the user re-approves us in their wallet UI later.
   */
  disconnect: (reason?: "user" | "auto") => void;
  /** Set the bech32 / pkh fields after the lucid bridge has decoded them. */
  setDecodedAddress: (bech32: string, paymentKeyHashHex: string) => void;
  /**
   * Re-poll the connected wallet's state (used + change address, network).
   * Three paths:
   * <ol>
   *   <li>Currently disconnected but {@link lastUsedWalletName} is set
   *       AND the wallet still reports {@code isEnabled() === true} →
   *       silently reconnect.</li>
   *   <li>Currently connected and still authorised → re-poll address +
   *       networkId; update if changed.</li>
   *   <li>Currently connected but no longer authorised → auto-disconnect
   *       (preserving the lastUsedWallet record so a re-approval can
   *       silently reconnect later).</li>
   * </ol>
   * Returns {@code true} if any state changed; {@code false} for no-op.
   *
   * <p>CIP-30 has no native event hooks for account/wallet/network
   * changes; we trigger this on window focus + visibilitychange so the
   * UI catches up when the user comes back to the tab after fiddling
   * with their wallet.
   */
  refresh: () => Promise<boolean>;
};

export const useWalletStore = create<WalletState & WalletActions>(
  (set, get) => ({
    name: null,
    api: null,
    addressHex: null,
    addressBech32: null,
    paymentKeyHashHex: null,
    networkId: null,
    connecting: false,
    error: null,

    list: () => detectInstalledWallets(),

    connect: async (name) => {
      if (typeof window === "undefined" || !window.cardano) {
        set({ error: "no Cardano wallet detected" });
        return;
      }
      const entry = window.cardano[name];
      if (!entry) {
        set({ error: `wallet "${name}" is not installed` });
        return;
      }
      set({ connecting: true, error: null });
      try {
        const api = await entry.enable();
        const networkId = await api.getNetworkId();
        const usedAddresses = await api.getUsedAddresses();
        const addressHex =
          usedAddresses[0] ?? (await api.getChangeAddress());
        if (!addressHex) {
          throw new Error("wallet has no addresses");
        }
        set({
          name,
          api,
          addressHex,
          networkId,
          connecting: false,
          error: null,
        });
        try {
          window.localStorage.setItem(LAST_USED_WALLET_KEY, name);
        } catch {
          /* localStorage unavailable — non-fatal */
        }
      } catch (err) {
        const message = describeError(err);
        set({
          connecting: false,
          error: message,
          name: null,
          api: null,
          addressHex: null,
          addressBech32: null,
          paymentKeyHashHex: null,
        });
      }
    },

    disconnect: (reason = "user") => {
      // Only clear the "remember this wallet" record when the USER
      // explicitly clicked disconnect. Auto-detected disconnects (the
      // focus listener noticed isEnabled()===false) should preserve it
      // so re-approval in the wallet UI can silently reconnect later.
      if (reason === "user") {
        try {
          window.localStorage.removeItem(LAST_USED_WALLET_KEY);
        } catch {
          /* ignore */
        }
      }
      set({
        name: null,
        api: null,
        addressHex: null,
        addressBech32: null,
        paymentKeyHashHex: null,
        networkId: null,
        error: null,
      });
      // Touch `get` to keep TS happy about the unused destructure
      void get;
    },

    setDecodedAddress: (bech32, paymentKeyHashHex) =>
      set({ addressBech32: bech32, paymentKeyHashHex }),

    refresh: async () => {
      if (refreshInFlight) return refreshInFlight;

      const run = (async () => {
        const { api, addressHex, name } = get();
        debugWallet("refresh()", { connected: !!api, name });

        // Path 1: disconnected. Try silent reconnect from lastUsedWallet
        // if the wallet still reports isEnabled()===true (i.e. the user
        // re-approved us in their wallet UI after we'd auto-disconnected).
        if (!api) {
          if (typeof window === "undefined" || !window.cardano) return false;
          const lastName = lastUsedWalletName();
          if (!lastName) return false;
          const entry = window.cardano[lastName];
          if (!entry || typeof entry.isEnabled !== "function") return false;
          try {
            const enabled = await entry.isEnabled();
            debugWallet("silent-reconnect check", { lastName, enabled });
            if (!enabled) return false;
            await get().connect(lastName);
            return true;
          } catch (err) {
            debugWallet("silent-reconnect failed", err);
            return false;
          }
        }

        try {
          // Path 3: confirm we're still authorised before polling state.
          if (typeof window !== "undefined" && window.cardano && name) {
            const entry = window.cardano[name];
            if (entry && typeof entry.isEnabled === "function") {
              const stillEnabled = await entry.isEnabled();
              if (!stillEnabled) {
                debugWallet("wallet revoked → auto-disconnect");
                // 'auto' preserves lastUsedWallet so the next focus event
                // can silently reconnect via Path 1 above.
                get().disconnect("auto");
                return true;
              }
            }
          }
          // Path 2: still authorised. Poll address + network in case the
          // user switched accounts or networks.
          const usedAddresses = await api.getUsedAddresses();
          const newAddressHex =
            usedAddresses[0] ?? (await api.getChangeAddress());
          if (!newAddressHex) {
            debugWallet("no addresses → auto-disconnect");
            get().disconnect("auto");
            return true;
          }
          if (newAddressHex === addressHex) return false;
          // Address changed. Re-poll networkId too — a network switch in
          // the wallet UI changes BOTH the address (network bit) and
          // networkId; the old code only updated the address, leaving a
          // stale networkId in the store. Re-decode bech32+pkh lazily by
          // clearing them so the WalletConnectButton's effect recomputes.
          let newNetworkId: number | null = null;
          try {
            newNetworkId = await api.getNetworkId();
          } catch {
            /* keep old networkId if the wallet doesn't expose it cleanly */
          }
          debugWallet("address changed", {
            oldNetworkId: get().networkId,
            newNetworkId,
          });
          set({
            addressHex: newAddressHex,
            addressBech32: null,
            paymentKeyHashHex: null,
            networkId: newNetworkId ?? get().networkId,
          });
          return true;
        } catch (err) {
          // Wallet API throwing during isEnabled / getUsedAddresses
          // typically means the user revoked us; treat as auto-disconnect
          // so we can silently reconnect on re-approval.
          debugWallet("refresh threw → auto-disconnect", err);
          get().disconnect("auto");
          return true;
        }
      })();

      const tracked = run.finally(() => {
        if (refreshInFlight === tracked) refreshInFlight = null;
      });
      refreshInFlight = tracked;
      return tracked;
    },
  }),
);

/**
 * Mount once at the app root. Re-polls the wallet whenever the tab
 * becomes visible or the window regains focus — catches wallet
 * switches the user made in another tab.
 *
 * <p>Idempotent: safe to import from React effects (the listener
 * registration is tracked at module scope).
 */
let listenersInstalled = false;
export function installWalletFocusListeners(): () => void {
  if (typeof window === "undefined") return () => {};
  if (listenersInstalled) return () => {};
  listenersInstalled = true;
  debugWallet("focus listeners installed");
  const onFocus = () => {
    debugWallet("window focus → refresh");
    // Inline use to avoid React-hook constraints — this runs from
    // a DOM event handler outside the React tree.
    void useWalletStore.getState().refresh();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      debugWallet("visibilitychange → visible → refresh");
      void useWalletStore.getState().refresh();
    }
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    listenersInstalled = false;
    debugWallet("focus listeners removed");
  };
}

export function lastUsedWalletName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_USED_WALLET_KEY);
  } catch {
    return null;
  }
}
