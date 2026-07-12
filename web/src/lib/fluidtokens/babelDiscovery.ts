/**
 * One-shot discovery for the babel-fee buy path. Surfaces the four
 * reference UTxOs + tank + signed oracle feed needed to call
 * {@code submitMarketBuy} with a {@code babelFee} config.
 *
 * <p>v1 is HOSKY-only — the FluidTokens marketplace has live tanks
 * accepting HOSKY (we deployed one) but no tanks accepting any of
 * Shithole's other listed price tokens. When a buy page asks about
 * a non-HOSKY token, this returns {@code null} so the toggle stays
 * hidden.
 *
 * <p>Tank UTxO discovery: rather than rely on a stable outref (which
 * rolls every consume), we query for any tank UTxO at the known tank
 * address that accepts the requested paying token. The first live
 * candidate wins.
 */

import { Address } from "@evolution-sdk/evolution";

import { fetchOracleTokens, type LiveOraclePrice } from "./api";
import {
  fetchTankByOutRef,
  findParametersUtxo,
  tankAcceptsToken,
  type TankUtxo,
} from "./discovery";
import { decodeDatumTank } from "./datum";

import type { EvolutionClient } from "@/lib/tx/evolutionClient";
import { fetchUtxoByOutRef } from "@/lib/tx/swap";
import { adaptUtxo, type UTxO } from "@/lib/tx/utxo";

/**
 * Mainnet HOSKY token unit (policy + asset name hex). The babel-fee
 * UI uses this to decide whether to surface the toggle at all.
 */
export const HOSKY_UNIT_HEX_MAINNET =
  "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59";

/**
 * The current live tank address on mainnet. Stable across consumes:
 * the same payment-script + stake-key credential pair keeps producing
 * outputs at this bech32 even after each Consume rolls the outref.
 *
 * <p>Sourced from the 2026-05-29 babel-fee bootstrap. If a fresh
 * operator tank shows up later we'll add a registry; for v1 there's
 * exactly one operator (us).
 */
const TANK_BECH32_MAINNET =
  "addr1z8uhynz89x08gh95758e6dkthtwdlplqzk5an8vj0hzwsejrgt6vrx8paps567pa8qtj9wzah2gpfhme6933fq2vfmnsg3q3xc";

/** Tank validator's CIP-33 reference-script UTxO (mainnet). */
const TANK_REF_SCRIPT_OUTREF_MAINNET = {
  txHash: "354ffe7958d62a8a2bf0b0bd97a06694d59dc49b6d02f1ab40165a3955257168",
  outputIndex: 0,
} as const;

/** Bundle of everything submitMarketBuy needs as babelFee. */
export type BabelAvailability = {
  tank: TankUtxo;
  oracle: LiveOraclePrice;
  parameters: UTxO;
  oracleDataUtxo: UTxO;
  oracleRefScriptUtxo: UTxO;
  tankRefScriptUtxo: UTxO;
};

/**
 * Probe mainnet for everything needed to enable babel-fees on a buy
 * priced in {@code priceTokenUnit}. Returns {@code null} when any
 * piece is missing — the caller treats that as "babel toggle stays
 * disabled."
 *
 * @throws only when a downstream chain call fails outright (network
 *   error). Soft misses (no tank, no oracle entry, no live params)
 *   resolve to {@code null}.
 */
export async function probeBabelAvailability(
  client: EvolutionClient,
  priceTokenUnitHex: string,
): Promise<BabelAvailability | null> {
  const unit = priceTokenUnitHex.toLowerCase();
  if (unit !== HOSKY_UNIT_HEX_MAINNET) {
    // Only HOSKY tanks exist on mainnet today. Cheap early-exit so
    // ADA-priced buys and other tokens don't hit the chain.
    return null;
  }
  const policy = unit.slice(0, 56);
  const name = unit.slice(56);

  const [oracleEntries, tank, parameters] = await Promise.all([
    fetchOracleTokens().catch(() => [] as LiveOraclePrice[]),
    findLiveTank(client, policy, name),
    findParametersUtxo(client).catch(() => null),
  ]);

  const oracle = oracleEntries.find((e) => e.unit === unit) ?? null;
  if (!oracle || !tank || !parameters) return null;

  const oracleRefInputStr = oracle.raw.fluidOracle?.referenceInput ?? "";
  const oracleRefScriptStr = oracle.raw.fluidOracle?.referenceScript ?? "";
  if (!oracleRefInputStr.includes("#") || !oracleRefScriptStr.includes("#")) {
    return null;
  }

  const [oracleDataUtxo, oracleRefScriptUtxo, tankRefScriptUtxo] = await Promise.all([
    fetchUtxoByOutRef(
      client,
      oracleRefInputStr.split("#")[0],
      Number.parseInt(oracleRefInputStr.split("#")[1] ?? "0", 10),
    ),
    fetchUtxoByOutRef(
      client,
      oracleRefScriptStr.split("#")[0],
      Number.parseInt(oracleRefScriptStr.split("#")[1] ?? "0", 10),
    ),
    fetchTankRefScript(client),
  ]);

  return {
    tank,
    oracle,
    parameters,
    oracleDataUtxo,
    oracleRefScriptUtxo,
    tankRefScriptUtxo,
  };
}

/* -------------------------------------------------------------------------- */
/* Internal                                                                   */
/* -------------------------------------------------------------------------- */

async function findLiveTank(
  client: EvolutionClient,
  paymentTokenPolicyHex: string,
  paymentTokenNameHex: string,
): Promise<TankUtxo | null> {
  let raw: ReturnType<EvolutionClient["getUtxos"]> extends Promise<infer T> ? T : never;
  try {
    raw = await client.getUtxos(Address.fromBech32(TANK_BECH32_MAINNET));
  } catch {
    return null;
  }
  for (const u of raw) {
    const adapted = adaptUtxo(u);
    if (!adapted.datum) continue;
    let datum;
    try {
      const { Data } = await import("@evolution-sdk/evolution");
      datum = Data.fromCBORHex(adapted.datum);
    } catch {
      continue;
    }
    const decoded = decodeDatumTank(datum);
    if (!decoded) continue;
    const idx = tankAcceptsToken(decoded, paymentTokenPolicyHex, paymentTokenNameHex);
    if (idx < 0) continue;
    return { utxo: adapted, datum: decoded };
  }
  return null;
}

async function fetchTankRefScript(client: EvolutionClient): Promise<UTxO> {
  return fetchTankByOutRefAsUtxo(
    client,
    TANK_REF_SCRIPT_OUTREF_MAINNET.txHash,
    TANK_REF_SCRIPT_OUTREF_MAINNET.outputIndex,
  );
}

/**
 * fetchTankByOutRef returns a TankUtxo (decoded datum); for the tank
 * ref-script we just need the bare UTxO. This unwraps to a plain UTxO,
 * or throws if the outref is gone (the operator updated the ref-script).
 */
async function fetchTankByOutRefAsUtxo(
  client: EvolutionClient,
  txHash: string,
  outputIndex: number,
): Promise<UTxO> {
  // Reuse the existing helper instead of issuing a raw query.
  const utxo = await fetchUtxoByOutRef(client, txHash, outputIndex);
  return utxo;
}

// Re-export so callers that already imported the bare fetcher don't
// have to add a second import path.
export { fetchTankByOutRef };
