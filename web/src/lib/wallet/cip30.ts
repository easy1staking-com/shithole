/**
 * Minimal TypeScript types for the CIP-30 dApp connector API.
 *
 * Reference: https://cips.cardano.org/cip/CIP-30
 *
 * Only the surface we actually use is typed here — `enable()`,
 * `getUsedAddresses()`, `signData(addr, payload)`, `signTx`, `submitTx`.
 * Everything else is left as `unknown` so calls light up at compile time.
 */

/**
 * Augment Window with the CIP-30 wallet-discovery hook. Each installed
 * wallet injects itself at {@code window.cardano[name]} per CIP-30 §2.
 * Used to live in lucid-evolution's ambient types; declared here now
 * that lucid is gone.
 */
declare global {
  interface Window {
    cardano?: Record<string, Cip30WalletEntry | undefined>;
  }
}

/** Hex string. Not branded — too noisy for this little surface. */
export type Hex = string;

/** CIP-30 signData return: COSE_Sign1 + COSE_Key, both hex CBOR. */
export type Cip30DataSignature = {
  signature: Hex;
  key: Hex;
};

/**
 * The post-`enable()` API object — the actual dApp connector per
 * CIP-30. Inlined (rather than re-exporting an SDK type) so the wallet
 * detection module has zero SDK dependency. The CIP-30 surface is
 * spec-stable; if Evolution adds optional fields we accept them via
 * structural typing.
 *
 * <p>Addresses come back as hex-encoded Shelley address bytes (NOT
 * bech32). Use Evolution's `Address.fromBech32`/`getAddressDetails` to
 * round-trip if needed.
 */
export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getUtxos(): Promise<ReadonlyArray<string> | null | undefined>;
  getBalance(): Promise<string>;
  getUsedAddresses(): Promise<ReadonlyArray<string>>;
  getUnusedAddresses(): Promise<ReadonlyArray<string>>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<ReadonlyArray<string>>;
  signTx(txCborHex: string, partialSign: boolean): Promise<string>;
  signData(
    addressHex: string,
    payload: string,
  ): Promise<{ signature: string; key: string }>;
  submitTx(txCborHex: string): Promise<string>;
  experimental?: Record<string, unknown>;
}

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
