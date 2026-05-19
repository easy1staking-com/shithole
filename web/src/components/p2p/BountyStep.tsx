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
 * <p>UI math:
 *   bounty
 *     = protocol_fee           (goes to treasury at fulfill time)
 *     + min_seller_compensation (covers seller's tx fee + buyer-output min-utxo)
 *     + tip                    (anything above the floor — pure incentive)
 *
 * <p>Submission is delegated to the parent via {@code onSubmit}: this
 * component is purely UI + validation; the parent owns the wallet + tx
 * builder side-effects.
 */
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
  const sellerComp = MIN_SELLER_COMPENSATION_LOVELACE;
  const tip = parsed != null && parsed >= floor ? parsed - floor : 0n;
  const nBig = BigInt(Math.max(1, listingCount));
  const totalLocked = parsed != null ? parsed * nBig : 0n;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm text-zinc-300">
          bounty (ADA you lock with your s#!t)
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
          minimum {formatAda(floor)} ADA. tip extra to attract a taker faster.
        </p>
        {parsed == null && (
          <p className="mt-1 text-xs text-red-400">enter a positive number.</p>
        )}
        {parsed != null && !aboveFloor && (
          <p className="mt-1 text-xs text-red-400">
            below the floor — the contract won&apos;t let anyone fulfill
            this. raise it to {formatAda(floor)} ADA or more.
          </p>
        )}
      </label>

      <dl className="space-y-1 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
        <div className="pb-1 text-[10px] uppercase tracking-wider text-zinc-600">
          per listing
        </div>
        <Row
          label="protocol fee → treasury"
          value={protocolFee}
          tone="muted"
        />
        <Row
          label="seller compensation"
          value={sellerComp}
          tone="muted"
          help="covers their tx fee + the min-utxo of the NFT-delivery output"
        />
        <Row
          label="your tip → seller"
          value={tip}
          tone={tip > 0n ? "highlight" : "muted"}
          help={
            tip === 0n
              ? "no tip — only motivated by the NFT they get"
              : "pure incentive: this is what makes them grab your listing"
          }
        />
        <div className="my-1 border-t border-zinc-800" />
        <Row label="bounty per listing" value={parsed ?? 0n} tone="bold" />
        {listingCount > 1 && (
          <>
            <div className="my-1 border-t border-zinc-800" />
            <Row
              label={`× ${listingCount} listings`}
              value={totalLocked}
              tone="bold"
              help="total ADA locked across all selected NFTs"
            />
          </>
        )}
      </dl>

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
              ? "post the bounty"
              : `post ${listingCount} bounties`}
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
  tone: "muted" | "bold" | "highlight";
  help?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <dt
          className={
            tone === "bold"
              ? "text-zinc-200"
              : tone === "highlight"
                ? "text-amber-300"
                : "text-zinc-500"
          }
        >
          {label}
        </dt>
        {help && <span className="text-[10px] text-zinc-600">{help}</span>}
      </div>
      <dd
        className={
          "font-mono " +
          (tone === "bold"
            ? "text-zinc-100"
            : tone === "highlight"
              ? "text-amber-300"
              : "text-zinc-400")
        }
      >
        {formatAda(value)} ADA
      </dd>
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
