"use client";

/**
 * Inspect — look up any HOSKY CashGrab by its serial number, no wallet or
 * ownership required. Built for the community ask: "let me check a CG's
 * pool compatibility before I buy it (on WayUp / jpg.store / anywhere)."
 *
 * <p>Pure FE: a CG's unit is deterministic from its serial —
 * {@code policy + hex("HOSKYCashGrab" + serial.padStart(9,"0"))} — and the
 * BE's {@code /api/nft/{unit}} already lazy-fetches CIP-25 metadata
 * (name, image, traits) for any on-chain asset. Matching pools reuse the
 * same {@link matchesPool} logic the marketplace cards use.
 */

import { useEffect, useMemo, useState } from "react";

import { useNftMetadata } from "@/lib/api/hooks";
import { listPools, matchesPool, type Pool } from "@/lib/market/poolTraits";
import { supportedCollections } from "@/lib/market/supportedCollections";

// HOSKY CashGrab asset-name scheme — verified on mainnet
// (408781 → "HOSKYCashGrab000408781").
const CG_NAME_PREFIX = "HOSKYCashGrab";
const CG_SERIAL_PAD = 9;

function hexOf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    out += s.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

function cashGrabUnit(policyId: string, serial: number): string {
  const name = CG_NAME_PREFIX + String(serial).padStart(CG_SERIAL_PAD, "0");
  return policyId.toLowerCase() + hexOf(name);
}

export default function InspectPage() {
  const collection = supportedCollections()[0] ?? null;
  const policy = collection?.policyId ?? "";

  const [serial, setSerial] = useState("");
  const [committed, setCommitted] = useState("");

  // Debounce so we don't fire a lookup on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setCommitted(serial.trim()), 450);
    return () => clearTimeout(id);
  }, [serial]);

  const parsed = /^\d+$/.test(committed) ? parseInt(committed, 10) : null;
  const unit =
    parsed !== null && parsed > 0 && policy ? cashGrabUnit(policy, parsed) : "";

  const meta = useNftMetadata(unit, { enabled: Boolean(unit) });

  const traits = meta.data?.traits ?? [];
  const matchingPools = useMemo<Pool[]>(() => {
    const tr = meta.data?.traits ?? [];
    if (tr.length === 0) return [];
    return listPools().filter((p) => matchesPool(tr, p).length > 0);
  }, [meta.data]);

  const notFound = Boolean(unit) && !meta.isLoading && !meta.isError && !meta.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">inspect a CashGrab</h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          look up any HOSKY CashGrab by its serial number — no wallet, no
          ownership needed. check its traits and matching stake pools before you
          buy it anywhere.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            serial #
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-zinc-500">HOSKYCashGrab</span>
            <input
              type="text"
              inputMode="numeric"
              value={serial}
              onChange={(e) => setSerial(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="408781"
              className="w-32 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-sky-700 focus:outline-none"
            />
          </div>
        </label>
        {meta.isLoading ? (
          <span className="text-xs text-zinc-500">looking up…</span>
        ) : null}
      </div>

      <section className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        {/* NFT card — empty until a lookup resolves. */}
        <div className="aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          {meta.data?.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={meta.data.image_url}
              alt={meta.data.name ?? ""}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-xs uppercase tracking-widest text-zinc-600">
              {notFound ? "not found" : "enter a serial #"}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          {meta.data ? (
            <>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  name
                </p>
                <p className="text-lg font-semibold text-zinc-100">
                  {meta.data.name}
                </p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  matching pools
                </p>
                {matchingPools.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {matchingPools.map((p) => (
                      <span
                        key={p.ticker}
                        className="rounded bg-sky-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-sky-300"
                      >
                        {p.ticker}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">
                    no matching pools.
                  </p>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  traits
                </p>
                {traits.length > 0 ? (
                  <ul className="mt-1 grid grid-cols-2 gap-1 text-xs">
                    {traits.map((t) => (
                      <li
                        key={`${t.category}:${t.value}`}
                        className="rounded border border-zinc-900 px-2 py-1"
                      >
                        <span className="text-zinc-500">{t.category}: </span>
                        <span className="text-zinc-200">{t.value}</span>
                        {t.pct !== null ? (
                          <span className="text-zinc-600"> · {t.pct}%</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">no traits.</p>
                )}
              </div>
            </>
          ) : notFound ? (
            <p className="text-sm text-amber-300">
              no CashGrab #{parsed} found — double-check the number.
            </p>
          ) : meta.isError ? (
            <p className="text-sm text-red-300">
              lookup failed: {String(meta.error)}
            </p>
          ) : (
            <p className="text-sm text-zinc-500">
              enter a CashGrab serial number to inspect it.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
