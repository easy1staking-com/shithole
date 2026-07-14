"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorView } from "@/components/ErrorView";
import { Notice } from "@/components/Notice";
import { fetchJars, type Jar } from "@/lib/jar/queryJars";
import { makeClient } from "@/lib/tx/evolutionClient";
import { applyJarScript } from "@/lib/tx/marketScripts";
import {
  DEFAULT_JAR_SEED_LOVELACE,
  submitJarCreate,
} from "@/lib/tx/jarCreate";
import {
  LEAVE_BEHIND_LOVELACE,
  submitJarBulkCollect,
  submitJarCollect,
} from "@/lib/tx/jarCollect";
import { submitJarMerge } from "@/lib/tx/jarMerge";
import type { UTxO } from "@/lib/tx/utxo";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Admin-only jar lifecycle UI. Derives the jar script address from the
 * connected wallet's payment pkh (the {@code admin_pkh} compile-time
 * parameter), polls Blockfrost for UTxOs at that address, and exposes
 * create / merge / collect actions.
 *
 * <p>Jars are a primitive — independent of pit / p2p / marketplace. Any
 * contract that uses {@code blake2b_256(serialise(out_ref))} as a deposit
 * tag and {@code admin_pkh} as the Sweep authority can drop UTxOs here.
 */
