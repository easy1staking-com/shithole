"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { marketplaceManifest } from "@/lib/market/config";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitMarketCancel } from "@/lib/tx/marketCancel";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Detail page for a single marketplace listing. Single-listing Buy is
 * wired in {@code lib/tx/marketBuy.ts} but UI wiring needs more SDK
 * plumbing (jar UTxO selection + sorted-input index resolution) than
 * fits in v1 — exposed as a "coming soon" hint here. Sellers can still
 * Cancel from this page.
 */
export function ListingDetail({ unit }: { unit: string }) {
  // Same reasoning as MarketBrowse: marketplaceManifest() returns a fresh
  // object per render, which makes the useEffect dep tick every time and
  // produces a re-fetch loop. Snapshot once.
  const manifest = useMemo(() => marketplaceManifest(), []);
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);

  const [listing, setListing] = useState<DecodedListing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);

  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  useEffect(() => {
    if (!marketplaceAddress || !walletApi) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await makeClient(walletApi);
        const all = await fetchMarketListings(client, marketplaceAddress);
        const match = all.find((l) =>
          l.listedUnits.includes(unit.toLowerCase()),
        );
        if (!cancelled) setListing(match ?? null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplaceAddress, walletApi, unit]);

  const isSeller = listing && walletPkh && listing.datum.sellerPkhHex === walletPkh;

  const onCancel = async () => {
    if (!manifest || !walletApi || !listing) return;
    setBusy(true);
    setErr(null);
    setTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: listing.utxo,
        sellerPkhHex: listing.datum.sellerPkhHex,
      });
      setTx(res.txHash);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/market" className="hover:text-zinc-300">
          ← back to market
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">listing</h1>
        <p className="break-all font-mono text-xs text-zinc-500">{unit}</p>
      </header>

      {!manifest ? (
        <p className="text-sm text-amber-300">marketplace not deployed.</p>
      ) : !listing ? (
        err ? (
          <p className="text-sm text-red-300">{err}</p>
        ) : (
          <p className="text-sm text-zinc-500">looking up the listing…</p>
        )
      ) : (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          <Row label="price">
            {String(listing.datum.priceQty)}{" "}
            {listing.datum.pricePolicyHex.length === 0 ? "₳" : "(CNT)"}
          </Row>
          <Row label="seller pkh">{listing.datum.sellerPkhHex}</Row>
          <Row label="bond lovelace">{String(listing.datum.accompanyingLovelace)}</Row>
          <Row label="utxo">
            {listing.utxo.txHash}.{listing.utxo.outputIndex}
          </Row>
          <div className="pt-2">
            {isSeller ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:bg-zinc-800"
              >
                {busy ? "signing…" : "cancel listing"}
              </button>
            ) : (
              <p className="text-xs text-zinc-500">
                buy flow lands in the next iteration — the tx builder
                exists at <code className="rounded bg-zinc-900 px-1">
                  lib/tx/marketBuy.ts
                </code>{" "}
                but needs the jar-UTxO pickup + sorted-input index
                resolution wired through this UI.
              </p>
            )}
          </div>
        </div>
      )}

      {err && listing ? (
        <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      ) : null}
      {tx ? (
        <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
          ↗ {tx}
        </p>
      ) : null}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 sm:w-32">
        {label}
      </span>
      <span className="break-all font-mono text-xs text-zinc-200">{children}</span>
    </div>
  );
}
