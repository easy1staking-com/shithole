/**
 * Minimal TypeScript types for the CIP-30 dApp connector API.
 *
 * Reference: https://cips.cardano.org/cip/CIP-30
 *
 * Only the surface we actually use is typed here — `enable()`,
 * `getUsedAddresses()`, `signData(addr, payload)`, `signTx`, `submitTx`.
 * Everything else is left as `unknown` so calls light up at compile time.
 */

/** Hex string. Not branded — too noisy for this little surface. */
export type Hex = string;

/** CIP-30 signData return: COSE_Sign1 + COSE_Key, both hex CBOR. */
export type Cip30DataSignature = {
  signature: Hex;
  key: Hex;
};

/**
 * The post-`enable()` API object — the actual dApp connector.
 *
 * We re-use the Evolution SDK's `WalletApi` type (declared on
 * `window.cardano[name]`) for compatibility — `import type` so the
 * heavy lucid module doesn't enter the SSR bundle just from a type.
 *
 * Evolution types `getUtxos` as `Promise<string[] | undefined>` rather
 * than `null`; we normalise that at the call site.
 *
 * Addresses come back as hex-encoded Shelley address bytes (NOT bech32).
 * Use Evolution SDK's `getAddressDetails` to round-trip to bech32.
 */
import type { WalletApi } from "@lucid-evolution/lucid";
export type Cip30Api = WalletApi;

/** The pre-`enable()` wallet entry on `window.cardano[name]`. */
export type Cip30WalletEntry = {
  name?: string;
  apiVersion?: string;
  icon?: string;
  enable: () => Promise<Cip30Api>;
  isEnabled: () => Promise<boolean>;
};

/** Priority order — eternl > vespr > lace > anything else. */
export const WALLET_PRIORITY = ["eternl", "vespr", "lace"] as const;
export type PriorityWalletName = (typeof WALLET_PRIORITY)[number];

/** Returns the list of installed CIP-30 wallets in priority order. */
export function detectInstalledWallets(): {
  name: string;
  entry: Cip30WalletEntry;
}[] {
  if (typeof window === "undefined" || !window.cardano) return [];
  const cardano = window.cardano as unknown as Record<string, Cip30WalletEntry | undefined>;
  const all: { name: string; entry: Cip30WalletEntry }[] = [];
  for (const [name, entry] of Object.entries(cardano)) {
    if (entry && typeof (entry as { enable?: unknown }).enable === "function") {
      all.push({ name, entry });
    }
  }

  // Sort by priority, then alphabetically.
  return all.sort((a, b) => {
    const ai = (WALLET_PRIORITY as readonly string[]).indexOf(a.name);
    const bi = (WALLET_PRIORITY as readonly string[]).indexOf(b.name);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}
