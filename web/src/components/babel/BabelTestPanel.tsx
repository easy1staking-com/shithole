"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchOracleTokens, type LiveOraclePrice } from "@/lib/fluidtokens/api";
import { onChainAddressToBech32 } from "@/lib/fluidtokens/datum";
import {
  fetchTankByOutRef,
  tankAcceptsToken,
  type TankUtxo,
} from "@/lib/fluidtokens/discovery";
import { requiredTokenPayment } from "@/lib/fluidtokens/math";
import { makeClient } from "@/lib/tx/evolutionClient";
import { getNetworkName } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Default tank to load in the test — the user's HOSKY tank from
 * 2026-05-29. If/when this UTxO is spent or replaced, just paste a
 * fresh outref into the inputs at the top of the page.
 */
const DEFAULT_TANK_OUT_REF = {
  txHash: "af40a4c9c158ad805b179a51a1b08f3c6da73dfdb23c84bcf674551690107360",
  outputIndex: 0,
};

/** Mainnet HOSKY token unit (policy + asset_name). */
const HOSKY_UNIT_HEX =
  "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59";

/**
 * Babel-fee read-only smoke test panel. The four data sources we wire
 * up here are exactly the four things the buy-page tx-builder will
 * need at runtime — plus the requiredTokenPayment math glue between
 * them.
 *
 * <p>The UI is deliberately spartan: stacked sections show raw inputs
 * (paste-able outref + ada_used), a button to load, and rendered
 * numbers + addresses. No tx submission, no babel toggle on a buy.
 */
