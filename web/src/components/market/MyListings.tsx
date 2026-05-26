"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { marketplaceManifest } from "@/lib/market/config";
import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import {
  splitUnit,
  supportedPriceTokens,
} from "@/lib/market/supportedPriceTokens";
import { isSupportedCollection } from "@/lib/market/supportedCollections";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitMarketCancel } from "@/lib/tx/marketCancel";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Inline panel rendered at the bottom of the listing drawer: shows the
 * connected wallet's own marketplace listings with a one-click Cancel
 * per row. Filter is purely client-side — fetch every marketplace UTxO,
 * keep the ones whose datum.seller_pkh matches the wallet's payment pkh.
 */
export function MyListings() {
  const manifest = useMemo(() => marketplaceManifest(), []);
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);

  const [all, setAll] = useState<DecodedListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  const refresh = useCallback(async () => {
    if (!marketplaceAddress || !walletApi) return;
    setLoading(true);
    setErr(null);
    try {
      const client = await makeClient(walletApi);
      const list = await fetchMarketListings(client, marketplaceAddress);
      setAll(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [marketplaceAddress, walletApi]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mine = useMemo(
    () =>
      walletPkh
        ? all.filter(
            (l) =>
              l.datum.sellerPkhHex.toLowerCase() === walletPkh.toLowerCase() &&
              isSupportedCollection(l.listedUnits[0] ?? ""),
          )
        : [],
    [all, walletPkh],
  );

  const priceTokens = supportedPriceTokens();

  const onCancel = async (l: DecodedListing) => {
    if (!manifest || !walletApi) return;
    const k = `${l.utxo.txHash}:${l.utxo.outputIndex}`;
    setBusyKey(k);
    setErr(null);
    setTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketCancel(client, {
        network: toEvolutionNetwork(getNetworkName()),
        jarScriptHashHex: manifest.jarScriptHash,
        consumed: l.utxo,
        sellerPkhHex: l.datum.sellerPkhHex,
      });
      setTx(res.txHash);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  if (!walletPkh) return null;

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">
          your current listings
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded border border-zinc-800 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-300 disabled:opacity-50"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </header>

      {mine.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {loading ? "scanning…" : "you have no active listings."}
        </p>
      ) : (
        <ul className="space-y-2">
          {mine.map((l) => {
            const k = `${l.utxo.txHash}:${l.utxo.outputIndex}`;
            const unit = l.listedUnits[0] ?? "";
            const priceUnit = (
              l.datum.pricePolicyHex + l.datum.priceNameHex
            ).toLowerCase();
            const tok = priceTokens.find(
              (t) => (t.unit || "").toLowerCase() === priceUnit,
            );
            return (
              <li
                key={k}
                className="flex items-baseline justify-between gap-3 rounded border border-zinc-900 bg-zinc-950 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="break-all font-mono text-[10px] text-zinc-500">
                    {humanizeUnit(unit)}
                  </p>
                  <p className="font-mono text-zinc-200">
                    {tok
                      ? formatPriceQty(l.datum.priceQty, tok.decimals) +
                        " " +
                        tok.label
                      : `${l.datum.priceQty} ${priceUnit.slice(0, 8)}…`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onCancel(l)}
                  disabled={busyKey !== null}
                  className="shrink-0 rounded bg-red-700 px-2 py-1 text-[11px] font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busyKey === k ? "signing…" : "cancel"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {err ? (
        <p className="text-xs text-red-300">{err}</p>
      ) : null}
      {tx ? (
        <p className="break-all font-mono text-[10px] text-emerald-300">
          ↗ {tx}
        </p>
      ) : null}
    </section>
  );
}

function humanizeUnit(unit: string): string {
  if (!unit) return "?";
  if (unit.length <= 56) return unit;
  const name = unit.slice(56);
  try {
    let out = "";
    for (let i = 0; i < name.length; i += 2) {
      const code = parseInt(name.slice(i, i + 2), 16);
      if (code < 0x20 || code > 0x7e) throw new Error("non-printable");
      out += String.fromCharCode(code);
    }
    return out || unit.slice(0, 22) + "…";
  } catch {
    return unit.slice(0, 22) + "…";
  }
}

function formatPriceQty(qty: bigint, decimals: number): string {
  if (decimals === 0) return qty.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = qty / divisor;
  const frac = qty % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
