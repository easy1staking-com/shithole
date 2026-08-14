"use client";

import { MarketNav } from "@/components/market/MarketNav";
import {
  clearLocalManifest,
  marketplaceManifest,
  persistManifestLocally,
} from "@/lib/market/config";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { getNetworkName } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Dev-only tooling page. Captures the slim deployment decision (network +
 * admin pkh) into localStorage; the rest of the marketplace UI re-derives
 * jar + marketplace addresses from current bytecode on every read, so this
 * page no longer needs to "stage" a frozen address bundle.
 *
 * <p>The derived view below is informational only — useful for copying
 * the live addresses into off-chain scripts. It refreshes automatically
 * whenever the slim manifest changes; no "derive" button required.
 *
 * <p>The off-chain runbook (mint a HOSKY-shaped fungible, seed the initial
 * jar UTxO) still lives in {@code scripts/marketplace/README.md}.
 */
export function DevTools() {
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const current = marketplaceManifest();
  const { data: derived, loading, error } = useDerivedMarketplaceManifest();

  const stageConnectedWallet = () => {
    if (!walletPkh) return;
    persistManifestLocally({
      network: getNetworkName(),
      adminPkhHex: walletPkh,
      deployedAt: new Date().toISOString(),
    });
    window.location.reload();
  };

  const clear = () => {
    clearLocalManifest();
    window.location.reload();
  };

  const connectedMatchesActive =
    !!current &&
    !!walletPkh &&
    current.adminPkhHex.toLowerCase() === walletPkh.toLowerCase() &&
    current.network === getNetworkName();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <MarketNav back={{ href: "/", label: "← back to market" }} />
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">dev tools</h1>
        <p className="text-sm text-zinc-400">
          the marketplace manifest only persists{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5">network</code> +{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5">adminPkhHex</code>;
          jar and marketplace addresses are recomputed from the current
          bytecode on every read. so contract rebuilds don&apos;t orphan
          listings any more — no &quot;redeploy&quot; ritual needed.
        </p>
        <p className="text-sm text-zinc-400">
          for shared dev paste the slim JSON into{" "}
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

      {/* ---- Set / replace the admin in localStorage ---- */}
      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
          set admin from connected wallet
        </h2>
        {walletPkh ? (
          <p className="break-all font-mono text-xs text-zinc-400">
            connected pkh: {walletPkh}
          </p>
        ) : (
          <p className="text-xs text-zinc-500">connect a wallet first.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={stageConnectedWallet}
            disabled={!walletPkh || connectedMatchesActive}
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {connectedMatchesActive
              ? "this wallet is already the admin"
              : "set as admin (localStorage)"}
          </button>
          {current ? (
            <button
              type="button"
              onClick={clear}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400"
            >
              clear localStorage override
            </button>
          ) : null}
        </div>
      </section>

      {/* ---- Current slim manifest (what's persisted) ---- */}
      {current ? (
        <section className="space-y-2 rounded-lg border border-zinc-900 bg-zinc-950 p-4 text-xs">
          <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
            slim manifest (persisted)
          </h2>
          <pre className="overflow-x-auto break-all font-mono text-zinc-300">
            {JSON.stringify(current, null, 2)}
          </pre>
        </section>
      ) : (
        <section className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4 text-xs text-amber-200">
          no manifest configured yet. connect a wallet and click &quot;set as
          admin&quot; above to stage one in this browser&apos;s localStorage.
        </section>
      )}

      {/* ---- Live derived addresses (recomputed on every read) ---- */}
      <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs">
        <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
          derived addresses (recomputed from current bytecode)
        </h2>
        {loading ? (
          <p className="text-zinc-500">deriving…</p>
        ) : error ? (
          <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-red-300">
            {error}
          </p>
        ) : derived ? (
          <>
            <pre className="overflow-x-auto break-all font-mono text-zinc-200">
              {JSON.stringify(derived, null, 2)}
            </pre>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(derived, null, 2))
              }
              className="rounded border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-300"
            >
              copy JSON
            </button>
          </>
        ) : (
          <p className="text-zinc-500">
            (no manifest — set one above to derive)
          </p>
        )}
      </section>
    </main>
  );
}
