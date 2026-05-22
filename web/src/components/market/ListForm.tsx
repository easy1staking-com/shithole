"use client";

import Link from "next/link";
import { useState } from "react";

import { marketplaceManifest } from "@/lib/market/config";
import { submitMarketList } from "@/lib/tx/marketList";
import { makeClient } from "@/lib/tx/evolutionClient";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Bare-bones "list on marketplace" form. Single-asset listing; the
 * caller types the asset unit, price denomination, price quantity, and
 * accompanying-lovelace bond. Bulk batching (lock N items in one tx)
 * is supported by {@link submitMarketList} already — just needs UI.
 */
export function ListForm() {
  const manifest = marketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);
  const walletAddress = useWalletStore((s) => s.addressBech32);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);

  const [unit, setUnit] = useState("");
  const [unitQty, setUnitQty] = useState("1");
  const [pricePolicy, setPricePolicy] = useState("");
  const [priceName, setPriceName] = useState("");
  const [priceQty, setPriceQty] = useState("10000000");
  const [bondLovelace, setBondLovelace] = useState("1500000");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ txHash: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!manifest || !walletApi || !walletAddress || !walletPkh) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const client = await makeClient(walletApi);
      const txRes = await submitMarketList(client, {
        marketplaceAddress: manifest.marketplaceAddress,
        listings: [
          {
            unit: unit.toLowerCase().replace(/\s+/g, ""),
            qty: BigInt(unitQty),
            datum: {
              sellerPkhHex: walletPkh,
              sellerBech32Address: walletAddress,
              pricePolicyHex: pricePolicy.toLowerCase().replace(/\s+/g, ""),
              priceNameHex: priceName.toLowerCase().replace(/\s+/g, ""),
              priceQty: BigInt(priceQty),
              accompanyingLovelace: BigInt(bondLovelace),
            },
          },
        ],
      });
      setResult({ txHash: txRes.txHash });
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
          ← back
        </Link>
      </nav>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">list on marketplace</h1>
        <p className="text-sm text-zinc-400">
          single-asset listing. price is inclusive of the 2 % fee.
        </p>
      </header>

      {!manifest ? (
        <p className="text-sm text-amber-300">
          marketplace not deployed in this env. see{" "}
          <Link href="/market/dev-tools" className="underline">
            dev tools
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-3">
          <Field
            label="asset unit (policy + name hex)"
            value={unit}
            onChange={setUnit}
            placeholder="aabbcc…484f534b59"
            mono
          />
          <Field label="quantity to list" value={unitQty} onChange={setUnitQty} />
          <Field
            label="price token policy (empty = ADA)"
            value={pricePolicy}
            onChange={setPricePolicy}
            mono
          />
          <Field
            label="price token name (empty = ADA)"
            value={priceName}
            onChange={setPriceName}
            mono
          />
          <Field
            label="price (inclusive of 2 % fee, e.g. 10000000 for 10 ADA)"
            value={priceQty}
            onChange={setPriceQty}
          />
          <Field
            label="accompanying lovelace bond (≥ 1.5 ADA for CNT listings)"
            value={bondLovelace}
            onChange={setBondLovelace}
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !walletApi}
            className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800"
          >
            {busy ? "signing…" : "list it"}
          </button>
          {err ? (
            <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {err}
            </p>
          ) : null}
          {result ? (
            <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
              ↗ {result.txHash}
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none ${
          mono ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}