export function JarManager() {
  const walletApi = useWalletStore((s) => s.api);
  const walletPkh = useWalletStore((s) => s.paymentKeyHashHex);
  const walletAddress = useWalletStore((s) => s.addressBech32);

  const [jarAddress, setJarAddress] = useState<string | null>(null);
  const [jars, setJars] = useState<Jar[]>([]);
  const [junk, setJunk] = useState<UTxO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createCount, setCreateCount] = useState("3");
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Raw caught error (rendered via ErrorView) vs. local validation
  // warning (rendered as a warning Notice) — kept separate so a friendly
  // validation string never lands in the unknown-error debug box.
  const [err, setErr] = useState<unknown>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  // Resolve jar address from the connected pkh.
  useEffect(() => {
    if (!walletPkh) {
      setJarAddress(null);
      return;
    }
    (async () => {
      try {
        const network = toEvolutionNetwork(getNetworkName());
        const jar = await applyJarScript(network, walletPkh);
        setJarAddress(jar.address);
      } catch (e) {
        setErr(e);
      }
    })();
  }, [walletPkh]);

  const refresh = useCallback(async () => {
    if (!walletApi || !jarAddress) return;
    setLoading(true);
    setErr(null);
    setWarning(null);
    try {
      const client = await makeClient(walletApi);
      const { jars: js, junk: jk } = await fetchJars(client, jarAddress);
      setJars(js);
      setJunk(jk);
      setSelected(new Set());
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [walletApi, jarAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async () => {
    if (!walletApi || !walletPkh) return;
    const n = parseInt(createCount, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setWarning("count must be a positive integer");
      return;
    }
    setBusyAction("create");
    setErr(null);
    setWarning(null);
    setLastTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitJarCreate(client, {
        network: toEvolutionNetwork(getNetworkName()),
        adminPkhHex: walletPkh,
        count: n,
      });
      setLastTx(res.txHash);
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusyAction(null);
    }
  };

  const onMerge = async () => {
    if (!walletApi || !walletPkh || !walletAddress) return;
    const consumed = jars.filter((j) => selected.has(jarKey(j))).map((j) => j.utxo);
    if (consumed.length < 2) {
      setWarning("select at least two jars to merge");
      return;
    }
    setBusyAction("merge");
    setErr(null);
    setWarning(null);
    setLastTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitJarMerge(client, {
        network: toEvolutionNetwork(getNetworkName()),
        adminPkhHex: walletPkh,
        consumed,
        payoutBech32Address: walletAddress,
      });
      setLastTx(res.txHash);
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusyAction(null);
    }
  };

  const onBulkCollect = async () => {
    if (!walletApi || !walletPkh || !walletAddress) return;
    const consumed = jars
      .filter((j) => selected.has(jarKey(j)))
      .map((j) => j.utxo);
    if (consumed.length < 2) {
      setWarning("select at least two jars to bulk-collect");
      return;
    }
    setBusyAction("bulk-collect");
    setErr(null);
    setWarning(null);
    setLastTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitJarBulkCollect(client, {
        network: toEvolutionNetwork(getNetworkName()),
        adminPkhHex: walletPkh,
        consumed,
        payoutBech32Address: walletAddress,
      });
      setLastTx(res.txHash);
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusyAction(null);
    }
  };

  const onCollect = async (jar: Jar) => {
    if (!walletApi || !walletPkh || !walletAddress) return;
    setBusyAction(`collect:${jarKey(jar)}`);
    setErr(null);
    setWarning(null);
    setLastTx(null);
    try {
      const client = await makeClient(walletApi);
      const res = await submitJarCollect(client, {
        network: toEvolutionNetwork(getNetworkName()),
        adminPkhHex: walletPkh,
        consumed: jar.utxo,
        payoutBech32Address: walletAddress,
      });
      setLastTx(res.txHash);
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusyAction(null);
    }
  };

  const totalSelected = selected.size;
  const aggregateBalance = useMemo(() => sumAssets(jars.map((j) => j.utxo.assets)), [jars]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-12">
      <nav className="flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← home
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">jars</h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          fee accumulators at the parameterised jar script address. each
          jar holds ADA + any number of CNTs. anyone can Deposit into a
          jar; only the connected wallet (admin pkh) can Sweep — i.e.
          create / merge / collect.
        </p>
        {jarAddress ? (
          <p className="break-all font-mono text-xs text-zinc-500">
            jar address: {jarAddress}
          </p>
        ) : (
          <p className="text-xs text-amber-400">connect a wallet to derive the jar address.</p>
        )}
      </header>

      {warning ? <Notice severity="warning">{warning}</Notice> : null}
      {err ? <ErrorView error={err} context={{ subject: "jar" }} /> : null}
      {lastTx ? (
        <p className="rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-200">
          ↗ {lastTx}
        </p>
      ) : null}

      {/* ---- Existing jars ---- */}
      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-sky-400">
            existing jars
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {jars.length} jar{jars.length === 1 ? "" : "s"}
              {totalSelected > 0 ? ` · ${totalSelected} selected` : ""}
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-300 disabled:opacity-50"
            >
              {loading ? "scanning…" : "refresh"}
            </button>
          </div>
        </header>

        {jars.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {loading ? "scanning…" : "no jars yet — create some below."}
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {jars.map((jar) => {
                const k = jarKey(jar);
                const isSelected = selected.has(k);
                const nonAda = nonAdaUnits(jar.utxo.assets);
                return (
                  <li
                    key={k}
                    className="flex flex-col gap-2 rounded border border-zinc-900 bg-zinc-950 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(k);
                          else next.delete(k);
                          setSelected(next);
                        }}
                        className="mt-0.5 h-4 w-4 accent-sky-500"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="break-all font-mono text-[10px] text-zinc-500">
                          {jar.utxo.txHash}.{jar.utxo.outputIndex}
                        </div>
                        <div className="font-mono text-zinc-200">
                          {formatAda(jar.utxo.assets.lovelace ?? 0n)} ADA
                          {nonAda.length > 0 ? ` · ${nonAda.length} CNT${nonAda.length === 1 ? "" : "s"}` : ""}
                        </div>
                        {nonAda.length > 0 ? (
                          <details className="text-[10px] text-zinc-500">
                            <summary className="cursor-pointer">show tokens</summary>
                            <ul className="mt-1 space-y-0.5 font-mono">
                              {nonAda.map(([unit, qty]) => (
                                <li key={unit} className="break-all">
                                  {String(qty)} × {unit}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCollect(jar)}
                      disabled={
                        busyAction !== null ||
                        (jar.utxo.assets.lovelace ?? 0n) < LEAVE_BEHIND_LOVELACE ||
                        nonAda.length === 0
                      }
                      className="shrink-0 rounded bg-amber-700 px-3 py-1 text-[11px] font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
                      title="Sweep all non-ADA + extra ADA to admin wallet; leave 5 ADA in the jar."
                    >
                      {busyAction === `collect:${k}` ? "signing…" : "collect"}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onMerge}
                disabled={totalSelected < 2 || busyAction !== null}
                className="rounded bg-sky-700 px-3 py-1 text-xs font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {busyAction === "merge"
                  ? "signing…"
                  : `merge ${totalSelected || ""} selected`}
              </button>
              <button
                type="button"
                onClick={onBulkCollect}
                disabled={totalSelected < 2 || busyAction !== null}
                className="rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {busyAction === "bulk-collect"
                  ? "signing…"
                  : `collect ${totalSelected || ""} selected`}
              </button>
              <p className="basis-full text-[10px] text-zinc-500">
                <strong className="text-zinc-400">merge</strong> N → 1: one
                fresh jar at {formatAda(LEAVE_BEHIND_LOVELACE)} ADA, all
                excess + CNTs to your wallet.{" "}
                <strong className="text-zinc-400">collect</strong> N → N:
                each jar recreated at {formatAda(LEAVE_BEHIND_LOVELACE)} ADA,
                combined excess + CNTs to your wallet.
              </p>
            </div>
          </>
        )}

        {junk.length > 0 ? (
          <p className="border-t border-zinc-900 pt-2 text-[10px] text-amber-400">
            {junk.length} UTxO{junk.length === 1 ? "" : "s"} at this address
            with non-decodable datum — sweep manually if needed.
          </p>
        ) : null}

        {jars.length > 1 ? (
          <div className="border-t border-zinc-900 pt-3 text-[10px] text-zinc-500">
            <span className="uppercase tracking-widest">aggregate balance</span>{" "}
            · {formatAda(aggregateBalance.lovelace ?? 0n)} ADA{" "}
            {Object.keys(aggregateBalance).filter((k) => k !== "lovelace").length > 0
              ? `· ${Object.keys(aggregateBalance).filter((k) => k !== "lovelace").length} CNTs`
              : ""}
          </div>
        ) : null}
      </section>

      {/* ---- Create new ---- */}
      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-sky-400">
            create new jars
          </h2>
          <span className="text-xs text-zinc-500">
            seed: {formatAda(DEFAULT_JAR_SEED_LOVELACE)} ADA each
          </span>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-widest text-zinc-500">
              count
            </span>
            <input
              type="number"
              value={createCount}
              min={1}
              max={50}
              onChange={(e) => setCreateCount(e.target.value)}
              className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={onCreate}
            disabled={busyAction !== null || !walletPkh}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {busyAction === "create" ? "signing…" : "create"}
          </button>
        </div>
        <p className="text-[10px] text-zinc-500">
          each new jar is a pay-to-script with {formatAda(DEFAULT_JAR_SEED_LOVELACE)} ADA + a
          sentinel JarDatum. first Deposit overwrites the sentinel with the
          correct compute_output_tag.
        </p>
      </section>
    </main>
  );
}

function jarKey(jar: Jar): string {
  return `${jar.utxo.txHash}:${jar.utxo.outputIndex}`;
}

function nonAdaUnits(assets: Record<string, bigint>): Array<[string, bigint]> {
  return Object.entries(assets).filter(([u, q]) => u !== "lovelace" && q > 0n);
}

function sumAssets(maps: Array<Record<string, bigint>>): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const m of maps) {
    for (const [unit, qty] of Object.entries(m)) {
      out[unit] = (out[unit] ?? 0n) + qty;
    }
  }
  return out;
}

function formatAda(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const frac = lovelace % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
