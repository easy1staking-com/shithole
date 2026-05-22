"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { marketplaceManifest } from "@/lib/market/config";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import { makeClient } from "@/lib/tx/evolutionClient";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Browse view for /market. Polls Blockfrost for UTxOs at the marketplace
 * address (read from {@link marketplaceManifest}), decodes inline-datums
 * into a typed list, and supports a client-side filter on the listed
 * asset's policy id — typing a 56-hex string narrows to one collection.
 */
export function MarketBrowse() {
  const manifest = marketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);

  const [listings, setListings] = useState<DecodedListing[] | null>(null);
  const [policyFilter, setPolicyFilter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!manifest || !walletApi) return;
    setLoading(true);
    setErr(null);
    try {
      const client = await makeClient(walletApi);
      const found = await fetchMarketListings(
        client,
        manifest.marketplaceAddress,
      );
      setListings(found);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [manifest, walletApi]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!listings) return [];
    const p = policyFilter.trim().toLowerCase();
    if (!p) return listings;
    return listings.filter((l) =>
      l.listedUnits.some((u) => u.startsWith(p)),
    );
  }, [listings, policyFilter]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← home
        </Link>
        <Link href="/market/new" className="hover:text-zinc-300">
          list something →
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">marketplace</h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          any Cardano native asset, priced in any token. 2 % protocol fee
          taken from the price; tip in ADA if you want. dev feature.
        </p>
      </header>

      {!manifest ? (
        <ManifestEmptyState />
      ) : (
        <>
          <input
            type="text"
            value={policyFilter}
            onChange={(e) => setPolicyFilter(e.target.value)}
            placeholder="filter by policy id (56 hex chars)…"
            spellCheck={false}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none"
          />

          {err ? (
            <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {err}
            </p>
          ) : null}

          {!walletApi ? (
            <p className="text-sm text-zinc-500">connect a wallet to browse.</p>
          ) : loading ? (
            <p className="text-sm text-zinc-500">scanning the marketplace…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {listings && listings.length > 0
                ? "no listings match that policy id."
                : "nothing listed yet — be the first."}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((l) => (
                <li key={`${l.utxo.txHash}:${l.utxo.outputIndex}`}>
                  <ListingCard listing={l} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function ListingCard({ listing }: { listing: DecodedListing }) {
  const u = listing.listedUnits[0] ?? "";
  const detailHref = `/market/${u}?utxo=${listing.utxo.txHash}.${listing.utxo.outputIndex}`;
  const priceUnit = (
    listing.datum.pricePolicyHex + listing.datum.priceNameHex
  ).toLowerCase();
  const priceLabel =
    priceUnit === "" ? "₳" : `${priceUnit.slice(0, 8)}…`;
  return (
    <Link
      href={detailHref}
      className="block rounded-lg border border-zinc-800 bg-zinc-950 p-4 transition hover:border-zinc-700"
    >
      <div className="space-y-2">
        <div className="break-all font-mono text-xs text-zinc-500">{u}</div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-zinc-100">
            {String(listing.datum.priceQty)} {priceLabel}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            {listing.listedUnits.length === 1
              ? "1 asset"
              : `${listing.listedUnits.length} assets`}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ManifestEmptyState() {
  return (
    <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
      <p className="font-medium">marketplace not deployed yet</p>
      <p className="mt-1 text-amber-300/80">
        no jar + marketplace addresses in{" "}
        <code className="rounded bg-zinc-900 px-1 py-0.5">manifest.json</code>{" "}
        or local-storage. head to{" "}
        <Link className="underline" href="/market/dev-tools">
          /market/dev-tools
        </Link>{" "}
        to deploy on the current network.
      </p>
    </div>
  );
}
