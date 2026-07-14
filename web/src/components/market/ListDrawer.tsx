"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import {
  ConfirmationChip,
  type ChainConfirmation,
} from "@/components/ConfirmationChip";
import { ErrorView } from "@/components/ErrorView";
import { Notice } from "@/components/Notice";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import {
  supportedCollections,
  type SupportedCollection,
} from "@/lib/market/supportedCollections";
import {
  splitUnit,
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";
import { useRefreshHistory } from "@/lib/me/useRefreshHistory";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
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
  const { data: manifest } = useDerivedMarketplaceManifest();
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const walletAddress = useWalletStore((s) => s.addressBech32);

  const collections = useMemo(() => supportedCollections(), []);
  const priceTokens = useMemo(() => supportedPriceTokens(), []);

  // Resolve a collection's default pricing token (by label) to a unit,
  // falling back to the first token (ADA).
  const defaultTokenUnitFor = useCallback(
    (c: SupportedCollection | null): string => {
      const t = c?.defaultPriceTokenLabel
        ? priceTokens.find((pt) => pt.label === c.defaultPriceTokenLabel)
        : undefined;
      return t?.unit ?? priceTokens[0]?.unit ?? "";
    },
    [priceTokens],
  );

  const [collectionPolicy, setCollectionPolicy] = useState<string>(
    collections[0]?.policyId ?? "",
  );
  const collection = useMemo(
    () =>
      collections.find((c) => c.policyId === collectionPolicy) ??
      collections[0] ??
      null,
    [collections, collectionPolicy],
  );

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
    defaultTokenUnitFor(collections[0] ?? null),
  );

  // Switching collection resets the selection (different assets) and
  // pre-selects that collection's default pricing token.
  const onCollectionChange = useCallback(
    (policy: string) => {
      setCollectionPolicy(policy);
      const c = collections.find((x) => x.policyId === policy) ?? null;
      setSharedTokenUnit(defaultTokenUnitFor(c));
      setSelected(new Set());
      setOverrides({});
    },
    [collections, defaultTokenUnitFor],
  );

  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ChainConfirmation>(null);
  const [err, setErr] = useState<unknown>(null);
  // Local validation feedback (empty selection, bad price, no wallet) —
  // not thrown errors, so surfaced via Notice rather than ErrorView.
  const [notice, setNotice] = useState<{
    severity: "warning" | "info";
    message: string;
  } | null>(null);

  const queryClient = useQueryClient();
  const refreshHistory = useRefreshHistory();

  // Bond default — autoMinUtxo on the submit handles the floor.
  const [bondLovelace] = useState<bigint>(DEFAULT_BOND_LOVELACE);

  // Two-step submit: "review & list" → confirmation div → "confirm & sign".
  const [confirming, setConfirming] = useState(false);

  // Live receipt for the current selection. Groups by price currency so
  // bulk listings with per-row currency overrides total correctly; the
  // 2 ADA bond is always ADA and scales with the NFT count.
  const summary = useMemo<ListingSummaryData>(() => {
    const groups = new Map<string, SummaryGroup>();
    let hasInvalid = false;
    for (const unit of selected) {
      const rowDisplay = sameForAll
        ? sharedPrice
        : overrides[unit]?.displayPrice ?? sharedPrice;
      const rowUnit = sameForAll
        ? sharedTokenUnit
        : overrides[unit]?.tokenUnit ?? sharedTokenUnit;
      const token = priceTokens.find((t) => t.unit === rowUnit);
      if (!token) {
        hasInvalid = true;
        continue;
      }
      const priceQty = parseDecimal(rowDisplay, token.decimals);
      if (priceQty === null || priceQty <= 0n) {
        hasInvalid = true;
        continue;
      }
      const fee = feeOf(priceQty);
      let g = groups.get(token.unit);
      if (!g) {
        g = {
          token,
          count: 0,
          uniformPrice: priceQty,
          totalFee: 0n,
          totalReceive: 0n,
        };
        groups.set(token.unit, g);
      } else if (g.uniformPrice !== priceQty) {
        g.uniformPrice = null;
      }
      g.count += 1;
      g.totalFee += fee;
      g.totalReceive += priceQty - fee;
    }
    return {
      count: selected.size,
      groups: [...groups.values()],
      depositLovelace: bondLovelace * BigInt(selected.size),
      hasInvalid,
    };
  }, [
    selected,
    overrides,
    sameForAll,
    sharedPrice,
    sharedTokenUnit,
    priceTokens,
    bondLovelace,
  ]);

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
      setNotice({ severity: "warning", message: "select at least one NFT" });
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
        setNotice({
          severity: "warning",
          message: `unknown price token for ${unit}`,
        });
        return null;
      }
      const priceQty = parseDecimal(rowDisplay, token.decimals);
      if (priceQty === null || priceQty <= 0n) {
        setNotice({
          severity: "warning",
          message: `invalid price for ${humanUnit(unit)}: ${rowDisplay}`,
        });
        return null;
      }
      out.push({ unit, qty: 1n, token, priceQty });
    }
    return out;
  };

  const onSubmit = async () => {
    if (!manifest || !walletApi || !walletAddress || !walletPkh) {
      setNotice({ severity: "info", message: "connect a wallet first" });
      return;
    }
    const submission = buildSubmission();
    if (!submission) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    setTx(null);
    setConfirmation(null);
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
      // Submit landed — watch for chain confirmation in the background
      // so the button can re-enable immediately. Refetch the wallet
      // picker only after chain confirms; refetching at submit time
      // returns the same UTxOs that haven't yet been spent.
      setConfirmation("confirming");
      awaitTxConfirmation(client, res.txHash)
        .then(() => {
          setConfirmation("confirmed");
          if (collection) {
            queryClient.invalidateQueries({
              queryKey: ["walletCollection", walletAddress, collection.policyId],
            });
          }
          refreshHistory();
        })
        .catch((chainErr) => {
          console.warn("list tx not confirmed:", chainErr);
          setConfirmation("rejected");
        });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  // Validate, then move to the confirmation step (no wallet prompt yet).
  const onReview = () => {
    setErr(null);
    setNotice(null);
    if (buildSubmission()) setConfirming(true);
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
            {collections.length > 1 ? (
              <Field label="collection">
                <select
                  value={collectionPolicy}
                  onChange={(e) => onCollectionChange(e.target.value)}
                  className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
                >
                  {collections.map((c) => (
                    <option key={c.policyId} value={c.policyId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
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
              <ErrorView error={nftsError} context={{ subject: "wallet NFTs" }} />
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

          {selected.size > 0 ? (
            <ListingSummary data={summary} confirming={confirming} />
          ) : null}

          {!confirming ? (
            <button
              type="button"
              onClick={onReview}
              disabled={busy || selected.size === 0 || summary.hasInvalid}
              className="self-start rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800"
            >
              {selected.size === 0
                ? "select NFTs to list"
                : summary.hasInvalid
                ? "fix invalid prices"
                : `review & list ${selected.size} NFT${selected.size === 1 ? "" : "s"}`}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:bg-zinc-800"
              >
                {busy
                  ? "signing…"
                  : `confirm & sign — list ${selected.size} NFT${selected.size === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
              >
                ← back
              </button>
            </div>
          )}

          {notice ? (
            <Notice severity={notice.severity}>{notice.message}</Notice>
          ) : null}
          {err ? (
            <ErrorView
              error={err}
              context={{ action: "listed", subject: "listing" }}
            />
          ) : null}
          {tx ? (
            <div className="space-y-2 rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
              <p className="break-all">↗ {tx}</p>
              <ConfirmationChip status={confirmation} />
            </div>
          ) : null}
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

/** 2% protocol fee, rounded up — mirrors the marketplace validator's fee math. */
function feeOf(priceQty: bigint): bigint {
  return (priceQty * 2n + 99n) / 100n;
}

type SummaryGroup = {
  token: SupportedPriceToken;
  count: number;
  /** Shared price if every NFT in this currency uses it; null when they differ. */
  uniformPrice: bigint | null;
  totalFee: bigint;
  totalReceive: bigint;
};

type ListingSummaryData = {
  count: number;
  groups: SummaryGroup[];
  depositLovelace: bigint;
  hasInvalid: boolean;
};

/**
 * Listing receipt — makes the economics explicit before signing: prices
 * are PER NFT, the 2% protocol fee in the sell currency, and the total
 * refundable ADA deposit (2 ADA × N). Doubles as the confirmation panel.
 */
function ListingSummary({
  data,
  confirming,
}: {
  data: ListingSummaryData;
  confirming: boolean;
}) {
  const n = data.count;
  return (
    <section
      className={`space-y-3 rounded-lg border p-4 text-base ${
        confirming
          ? "border-sky-600 bg-sky-950/30"
          : "border-zinc-800 bg-zinc-950"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold uppercase tracking-widest text-zinc-100">
          {confirming ? "confirm listing" : "receipt"}
        </h3>
        <span className="text-sm uppercase tracking-widest text-sky-400">
          {n} NFT{n === 1 ? "" : "s"} · price is PER NFT
        </span>
      </div>

      {data.groups.map((g) => {
        const fee = g.uniformPrice !== null ? feeOf(g.uniformPrice) : null;
        const dec = g.token.decimals;
        const lbl = g.token.label;
        return (
          <div
            key={g.token.unit}
            className="space-y-1 border-t border-zinc-800/60 pt-2 first:border-t-0 first:pt-0"
          >
            {g.uniformPrice !== null && fee !== null ? (
              <>
                <SummaryLine k="price / NFT" amount={g.uniformPrice} dec={dec} label={lbl} />
                <SummaryLine k="− 2% protocol fee" amount={fee} dec={dec} label={lbl} tone="fee" />
                <SummaryLine k="= you receive / NFT" amount={g.uniformPrice - fee} dec={dec} label={lbl} tone="receive" />
                {g.count > 1 ? (
                  <SummaryLine k={`proceeds if all ${g.count} sell`} amount={g.totalReceive} dec={dec} label={lbl} tone="receive" />
                ) : null}
              </>
            ) : (
              <>
                <SummaryLine k={`${g.count} NFTs priced in ${lbl} (mixed)`} text="" />
                <SummaryLine k="− 2% protocol fee (total)" amount={g.totalFee} dec={dec} label={lbl} tone="fee" />
                <SummaryLine k="= you receive if all sell" amount={g.totalReceive} dec={dec} label={lbl} tone="receive" />
              </>
            )}
          </div>
        );
      })}

      <div className="border-t border-zinc-800 pt-2">
        <SummaryLine
          k="🔒 deposit locked"
          amount={data.depositLovelace}
          dec={6}
          label="ADA"
          suffix={`(2 ADA × ${n})`}
          tone="deposit"
        />
        <p className="mt-1 text-sm text-zinc-500">
          2 ADA per NFT is locked in each listing and returned to you when it
          sells or you cancel.
        </p>
      </div>
    </section>
  );
}

function SummaryLine({
  k,
  amount,
  dec,
  label,
  text,
  suffix,
  tone = "neutral",
}: {
  k: string;
  amount?: bigint;
  dec?: number;
  label?: string;
  /** Pre-rendered value (used for header-only rows); ignored if `amount` set. */
  text?: string;
  suffix?: string;
  tone?: "neutral" | "fee" | "receive" | "deposit";
}) {
  const color = {
    neutral: "text-zinc-100",
    fee: "text-amber-400",
    receive: "text-emerald-400",
    deposit: "text-sky-300",
  }[tone];
  let display = text ?? "";
  let title: string | undefined;
  if (amount !== undefined && dec !== undefined) {
    const f = formatAmount(amount, dec);
    const suf = label ? ` ${label}` : "";
    display = `${f.text}${suf}`;
    title = `${f.exact}${suf}`;
  }
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-zinc-400">{k}</span>
      <span className={`font-mono ${color}`} title={title}>
        {display}
        {suffix ? <span className="ml-1 text-sm text-zinc-500">{suffix}</span> : null}
      </span>
    </div>
  );
}

/** Comma-group an integer string: "1234567" → "1,234,567". */
function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Human amount for the receipt: comma-grouped, with K/M/B abbreviation
 * for big magnitudes (≥ 10,000 — common with HOSKY) to cut zero-walls.
 * Returns the compact `text` plus the full comma-grouped `exact` so the
 * caller can keep precision on a money figure via a hover title.
 */
function formatAmount(qty: bigint, decimals: number): { text: string; exact: string } {
  const divisor = 10n ** BigInt(decimals);
  const whole = qty / divisor;
  const frac = qty % divisor;
  let exact = groupThousands(whole.toString());
  if (frac !== 0n) {
    const f = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    if (f) exact += `.${f}`;
  }
  return { text: abbreviate(whole) ?? exact, exact };
}

function abbreviate(whole: bigint): string | null {
  if (whole < 10_000n) return null; // small amounts stay exact + comma-grouped
  for (const [scale, suf] of [
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ] as Array<[bigint, string]>) {
    if (whole >= scale) {
      const scaled = (whole * 100n) / scale; // 2 decimal places, truncated
      const ip = scaled / 100n;
      const fp = (scaled % 100n).toString().padStart(2, "0").replace(/0+$/, "");
      return `${ip}${fp ? `.${fp}` : ""}${suf}`;
    }
  }
  return null;
}

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
    previewQty !== null && previewQty > 0n ? feeOf(previewQty) : null;
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
        <div className="space-y-0.5 border-t border-zinc-900 p-2 text-[10px] text-zinc-500">
          <div className="flex items-baseline justify-between">
            <span className="text-zinc-300">
              {formatPriceQty(
                parseDecimal(override.displayPrice, token.decimals) ?? 0n,
                token.decimals,
              )}{" "}
              {token.label}
            </span>
            <span className="uppercase tracking-wider text-zinc-600">/ nft</span>
          </div>
          {previewFee !== null && previewReceive !== null ? (
            <div className="text-zinc-600">
              −2% {formatPriceQty(previewFee, token.decimals)} · you get{" "}
              {formatPriceQty(previewReceive, token.decimals)} {token.label}
            </div>
          ) : null}
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
