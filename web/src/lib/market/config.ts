/**
 * Marketplace feature flag + deployed-address registry.
 *
 * <p>The marketplace UI ships behind a build-time env flag
 * ({@code NEXT_PUBLIC_FEATURE_MARKETPLACE}) so it can be merged to dev/main
 * before being exposed in production. Any non-empty value other than
 * {@code "off"} / {@code "false"} / {@code "0"} turns it on.
 *
 * <p>Addresses for the deployed jar + marketplace scripts come from
 * {@link marketplaceManifest()} — falls back to {@code manifest.json} on
 * disk (committed; populated post-deploy) but reads {@code localStorage}
 * first when running in a browser so a developer can iterate on a freshly
 * deployed pair without re-committing.
 */

import committedManifest from "./manifest.json";

export type MarketplaceManifest = {
  /** Network the addresses belong to ("preprod", "preview", "mainnet"). */
  network: string;
  /** 28-byte hex hash of the parameterized jar validator. */
  jarScriptHash: string;
  /** Bech32 jar address (derived from jarScriptHash). */
  jarAddress: string;
  /** 28-byte hex hash of the marketplace validator (parameterized on jarScriptHash). */
  marketplaceScriptHash: string;
  /** Bech32 marketplace address. */
  marketplaceAddress: string;
  /** 28-byte hex pkh that admins the jar (Sweep authority). */
  adminPkhHex: string;
  /** When the deploy ran (ISO 8601). Diagnostic. */
  deployedAt: string;
};

const LOCAL_STORAGE_KEY = "shithole.marketplace.manifest.v1";

export function isMarketplaceEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_MARKETPLACE;
  if (!v) return false;
  const norm = v.toLowerCase().trim();
  return norm !== "off" && norm !== "false" && norm !== "0";
}

/**
 * Resolve the manifest at runtime. Browser: localStorage override first,
 * then the committed JSON. Server/build: just the committed JSON. Returns
 * null when no manifest is populated yet (committed template has empty
 * addresses; treat as "not deployed").
 */
export function marketplaceManifest(): MarketplaceManifest | null {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MarketplaceManifest;
        if (manifestIsPopulated(parsed)) return parsed;
      }
    } catch {
      // localStorage unavailable / parse error — fall back to committed.
    }
  }
  const m = committedManifest as MarketplaceManifest;
  return manifestIsPopulated(m) ? m : null;
}

/**
 * Persist a freshly-deployed manifest in the current browser. Use cases:
 * the dev-tools page calls this right after the user signs a deploy tx.
 * The committed manifest.json stays untouched until the user explicitly
 * exports + commits.
 */
export function persistManifestLocally(manifest: MarketplaceManifest): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(manifest));
}

export function clearLocalManifest(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function manifestIsPopulated(m: MarketplaceManifest | null): boolean {
  return !!(
    m &&
    m.jarScriptHash &&
    m.jarAddress &&
    m.marketplaceScriptHash &&
    m.marketplaceAddress
  );
}
