"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { marketplaceManifest } from "@/lib/market/config";
import {
  splitUnit,
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import { submitMarketList } from "@/lib/tx/marketList";
import { makeClient } from "@/lib/tx/evolutionClient";
import { useWalletAssets, type WalletAsset } from "@/lib/wallet/useWalletAssets";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * /market/new — list one wallet asset for sale, priced in one of the
 * curated supported tokens (ADA / HOSKY / USDM). Asset to list is picked
 * from the connected wallet's holdings; price denomination is a dropdown
 * driven by {@link supportedPriceTokens} (preprod or mainnet entries).
 */
export function ListForm() {
  const manifest = useMemo(() => marketplaceManifest(), []);
  const walletApi = useWalletStore((s) => s.api);
  const walletAddress = useWalletStore((s) => s.addressBech32);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);

  const priceTokens = useMemo(() => supportedPriceTokens(), []);

  const { data: walletAssets, isLoading: assetsLoading, error: assetsError } =
    useWalletAssets(walletAddress);

  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [unitQty, setUnitQty] = useState("1");
  const [priceTokenUnit, setPriceTokenUnit] = useState<string>(priceTokens[0]?.unit ?? "");
  const [priceDisplay, setPriceDisplay] = useState("10");
  const [bondAda, setBondAda] = useState("2");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ txHash: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const selectedPriceToken = useMemo<SupportedPriceToken | null>(
    () => priceTokens.find((t) => t.unit === priceTokenUnit) ?? null,
    [priceTokens, priceTokenUnit],
  );

  // Convert the user's "10" + 6 decimals into "10000000" smallest units.
  const priceQtySmallest = useMemo<bigint | null>(() => {
    if (!selectedPriceToken) return null;
    return parseDecimal(priceDisplay, selectedPriceToken.decimals);
  }, [priceDisplay, selectedPriceToken]);

  const bondLovelace = useMemo<bigint | null>(
    () => parseDecimal(bondAda, 6),
    [bondAda],
  );

  const onSubmit = async () => {
    if (
      !manifest ||
      !walletApi ||
      !walletAddress ||
      !walletPkh ||
      !selectedUnit ||
      !selectedPriceToken ||
      priceQtySmallest === null ||
      bondLovelace === null
    ) {
      setErr("missing required fields");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const client = await makeClient(walletApi);
      const { policyHex, nameHex } = splitUnit(selectedPriceToken.unit);
      const txRes = await submitMarketList(client, {
        marketplaceAddress: manifest.marketplaceAddress,
        listings: [
          {
            unit: selectedUnit.toLowerCase(),
            qty: BigInt(unitQty),
            datum: {
              sellerPkhHex: walletPkh,
              sellerBech32Address: walletAddress,
              pricePolicyHex: policyHex,
              priceNameHex: nameHex,
              priceQty: priceQtySmallest,
              accompanyingLovelace: bondLovelace,
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
          pick an asset from your wallet, pick a price token, hit list.
          price is inclusive of the 2 % protocol fee.
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
      ) : !walletApi ? (
        <p className="text-sm text-zinc-500">connect a wallet to list.</p>
      ) : (
        <div className="space-y-5">
          {/* ---- Asset picker ---- */}
          <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs uppercase tracking-widest text-zinc-500">
                asset to list
              </h2>
              <span className="text-[10px] text-zinc-600">
                {assetsLoading
                  ? "loading…"
                  : `${walletAssets?.length ?? 0} non-ADA in wallet`}
              </span>
            </div>
            {assetsError ? (
              <p className="text-xs text-red-300">{String(assetsError)}</p>
            ) : !walletAssets || walletAssets.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {assetsLoading
                  ? "scanning wallet…"
                  : "wallet has no non-ADA assets."}
              </p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {walletAssets.map((a) => (
                  <AssetRow
                    key={a.unit}
                    asset={a}
                    isSelected={selectedUnit === a.unit}
                    onSelect={() => setSelectedUnit(a.unit)}
                  />
                ))}
              </ul>
            )}
            {selectedUnit ? (
              <div className="border-t border-zinc-900 pt-2">
                <Field
                  label="quantity to list"
                  value={unitQty}
                  onChange={setUnitQty}
                />
              </div>
            ) : null}
          </section>

          {/* ---- Price ---- */}
          <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              price (inclusive of 2 % fee)
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={priceDisplay}
                onChange={(e) => setPriceDisplay(e.target.value)}
                placeholder="10"
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-sky-700 focus:outline-none"
              />
              <select
                value={priceTokenUnit}
                onChange={(e) => setPriceTokenUnit(e.target.value)}
                className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
              >
                {priceTokens.map((t) => (
                  <option key={t.unit || "ada"} value={t.unit}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-zinc-500">
              {priceQtySmallest === null
                ? "invalid amount"
                : `on-chain price_qty = ${priceQtySmallest} (smallest unit)`}
            </p>
          </section>

          {/* ---- Bond ---- */}
          <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              accompanying lovelace bond (ADA)
            </h2>
            <input
              type="text"
              inputMode="decimal"
              value={bondAda}
              onChange={(e) => setBondAda(e.target.value)}
              placeholder="2"
              className="w-32 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500">
              flows from the listing UTxO out to the seller payout to
              cover min-UTxO when the price is in CNT. 1.5 ADA covers
              typical CNT payouts; bump for Hosky-style bloated bags.
            </p>
          </section>

          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !selectedUnit || priceQtySmallest === null || bondLovelace === null}
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

function AssetRow({
  asset,
  isSelected,
  onSelect,
}: {
  asset: WalletAsset;
  isSelected: boolean;
  onSelect: () => void;
}) {
  let nameAscii: string | null = null;
  try {
    nameAscii = hexToAscii(asset.assetNameHex);
  } catch {
    nameAscii = null;
  }
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-baseline justify-between gap-3 rounded border px-3 py-2 text-left text-xs transition ${
          isSelected
            ? "border-sky-700 bg-sky-950/40"
            : "border-zinc-900 hover:border-zinc-700"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="text-zinc-200">{nameAscii ?? asset.assetNameHex}</span>
          <span className="ml-2 text-[10px] text-zinc-500">qty {asset.quantity}</span>
        </span>
        <span className="break-all font-mono text-[10px] text-zinc-500">
          {asset.policyId.slice(0, 12)}…
        </span>
      </button>
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
      />
    </label>
  );
}

/**
 * Parse a decimal user input ("10.5") into smallest-unit bigint with the
 * given decimals. Returns null on malformed input.
 */
function parseDecimal(raw: string, decimals: number): bigint | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    const v = BigInt(whole + padded);
    return v >= 0n ? v : null;
  } catch {
    return null;
  }
}

function hexToAscii(hex: string): string {
  if (hex.length === 0) return "";
  if (hex.length % 2 !== 0) throw new Error("odd-length hex");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x20 || code > 0x7e) throw new Error("non-printable byte");
    out += String.fromCharCode(code);
  }
  return out;
}
