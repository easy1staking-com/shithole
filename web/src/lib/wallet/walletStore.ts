/**
 * Wallet connection state — Zustand store. Mounted once at the app root
 * (no React context wrapping needed: Zustand stores are global).
 *
 * Persists the last-used wallet name in localStorage so a refresh can
 * silently re-connect without prompting the user.
 */

"use client";

import { create } from "zustand";

import {
  detectInstalledWallets,
  type Cip30Api,
  type Cip30WalletEntry,
} from "./cip30";

const LAST_USED_WALLET_KEY = "shithole.lastUsedWallet";

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
  disconnect: () => void;
  /** Set the bech32 / pkh fields after the lucid bridge has decoded them. */
  setDecodedAddress: (bech32: string, paymentKeyHashHex: string) => void;
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
        const message = err instanceof Error ? err.message : String(err);
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

    disconnect: () => {
      try {
        window.localStorage.removeItem(LAST_USED_WALLET_KEY);
      } catch {
        /* ignore */
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
  }),
);

export function lastUsedWalletName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_USED_WALLET_KEY);
  } catch {
    return null;
  }
}
