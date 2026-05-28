/**
 * Marketplace feature flag + admin/network registry.
 *
 * <p>The marketplace UI ships behind a build-time env flag
 * ({@code NEXT_PUBLIC_FEATURE_MARKETPLACE}) so it can be merged to dev/main
 * before being exposed in production. Any non-empty value other than
 * {@code "off"} / {@code "false"} / {@code "0"} turns it on.
 *
 * <p>The persisted manifest carries ONLY the values that encode a deployment
 * decision: which network, which admin pkh, and a diagnostic timestamp.
 * Every other field (jar script hash, jar address, marketplace script hash,
 * marketplace address) is derived at runtime via
 * {@link deriveMarketplaceManifest} from the current bytecode in
 * {@code plutus.json} + the admin pkh. This means a contract rebuild
 * automatically produces a new marketplace address without any manifest
 * editing or "redeploy" ritual — and prevents the entire class of bug where
 * a stale cached address forces tx-builders to attach the wrong script.
 */

import committedManifest from "./manifest.json";

import {
  applyJarScript,
  applyMarketplaceScript,
} from "@/lib/tx/marketScripts";
import { toEvolutionNetwork, type CardanoNetworkName } from "@/lib/wallet/network";

/**
 * Slim, persisted shape. The only fields here are "decisions" that can't
 * be re-derived from on-chain bytecode: which network and which admin pkh
 * the dApp is bound to. Everything else (hashes, addresses) is computed
 * on every read via {@link deriveMarketplaceManifest}.
 */
export type MarketplaceManifest = {
  /** Network the manifest belongs to ("preprod", "preview", "mainnet"). */
  network: string;
  /** 28-byte hex pkh that admins the jar (Sweep authority). */
  adminPkhHex: string;
  /** When the deploy decision was made (ISO 8601). Diagnostic only. */
  deployedAt: string;
};

/**
 * Full, runtime-derived shape consumed by tx-builders, listings queries,
 * the listing detail page, etc. {@code derivedAt} surfaces when the
 * derivation actually ran so consumers can debug staleness.
 */
export type DerivedMarketplaceManifest = MarketplaceManifest & {
  /** 28-byte hex hash of the parameterized jar validator. */
  jarScriptHash: string;
  /** Bech32 jar address. */
  jarAddress: string;
  /** 28-byte hex hash of the marketplace validator (parameterized on jarScriptHash). */
  marketplaceScriptHash: string;
  /** Bech32 marketplace address. */
  marketplaceAddress: string;
  /** When this derivation ran (ISO 8601). Diagnostic only. */
  derivedAt: string;
};

const LOCAL_STORAGE_KEY = "shithole.marketplace.manifest.v1";

export function isMarketplaceEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_MARKETPLACE;
  if (!v) return false;
  const norm = v.toLowerCase().trim();
  return norm !== "off" && norm !== "false" && norm !== "0";
}

/**
 * Separate nav-visibility gate so we can ship the marketplace code to prod
 * (routes reachable by direct URL for admin testing) WITHOUT surfacing the
 * 'market' submenu in the public header.
 *
 * <p>Reads {@code NEXT_PUBLIC_FEATURE_MARKETPLACE_NAV}. When unset, falls
 * back to {@link isMarketplaceEnabled} so existing dev/preprod envs that
 * only set the master flag continue to show the nav. Explicit values
 * 'off' / 'false' / '0' hide the nav; anything else surfaces it.
 */
export function isMarketplaceNavEnabled(): boolean {
  if (!isMarketplaceEnabled()) return false;
  const v = process.env.NEXT_PUBLIC_FEATURE_MARKETPLACE_NAV;
  if (v === undefined || v === null || v === "") return true;
  const norm = v.toLowerCase().trim();
  return norm !== "off" && norm !== "false" && norm !== "0";
}

