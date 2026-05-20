"use client";

import { useMemo, useState } from "react";

import {
  MIN_SELLER_COMPENSATION_LOVELACE,
  assertBountyFloor,
} from "@/lib/tx/createP2pListing";

/**
 * Step 3 of the p2p create flow — bounty input + live breakdown.
 *
 * <p>The bounty is the TOTAL lovelace the buyer locks in the listing UTxO.
 * The on-chain validator's W2 invariant enforces
 *   bounty >= cfg.protocol_fee + min_seller_compensation (2 ADA)
 * so any value below that floor would produce an unfulfillable listing.
 *
 * <p>Where the locked ADA actually goes at fulfill time:
 *   - protocol_fee                       → treasury (per-collection config)
 *   - {@link ESTIMATED_BUYER_OUTPUT_MIN} → BACK TO BUYER (NFT delivery min-utxo)
 *   - {@link ESTIMATED_TX_FEE}           → chain (eats out of the locked ADA)
 *   - remainder                          → swapper's profit
 *
 * <p>The "returns to buyer" leg is non-obvious and confused us once already
 * (we labeled the entire 2 ADA seller-compensation envelope as "to the
 * seller" — but ~1.4 of it actually flows back to the buyer's wallet via
 * the buyer-output min-utxo). The breakdown now exposes all four legs +
 * a "your effective cost" summary so the buyer can see what they're
 * really spending (≈ 1.6 ADA at the floor, or bounty − returned-min-utxo
 * in general).
 *
 * <p>Submission is delegated to the parent via {@code onSubmit}: this
 * component is purely UI + validation; the parent owns the wallet + tx
 * builder side-effects.
 */

/**
 * Estimated min-utxo for the buyer-output (NFT + small inline datum +
 * the buyer's bech32 address). On preprod we've observed ~1.4 ADA;
 * Cardano protocol params don't drift much, so this is a stable
 * estimate for UI math. The actual value is computed by autoMinUtxo at
 * tx-build time and may be a few hundred lovelace either side.
 */
const ESTIMATED_BUYER_OUTPUT_MIN = 1_400_000n;

/**
 * Estimated tx fee for a single-listing Fulfill (one script input, one
 * ref input, two outputs). Observed ~0.38 ADA on preprod; rounded up
 * to 0.4 for a slight margin in the UI. Comes out of the buyer's
 * locked ADA via the swapper's change calculation.
 */
