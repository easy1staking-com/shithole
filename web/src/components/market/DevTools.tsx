"use client";

import Link from "next/link";
import { useState } from "react";

import {
  clearLocalManifest,
  marketplaceManifest,
  persistManifestLocally,
  type MarketplaceManifest,
} from "@/lib/market/config";
import {
  applyJarScript,
  applyMarketplaceScript,
} from "@/lib/tx/marketScripts";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Dev-only tooling page. Derives jar + marketplace addresses for the
 * connected wallet (the admin), stages the deploy manifest in
 * localStorage, and exposes a JSON view the user can paste into
 * {@code web/src/lib/market/manifest.json} for shared dev.
 *
 * <p>Actual mint of a HOSKY-shaped fungible + initial-jar-UTxO seeding
 * are left as documented CLI steps for the first cut — building a
 * one-shot Native Script policy + the matching seeded UTxO from the
 * browser-wallet path needs more wiring than this page does in v0. See
 * {@code scripts/marketplace/README.md} for the off-chain runbook.
 */
export function DevTools() {
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const current = marketplaceManifest();

  const [derived, setDerived] = useState<MarketplaceManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deriveAddresses = async () => {
    if (!walletPkh) {
      setErr("connect a wallet first");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const networkName = getNetworkName();
      const network = toEvolutionNetwork(networkName);
      const jar = await applyJarScript(network, walletPkh);
      const mp = await applyMarketplaceScript(network, jar.scriptHash);
      setDerived({
        network: networkName,
        jarScriptHash: jar.scriptHash,
        jarAddress: jar.address,
        marketplaceScriptHash: mp.scriptHash,
        marketplaceAddress: mp.address,
        adminPkhHex: walletPkh,
        deployedAt: new Date().toISOString(),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stage = () => {
    if (!derived) return;
    persistManifestLocally(derived);
    // Reload to let the rest of the app re-read.
    window.location.reload();
  };

  const clear = () => {
    clearLocalManifest();
    window.location.reload();
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/market" className="hover:text-zinc-300">
          ← back to market
        </Link>
      </nav>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">dev tools</h1>
        <p className="text-sm text-zinc-400">
          derive jar + marketplace addresses from the connected wallet's pkh
          (admin) and stage them in localStorage for this browser. for shared
          dev paste the resulting JSON into{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5">
            web/src/lib/market/manifest.json
          </code>{" "}
          and commit. the off-chain runbook (mint HOSKY, seed the initial
          jar UTxO) lives in{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5">
            scripts/marketplace/README.md
          </code>
          .
        </p>
      </header>

      <div className="space-y-3">
        <button
          type="button"
          onClick={deriveAddresses}
          disabled={busy || !walletPkh}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:bg-zinc-800"
        >
          {busy ? "deriving…" : "derive addresses"}
        </button>
        {err ? (
          <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        ) : null}
      </div>

      {derived ? (
        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs">
          <pre className="overflow-x-auto break-all font-mono text-zinc-200">
            {JSON.stringify(derived, null, 2)}
          </pre>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={stage}
              className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-zinc-100"
            >
              stage in localStorage
            </button>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(derived, null, 2))
              }
              className="rounded border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-300"
            >
              copy JSON
            </button>
          </div>
        </section>
      ) : null}

      {current ? (
        <section className="space-y-2 rounded-lg border border-zinc-900 bg-zinc-950 p-4 text-xs">
          <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
            currently active manifest
          </h2>
          <pre className="overflow-x-auto break-all font-mono text-zinc-300">
            {JSON.stringify(current, null, 2)}
          </pre>
          <button
            type="button"
            onClick={clear}
            className="rounded border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-400"
          >
            clear localStorage override
          </button>
        </section>
      ) : null}
    </main>
  );
}