/**
 * Resolve the slim manifest. Browser: localStorage override first, then
 * committed JSON. Server/build: committed JSON only. Returns null when no
 * manifest is populated (committed template has empty values; treat as
 * "not configured").
 *
 * <p>Older localStorage entries written before the manifest slimmed down
 * carried extra fields (jarScriptHash, marketplaceAddress, etc.). Those
 * are silently ignored — only {@code network} + {@code adminPkhHex} are
 * read.
 */
export function marketplaceManifest(): MarketplaceManifest | null {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MarketplaceManifest>;
        const slim = readSlim(parsed);
        if (slim) return slim;
      }
    } catch {
      // localStorage unavailable / parse error — fall back to committed.
    }
  }
  return readSlim(committedManifest as Partial<MarketplaceManifest>);
}

export function persistManifestLocally(manifest: MarketplaceManifest): void {
  if (typeof window === "undefined") return;
  const slim: MarketplaceManifest = {
    network: manifest.network,
    adminPkhHex: manifest.adminPkhHex.toLowerCase(),
    deployedAt: manifest.deployedAt,
  };
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(slim));
  // Bytecode/admin/network may have shifted — bust the derivation cache
  // so the next reader recomputes.
  resetDerivationCache();
}

export function clearLocalManifest(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  resetDerivationCache();
}

function readSlim(
  m: Partial<MarketplaceManifest> | null,
): MarketplaceManifest | null {
  if (!m) return null;
  if (!m.network || !m.adminPkhHex) return null;
  return {
    network: m.network,
    adminPkhHex: m.adminPkhHex.toLowerCase(),
    deployedAt: m.deployedAt ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime derivation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Compile the current jar + marketplace bytecode against the manifest's
 * admin pkh and return every address/hash the rest of the marketplace UI
 * needs. Pure async (loads blueprint JSON, runs UPLC apply, hashes); no
 * chain calls.
 */
export async function deriveMarketplaceManifest(
  slim: MarketplaceManifest,
): Promise<DerivedMarketplaceManifest> {
  const network = toEvolutionNetwork(slim.network as CardanoNetworkName);
  const jar = await applyJarScript(network, slim.adminPkhHex);
  const marketplace = await applyMarketplaceScript(network, jar.scriptHash);
  return {
    ...slim,
    jarScriptHash: jar.scriptHash,
    jarAddress: jar.address,
    marketplaceScriptHash: marketplace.scriptHash,
    marketplaceAddress: marketplace.address,
    derivedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* React hook                                                                 */
/* -------------------------------------------------------------------------- */

type CacheEntry = {
  key: string;
  promise: Promise<DerivedMarketplaceManifest>;
};

let derivationCache: CacheEntry | null = null;

function resetDerivationCache(): void {
  derivationCache = null;
}

export function manifestCacheKey(slim: MarketplaceManifest): string {
  return `${slim.network}|${slim.adminPkhHex.toLowerCase()}`;
}

/**
 * Resolve a derived manifest for a slim input, memoised across calls in
 * the same session. The cache key includes network + admin pkh; any other
 * mutation (a contract rebuild that ships new bytecode) requires a page
 * reload — the blueprint is fetched once and cached by the SDK's module
 * loader, so a reload is the natural cache-bust.
 */
export function getDerivedMarketplaceManifest(
  slim: MarketplaceManifest,
): Promise<DerivedMarketplaceManifest> {
  const key = manifestCacheKey(slim);
  if (derivationCache && derivationCache.key === key) {
    return derivationCache.promise;
  }
  const promise = deriveMarketplaceManifest(slim);
  derivationCache = { key, promise };
  promise.catch(() => {
    // Don't poison the cache on failure — let the next caller retry.
    if (derivationCache?.key === key) derivationCache = null;
  });
  return promise;
}

/* The React hook lives in {@code useDerivedMarketplaceManifest.ts} (a
 * client-only file) so this module stays importable from Server
 * Components like the marketplace route pages. */