export function BabelTestPanel() {
  const walletApi = useWalletStore((s) => s.api);

  const [tankRefInput, setTankRefInput] = useState(
    `${DEFAULT_TANK_OUT_REF.txHash}#${DEFAULT_TANK_OUT_REF.outputIndex}`,
  );
  const [adaUsedAdaInput, setAdaUsedAdaInput] = useState("0.5");
  const [tokenUnitInput, setTokenUnitInput] = useState(HOSKY_UNIT_HEX);

  const [tank, setTank] = useState<TankUtxo | null>(null);
  const [oracle, setOracle] = useState<LiveOraclePrice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tankAddressBech32 = useMemo(() => {
    if (!tank) return null;
    const netId = getNetworkName() === "mainnet" ? 1 : 0;
    try {
      return onChainAddressToBech32(tank.datum.tankOwner, netId);
    } catch (e) {
      return e instanceof Error ? `decode failed: ${e.message}` : "decode failed";
    }
  }, [tank]);

  const matchingTokenIndex = useMemo(() => {
    if (!tank) return -1;
    const policy = tokenUnitInput.slice(0, 56);
    const name = tokenUnitInput.slice(56);
    return tankAcceptsToken(tank.datum, policy, name);
  }, [tank, tokenUnitInput]);

  const matchingToken = useMemo(() => {
    if (!tank || matchingTokenIndex < 0) return null;
    return tank.datum.allowedTokens[matchingTokenIndex];
  }, [tank, matchingTokenIndex]);

  const requiredHosky = useMemo(() => {
    if (!matchingToken || !oracle) return null;
    let adaUsedLovelace: bigint;
    try {
      const ada = Number(adaUsedAdaInput);
      if (!Number.isFinite(ada) || ada <= 0) return null;
      adaUsedLovelace = BigInt(Math.round(ada * 1_000_000));
    } catch {
      return null;
    }
    try {
      return {
        adaUsedLovelace,
        token: requiredTokenPayment({
          adaUsed: adaUsedLovelace,
          priceInLovelaces: oracle.priceInLovelaces,
          denominator: oracle.denominator,
          amount: matchingToken.amount,
          divider: matchingToken.divider,
        }),
      };
    } catch (e) {
      console.warn("requiredTokenPayment failed", e);
      return null;
    }
  }, [matchingToken, oracle, adaUsedAdaInput]);

  const onLoad = useCallback(async () => {
    if (!walletApi) {
      setErr("connect a wallet (mainnet) to query chain");
      return;
    }
    setBusy(true);
    setErr(null);
    setTank(null);
    setOracle(null);
    try {
      const [txHashRaw, idxRaw] = tankRefInput.split("#");
      if (!txHashRaw || idxRaw === undefined) {
        throw new Error("tank outref must be of the form txHash#outputIndex");
      }
      const txHash = txHashRaw.trim();
      const outputIndex = Number.parseInt(idxRaw.trim(), 10);
      if (!Number.isInteger(outputIndex) || outputIndex < 0) {
        throw new Error("output index must be a non-negative integer");
      }

      const client = await makeClient(walletApi);
      // Parallelise: chain query + public API.
      const [tankResult, oracleEntries] = await Promise.all([
        fetchTankByOutRef(client, { txHash, outputIndex }),
        fetchOracleTokens(),
      ]);
      if (!tankResult) throw new Error("tank UTxO not found / datum did not decode");
      setTank(tankResult);

      const unitLower = tokenUnitInput.toLowerCase();
      const match = oracleEntries.find((e) => e.unit === unitLower);
      if (!match) {
        // Not fatal — the tank loaded fine, we just can't price it.
        setErr(
          `no FluidTokens oracle entry for unit ${unitLower} — the tank loaded but pricing is unavailable`,
        );
      }
      setOracle(match ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [walletApi, tankRefInput, tokenUnitInput]);

  // Auto-load once the wallet is connected — saves a click during dev.
  useEffect(() => {
    if (walletApi && !tank && !busy && !err) {
      onLoad();
    }
    // intentionally narrow deps to "wallet just became available"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletApi]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-100">
          babel-fee sanity test
        </h1>
        <p className="text-sm text-zinc-400">
          Read-only smoke test for the FluidTokens babel-fee pipeline. Loads
          a tank UTxO + the live oracle price and shows the
          {" "}<code className="rounded bg-zinc-900 px-1">requiredTokenPayment</code>{" "}
          for a chosen ada_used. No tx submission.
        </p>
      </header>

      {!walletApi ? (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
          connect a <strong>mainnet</strong> wallet to query chain.
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <Field label="tank outref (txHash#idx)">
          <input
            type="text"
            value={tankRefInput}
            onChange={(e) => setTankRefInput(e.target.value)}
            className="w-full break-all rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-sky-700 focus:outline-none"
          />
        </Field>
        <Field label="paying token unit (policy+name hex)">
          <input
            type="text"
            value={tokenUnitInput}
            onChange={(e) => setTokenUnitInput(e.target.value)}
            className="w-full break-all rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-sky-700 focus:outline-none"
          />
        </Field>
        <Field label="ada_used (ADA, decimal)">
          <input
            type="text"
            inputMode="decimal"
            value={adaUsedAdaInput}
            onChange={(e) => setAdaUsedAdaInput(e.target.value)}
            className="w-32 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
          />
        </Field>
        <button
          type="button"
          onClick={onLoad}
          disabled={busy || !walletApi}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-800"
        >
          {busy ? "loading…" : "load tank + oracle"}
        </button>
        {err ? (
          <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {err}
          </p>
        ) : null}
      </section>

      {tank ? (
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
          <header className="text-base font-semibold text-zinc-100">tank</header>
          <Row label="utxo">
            <span className="break-all font-mono text-xs text-zinc-200">
              {tank.utxo.txHash}#{tank.utxo.outputIndex}
            </span>
          </Row>
          <Row label="lovelace">
            <span className="font-mono text-xs">
              {(Number(tank.utxo.assets.lovelace ?? 0n) / 1e6).toFixed(6)} ADA
            </span>
          </Row>
          <Row label="tank owner">
            <span className="break-all font-mono text-xs">
              {tankAddressBech32 ?? "(decode pending)"}
            </span>
          </Row>
          <Row label="whitelist">
            {tank.datum.whitelistedAddresses.length === 0
              ? "none — anyone-can-call"
              : `${tank.datum.whitelistedAddresses.length} entries`}
          </Row>
          <Row label="allowed tokens">
            <span>{tank.datum.allowedTokens.length}</span>
          </Row>
          {matchingToken ? (
            <div className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-100">
              <p className="font-semibold">
                ✓ this tank accepts the requested token at index{" "}
                {matchingTokenIndex}.
              </p>
              <p className="mt-1 font-mono">
                markup: {matchingToken.amount.toString()} /{" "}
                {matchingToken.divider.toString()} ={" "}
                {(Number(matchingToken.amount) / Number(matchingToken.divider)).toFixed(3)}×
                oracle spot
              </p>
              <p className="mt-1 font-mono">
                oracle ref:{" "}
                {matchingToken.oracle
                  ? `${matchingToken.oracle.policyId.slice(0, 12)}…+${matchingToken.oracle.assetName}`
                  : "none (static rate)"}
              </p>
            </div>
          ) : (
            <p className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              this tank does not accept the requested token.
            </p>
          )}
        </section>
      ) : null}

      {oracle ? (
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
          <header className="text-base font-semibold text-zinc-100">
            FluidTokens oracle ({oracle.source})
          </header>
          <Row label="symbol">{oracle.symbol || oracle.name}</Row>
          <Row label="price">
            <span className="font-mono text-xs">
              {oracle.priceInLovelaces.toString()} /{" "}
              {oracle.denominator.toString()} lovelace per token
            </span>
          </Row>
          <Row label="implied rate">
            <span className="font-mono text-xs">
              1 ADA ≈{" "}
              {String(
                (oracle.denominator * 1_000_000n) / oracle.priceInLovelaces,
              )}{" "}
              tokens (spot)
            </span>
          </Row>
          <Row label="valid window">
            <span className="font-mono text-xs">
              {new Date(Number(oracle.validFrom)).toISOString()} →{" "}
              {new Date(Number(oracle.validTo)).toISOString()}
            </span>
          </Row>
          <Row label="signatures">
            {oracle.signatures.length} signature
            {oracle.signatures.length === 1 ? "" : "s"}
          </Row>
        </section>
      ) : null}

      {requiredHosky && matchingToken && oracle ? (
        <section className="space-y-3 rounded-lg border border-sky-900 bg-sky-950/30 p-4 text-sm text-sky-100">
          <header className="text-base font-semibold">required token payment</header>
          <p className="font-mono text-xs">
            ada_used = {requiredHosky.adaUsedLovelace.toString()} lovelace
            ({adaUsedAdaInput} ADA)
          </p>
          <p className="font-mono text-xs">
            ceil(ada_used × denom / price) × amount / divider ={" "}
            <strong className="text-sky-300">
              {requiredHosky.token.toString()}
            </strong>{" "}
            smallest-units of paying token
          </p>
          <p className="font-mono text-xs text-sky-200">
            buyer pays ≥ {requiredHosky.token.toString()} units on the
            payment-to-tankOwner output to receive {adaUsedAdaInput} ADA from
            the tank.
          </p>
        </section>
      ) : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs uppercase tracking-widest text-zinc-400">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 sm:w-24">
        {label}
      </span>
      <span className="text-zinc-200">{children}</span>
    </div>
  );
}