const ESTIMATED_TX_FEE = 400_000n;
export function BountyStep({
  protocolFeeLovelace,
  listingCount,
  onSubmit,
  submitting,
}: {
  protocolFeeLovelace: bigint;
  /**
   * Number of listings being created in this tx (= N offered NFTs). The
   * bounty is per-listing, so total ADA committed is bounty × N. UI shows
   * this explicitly when N > 1.
   */
  listingCount: number;
  onSubmit: (bountyLovelace: bigint) => void;
  submitting: boolean;
}) {
  const floor = protocolFeeLovelace + MIN_SELLER_COMPENSATION_LOVELACE;
  // Default the input to the floor — easiest starting state.
  const [adaInput, setAdaInput] = useState<string>(formatAda(floor));

  const parsed = useMemo(() => parseAdaInput(adaInput), [adaInput]);
  const aboveFloor = parsed != null && parsed >= floor;

  // Breakdown components for the live preview.
  const protocolFee = protocolFeeLovelace;
  const returnedToBuyer = ESTIMATED_BUYER_OUTPUT_MIN;
  const estTxFee = ESTIMATED_TX_FEE;
  // Swapper's actual take = bounty − protocol_fee − min_utxo_returning_to_buyer
  //                       − estimated tx fee. At the contract floor
  // (bounty = protocol_fee + 2 ADA, returned ~1.4, tx ~0.4) this is ~0.2 ADA
  // — barely an incentive. Any tip the buyer adds flows entirely here.
  const swapperTake = useMemo(() => {
    if (parsed == null || !aboveFloor) return 0n;
    const take = parsed - protocolFee - returnedToBuyer - estTxFee;
    return take > 0n ? take : 0n;
  }, [parsed, aboveFloor, protocolFee, returnedToBuyer, estTxFee]);
  // What the buyer actually SPENDS = bounty minus what comes back to
  // them with the NFT. Equivalent to protocol_fee + tx_fee + swapper_take.
  const effectiveCost = useMemo(() => {
    if (parsed == null) return 0n;
    return parsed > returnedToBuyer ? parsed - returnedToBuyer : 0n;
  }, [parsed, returnedToBuyer]);
  const nBig = BigInt(Math.max(1, listingCount));
  const totalLocked = parsed != null ? parsed * nBig : 0n;
  const totalEffectiveCost = effectiveCost * nBig;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm text-zinc-300">
          deposit (ADA you lock with your s#!t)
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={adaInput}
            onChange={(e) => setAdaInput(e.target.value)}
            disabled={submitting}
            className="w-32 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
            aria-invalid={!aboveFloor}
            aria-describedby="bounty-help"
          />
          <span className="text-xs text-zinc-500">ADA</span>
        </div>
        <p id="bounty-help" className="mt-1 text-xs text-zinc-500">
          minimum {formatAda(floor)} ADA. add more to sweeten the swapper&apos;s take.
        </p>
        {parsed == null && (
          <p className="mt-1 text-xs text-red-400">enter a positive number.</p>
        )}
        {parsed != null && !aboveFloor && (
          <p className="mt-1 text-xs text-red-400">
            below the floor — the contract won&apos;t let anyone swap
            this. raise it to {formatAda(floor)} ADA or more.
          </p>
        )}
      </label>

      <dl className="space-y-1 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
        <div className="pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
          where your {formatAda(parsed ?? 0n)} ADA deposit goes when someone swaps
        </div>

        <Row
          label="↩ returns to you with the NFT"
          value={returnedToBuyer}
          tone="returned"
          help="min-utxo on the buyer-output that lands the NFT in your wallet — this is YOUR ADA coming back, not a cost"
        />
        <Row
          label="protocol fee → treasury"
          value={protocolFee}
          tone="muted"
          help="per-collection chain garbage tax"
        />
        <Row
          label="tx fee (chain, est.)"
          value={estTxFee}
          tone="muted"
          help="paid by the swapper, but comes out of your locked ADA via their change"
        />
        <Row
          label="swapper's take"
          value={swapperTake}
          tone={swapperTake > MIN_SELLER_COMPENSATION_LOVELACE / 4n ? "highlight" : "muted"}
          help={
            swapperTake === 0n
              ? "below the floor — no swapper would touch this"
              : swapperTake < 500_000n
                ? "barely an incentive at this bounty — tip more to attract a taker"
                : "pure incentive: what makes them grab your listing"
          }
        />

        <div className="my-1 border-t border-zinc-800" />
        <Row label="deposit per listing" value={parsed ?? 0n} tone="bold" />

        {/* Effective-cost summary — the LOAD-BEARING line for the buyer.
         *  Everything above this is detail; this number is what they
         *  actually spend. */}
        <div className="my-2 border-t border-amber-700/40" />
        <Row
          label="estimated swap cost to you"
          value={effectiveCost}
          tone="bold-highlight"
          help={`bounty (${formatAda(parsed ?? 0n)}) − ${formatAda(returnedToBuyer)} ADA that returns to you with the NFT`}
        />

        {listingCount > 1 && (
          <>
            <div className="my-2 border-t border-zinc-800" />
            <Row
              label={`× ${listingCount} listings — total deposit`}
              value={totalLocked}
              tone="muted"
              help="all-in lock across every selected NFT"
            />
            <Row
              label={`× ${listingCount} listings — total cost`}
              value={totalEffectiveCost}
              tone="bold-highlight"
              help="after subtracting the per-listing min-utxo that returns to you"
            />
          </>
        )}
      </dl>

      <p className="text-[11px] leading-snug text-zinc-500">
        once a swap lands, the protocol fee + tx fee + swapper&apos;s take
        are gone — no refunds. reclaim only works on listings nobody&apos;s
        taken yet.
      </p>

      <button
        type="button"
        disabled={!aboveFloor || submitting || listingCount === 0}
        onClick={() => parsed != null && onSubmit(parsed)}
        className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {submitting
          ? "summoning idiots…"
          : listingCount === 0
            ? "pick at least one NFT"
            : listingCount === 1
              ? "post listing"
              : `post ${listingCount} listings`}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  help,
}: {
  label: string;
  value: bigint;
  tone: "muted" | "bold" | "highlight" | "returned" | "bold-highlight";
  help?: string;
}) {
  const dtClass =
    tone === "bold-highlight"
      ? "text-amber-200 font-semibold"
      : tone === "bold"
        ? "text-zinc-200"
        : tone === "highlight"
          ? "text-amber-300"
          : tone === "returned"
            ? "text-emerald-300"
            : "text-zinc-500";
  const ddClass =
    "font-mono " +
    (tone === "bold-highlight"
      ? "text-amber-200 font-semibold"
      : tone === "bold"
        ? "text-zinc-100"
        : tone === "highlight"
          ? "text-amber-300"
          : tone === "returned"
            ? "text-emerald-300"
            : "text-zinc-400");
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <dt className={dtClass}>{label}</dt>
        {help && <span className="text-[10px] text-zinc-600">{help}</span>}
      </div>
      <dd className={ddClass}>{formatAda(value)} ADA</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Parse an ADA-decimal text input to lovelace. Permissive: accepts both
 * "3" and "3.0" and "3.123456" but rejects negatives, non-numeric, and
 * more than 6 decimal places (Cardano lovelace precision).
 */
export function parseAdaInput(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const wholeLov = BigInt(whole) * 1_000_000n;
  const fracLov = BigInt(fracPadded);
  return wholeLov + fracLov;
}

/** Format lovelace as a human ADA decimal (trims trailing zeros). */
export function formatAda(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const frac = lovelace % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Re-export the floor assertion so tests + callers can pull from one site. */
export { assertBountyFloor };
