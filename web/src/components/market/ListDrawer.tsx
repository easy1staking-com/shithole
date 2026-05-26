"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MyListings } from "@/components/market/MyListings";
import { marketplaceManifest } from "@/lib/market/config";
import { supportedCollections } from "@/lib/market/supportedCollections";
import {
  splitUnit,
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import { submitMarketList } from "@/lib/tx/marketList";
import { makeClient } from "@/lib/tx/evolutionClient";
import { useNftMetadata } from "@/lib/api/hooks";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

const DEFAULT_BOND_LOVELACE = 2_000_000n;

/**
 * Listing drawer — replaces the legacy single-asset form. Pick N NFTs
 * from your wallet's HOSKY CashGrab balance, set a price per row OR
 * use the "same price for all" override at the top, hit list.
 *
 * <p>v1 ships HOSKY CashGrab only via {@link supportedCollections}; the
 * top of the page picks a collection if we ever add more.
 */
export function ListDrawer() {
  const manifest = useMemo(() => marketplaceManifest(), []);
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const walletAddress = useWalletStore((s) => s.addressBech32);

  const collections = useMemo(() => supportedCollections(), []);
  const collection = collections[0] ?? null;

  const priceTokens = useMemo(() => supportedPriceTokens(), []);

  const { data: walletNfts, isLoading: nftsLoading, error: nftsError } =
    useWalletCollectionNfts(walletAddress, collection?.policyId ?? null);

  // Selection + per-row overrides.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<
    Record<string, { displayPrice: string; tokenUnit: string }>
  >({});

  // Shared "same price for all" inputs.
  const [sameForAll, setSameForAll] = useState(true);
  const [sharedPrice, setSharedPrice] = useState("10");
  const [sharedTokenUnit, setSharedTokenUnit] = useState<string>(
    priceTokens[0]?.unit ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Bond default — autoMinUtxo on the submit handles the floor.
  const [bondLovelace] = useState<bigint>(DEFAULT_BOND_LOVELACE);

  const toggleSelect = useCallback((unit: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });
  }, []);

  const setOverride = useCallback(
    (unit: string, patch: Partial<{ displayPrice: string; tokenUnit: string }>) =>
      setOverrides((prev) => ({
        ...prev,
        [unit]: {
          displayPrice: patch.displayPrice ?? prev[unit]?.displayPrice ?? sharedPrice,
          tokenUnit: patch.tokenUnit ?? prev[unit]?.tokenUnit ?? sharedTokenUnit,
        },
      })),
    [sharedPrice, sharedTokenUnit],
  );

  const buildSubmission = (): SubmissionEntry[] | null => {
    if (selected.size === 0) {
      setErr("select at least one NFT");
      return null;
    }
    const out: SubmissionEntry[] = [];
    for (const unit of selected) {
      const rowDisplay = sameForAll
        ? sharedPrice
        : overrides[unit]?.displayPrice ?? sharedPrice;
      const rowUnit = sameForAll
        ? sharedTokenUnit
        : overrides[unit]?.tokenUnit ?? sharedTokenUnit;
      const token = priceTokens.find((t) => t.unit === rowUnit);
      if (!token) {
        setErr(`unknown price token for ${unit}`);
        return null;
      }
      const priceQty = parseDecimal(rowDisplay, token.decimals);
      if (priceQty === null || priceQty <= 0n) {
        setErr(`invalid price for ${humanUnit(unit)}: ${rowDisplay}`);
        return null;
      }
      out.push({ unit, qty: 1n, token, priceQty });
    }
    return out;
  };

  const onSubmit = async () => {
    if (!manifest || !walletApi || !walletAddress || !walletPkh) {
      setErr("connect a wallet first");
      return;
    }
    const submission = buildSubmission();
    if (!submission) return;
    setBusy(true);
    setErr(null);
    setTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitMarketList(client, {
        marketplaceAddress: manifest.marketplaceAddress,
        listings: submission.map((s) => {
          const { policyHex, nameHex } = splitUnit(s.token.unit);
          return {
            unit: s.unit.toLowerCase(),
            qty: s.qty,
            datum: {
              sellerPkhHex: walletPkh,
              sellerBech32Address: walletAddress,
              pricePolicyHex: policyHex,
              priceNameHex: nameHex,
              priceQty: s.priceQty,
              accompanyingLovelace: bondLovelace,
            },
          };
        }),
      });
      setTx(res.txHash);
      setSelected(new Set());
      setOverrides({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/market" className="hover:text-zinc-300">
          ← back
        </Link>
      </nav>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">list on marketplace</h1>
        <p className="text-sm text-zinc-400">
          pick assets from your wallet, set price(s), submit one tx.
          {collection ? ` collection: ${collection.label}.` : null}
        </p>
      </header>

      {!manifest ? (
        <p className="text-sm text-amber-300">
          marketplace not deployed. see{" "}
          <Link href="/market/dev-tools" className="underline">
            dev tools
          </Link>
          .
        </p>
      ) : !walletApi ? (
        <p className="text-sm text-zinc-500">connect a wallet to list.</p>
      ) : !collection ? (
        <p className="text-sm text-amber-300">no supported collection on this network.</p>
      ) : (
        <>
          {/* ---- Shared / same-for-all bar ---- */}
          <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-400">
              <input
                type="checkbox"
                checked={sameForAll}
                onChange={(e) => setSameForAll(e.target.checked)}
                className="h-4 w-4 accent-sky-500"
              />
              same price for all
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={sameForAll ? "price (every selected NFT)" : "default price"}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={sharedPrice}
                  onChange={(e) => setSharedPrice(e.target.value)}
                  className="w-32 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
                />
              </Field>
              <Field label="currency">
                <select
                  value={sharedTokenUnit}
                  onChange={(e) => setSharedTokenUnit(e.target.value)}
                  className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
                >
                  {priceTokens.map((t) => (
                    <option key={t.unit || "ada"} value={t.unit}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          {/* ---- NFT picker ---- */}
          <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <header className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
                pick {collection.label}
              </h2>
              <span className="text-sm text-zinc-300">
                {nftsLoading
                  ? "loading…"
                  : `${walletNfts?.length ?? 0} in wallet · ${selected.size} selected`}
              </span>
            </header>

            {nftsError ? (
              <p className="text-xs text-red-300">{String(nftsError)}</p>
            ) : !walletNfts || walletNfts.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {nftsLoading
                  ? "scanning wallet…"
                  : `you don't hold any ${collection.label}.`}
              </p>
            ) : (
              // Cap height + scroll. Wallets with hundreds of HOSKY
              // CashGrab NFTs would otherwise produce a 30-row grid
              // that pushes the submit button miles below the fold.
              <div className="max-h-[36rem] overflow-y-auto rounded border border-zinc-900 p-1">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {walletNfts.map((n) => (
                    <NftPickRow
                      key={n.unit}
                      nft={n}
                      isSelected={selected.has(n.unit)}
                      onToggle={() => toggleSelect(n.unit)}
                      showOverride={!sameForAll && selected.has(n.unit)}
                      override={overrides[n.unit] ?? {
                        displayPrice: sharedPrice,
                        tokenUnit: sharedTokenUnit,
                      }}
                      onOverrideChange={(patch) => setOverride(n.unit, patch)}
                      priceTokens={priceTokens}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>

          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || selected.size === 0}
            className="self-start rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800"
          >
            {busy
              ? "signing…"
              : selected.size === 0
              ? "list nothing"
              : `list ${selected.size} NFT${selected.size === 1 ? "" : "s"}`}
          </button>

          {err ? (
            <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {err}
            </p>
          ) : null}
          {tx ? (
            <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
              ↗ {tx}
            </p>
          ) : null}

          {/* ---- My current listings (cancel from here) ---- */}
          <MyListings />
        </>
      )}
    </main>
  );
}

type SubmissionEntry = {
  unit: string;
  qty: bigint;
  token: SupportedPriceToken;
  priceQty: bigint;
};

function NftPickRow({
  nft,
  isSelected,
  onToggle,
  showOverride,
  override,
  onOverrideChange,
  priceTokens,
}: {
  nft: WalletCollectionNft;
  isSelected: boolean;
  onToggle: () => void;
  showOverride: boolean;
  override: { displayPrice: string; tokenUnit: string };
  onOverrideChange: (
    patch: Partial<{ displayPrice: string; tokenUnit: string }>,
  ) => void;
  priceTokens: SupportedPriceToken[];
}) {
  const meta = useNftMetadata(nft.unit);
  const name = meta.data?.name ?? humanUnit(nft.unit);
  const image = meta.data?.image_url ?? null;
  const token = priceTokens.find((t) => t.unit === override.tokenUnit);

  // Fee preview (parses override.displayPrice with the token's decimals).
  const previewQty = token
    ? parseDecimal(override.displayPrice, token.decimals)
    : null;
  const previewFee =
    previewQty !== null && previewQty > 0n
      ? (previewQty * 2n + 99n) / 100n
      : null;
  const previewReceive =
    previewQty !== null && previewFee !== null ? previewQty - previewFee : null;

  return (
    <li
      className={`overflow-hidden rounded-lg border ${
        isSelected ? "border-sky-700" : "border-zinc-900"
      } bg-zinc-950 transition`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="block w-full text-left"
      >
        <div className="relative aspect-square bg-zinc-900">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-widest text-zinc-600">
              no image
            </div>
          )}
          {isSelected ? (
            <div className="absolute right-2 top-2 rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-100">
              ✓
            </div>
          ) : null}
        </div>
        <div className="space-y-0.5 p-2">
          <p className="truncate text-xs text-zinc-200">{name}</p>
        </div>
      </button>
      {showOverride ? (
        <div className="space-y-1 border-t border-zinc-900 p-2">
          <div className="flex gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={override.displayPrice}
              onChange={(e) =>
                onOverrideChange({ displayPrice: e.target.value })
              }
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 focus:border-sky-700 focus:outline-none"
            />
            <select
              value={override.tokenUnit}
              onChange={(e) => onOverrideChange({ tokenUnit: e.target.value })}
              className="rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs text-zinc-200 focus:border-sky-700 focus:outline-none"
            >
              {priceTokens.map((t) => (
                <option key={t.unit || "ada"} value={t.unit}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {previewQty !== null && previewFee !== null && previewReceive !== null && token ? (
            <p className="text-[10px] text-zinc-500">
              fee {formatPriceQty(previewFee, token.decimals)} · you receive{" "}
              {formatPriceQty(previewReceive, token.decimals)} {token.label}
            </p>
          ) : (
            <p className="text-[10px] text-amber-400">invalid price</p>
          )}
        </div>
      ) : isSelected && token ? (
        <div className="border-t border-zinc-900 p-2 text-[10px] text-zinc-500">
          {formatPriceQty(
            parseDecimal(override.displayPrice, token.decimals) ?? 0n,
            token.decimals,
          )}{" "}
          {token.label}
        </div>
      ) : null}
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

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

function formatPriceQty(qty: bigint, decimals: number): string {
  if (decimals === 0) return qty.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = qty / divisor;
  const frac = qty % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function humanUnit(unit: string): string {
  if (unit.length <= 56) return unit;
  const name = unit.slice(56);
  try {
    let out = "";
    for (let i = 0; i < name.length; i += 2) {
      const code = parseInt(name.slice(i, i + 2), 16);
      if (code < 0x20 || code > 0x7e) throw new Error("non-printable");
      out += String.fromCharCode(code);
    }
    return out || name.slice(0, 16) + "…";
  } catch {
    return name.slice(0, 16) + "…";
  }
}
