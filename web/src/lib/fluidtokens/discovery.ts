/**
 * Chain queries for the babel-fee feature.
 *
 * <p>Three things the tx-builder needs to find at runtime:
 *   - a tank UTxO that accepts the user's chosen paying token,
 *   - the Parameters UTxO (must be a reference input on every consume),
 *   - the oracle data UTxO (carries the oracle NFT — also a ref input).
 *
 * <p>For v1 of the feature we keep the surface intentionally small —
 * one direct {@link fetchTankByOutRef} lookup is enough to power the
 * happy path against a known tank. The richer "scan all tanks + pick
 * the cheapest one that accepts X" is teed up by {@link findTanksAcceptingToken}
 * but the buy page can defer it until multiple tanks exist for the
 * same token.
 */

import { Address, Credential, Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "@/lib/tx/evolutionClient";
import { toTxInput } from "@/lib/tx/txAdapters";
import { adaptUtxo, type UTxO } from "@/lib/tx/utxo";

import { decodeDatumTank } from "./datum";
import {
  AQUARIUM_PARAMETERS_POLICY_ID,
  AQUARIUM_TANK_SCRIPT_HASH,
  AQUARIUM_TANK_STAKE_HASH,
  PARAMETERS_ASSET_NAME,
  type DatumTank,
} from "./types";

/**
 * Decoded "this UTxO is a usable tank" view. Carries the underlying
 * {@link UTxO} for re-injection into the Evolution tx builder, plus
 * the structured datum so the tx-builder doesn't re-decode it.
 */
export type TankUtxo = {
  utxo: UTxO;
  datum: DatumTank;
};

/**
 * Direct outref lookup — fastest path when the user has a known-good
 * tank to spend (e.g. their own tank from {@code af40a4c9…#0}).
 * Returns {@code null} when the UTxO is gone (spent / reorg) or its
 * datum doesn't decode as a {@link DatumTank}.
 */
export async function fetchTankByOutRef(
  client: EvolutionClient,
  outRef: { txHash: string; outputIndex: number },
): Promise<TankUtxo | null> {
  const utxos = await client.getUtxosByOutRef([
    toTxInput(outRef.txHash, outRef.outputIndex),
  ]);
  if (utxos.length === 0) return null;

  const adapted = adaptUtxo(utxos[0]);
  return tankFromUtxo(adapted);
}

/**
 * Enumerate every tank UTxO whose datum accepts the given paying
 * token. Useful when:
 *   - the buyer-facing UI needs to surface "which tanks can subsidise
 *     this buy" without a hardcoded outref,
 *   - the operator wants telemetry on competing tank rates.
 *
 * <p>Today the live mainnet has O(hundreds) of tanks (Koios reported
 * 830 active). Filtering client-side is acceptable for that scale; if
 * it grows past a few thousand we'd page server-side.
 */
export async function findTanksAcceptingToken(
  client: EvolutionClient,
  paymentTokenPolicyHex: string,
  paymentTokenNameHex: string,
): Promise<TankUtxo[]> {
  const addr = aquariumTankBech32(networkIdFromClient(client));
  const all = await client.getUtxos(Address.fromBech32(addr));
  const out: TankUtxo[] = [];
  const policy = paymentTokenPolicyHex.toLowerCase();
  const name = paymentTokenNameHex.toLowerCase();
  for (const u of all) {
    const adapted = adaptUtxo(u);
    const tank = tankFromUtxo(adapted);
    if (tank === null) continue;
    if (tankAcceptsToken(tank.datum, policy, name) === -1) continue;
    out.push(tank);
  }
  return out;
}

/**
 * Locate the singleton Parameters UTxO — the one carrying the
 * {@code (parameters_policy, "parameters")} NFT. The validator demands
 * it as a reference input on every non-Withdraw tank action.
 *
 * <p>The Parameters NFT has rolled at least once on mainnet
 * (FluidTokens moved from {@code 721a739a…#0} to {@code b79f33b8…#0}
 * during build-out), so the outref MUST be discovered at runtime, not
 * hardcoded.
 *
 * <p>Implementation: query the FluidTokens parameters script address
 * for UTxOs and return the one with the NFT. Evolution doesn't expose
 * a direct "find UTxOs by asset" call so we go through the script
 * address.
 */
export async function findParametersUtxo(
  client: EvolutionClient,
): Promise<UTxO | null> {
  const addr = parametersBech32(networkIdFromClient(client));
  const all = await client.getUtxos(Address.fromBech32(addr));
  for (const u of all) {
    const adapted = adaptUtxo(u);
    const unit = (AQUARIUM_PARAMETERS_POLICY_ID + hexEncodeAscii(PARAMETERS_ASSET_NAME)).toLowerCase();
    const qty = adapted.assets[unit];
    if (qty && qty > 0n) return adapted;
  }
  return null;
}

/**
 * Locate the first datum index in a tank's allowedTokens list that
 * matches the given (policy, name). Returns {@code -1} when not found.
 *
 * <p>The returned index goes straight into the
 * {@code ConsumeOracle.payingTokenIndex} redeemer field.
 */
export function tankAcceptsToken(
  tank: DatumTank,
  paymentTokenPolicyHex: string,
  paymentTokenNameHex: string,
): number {
  const policy = paymentTokenPolicyHex.toLowerCase();
  const name = paymentTokenNameHex.toLowerCase();
  for (let i = 0; i < tank.allowedTokens.length; i++) {
    const t = tank.allowedTokens[i];
    if (t.policyId.toLowerCase() === policy && t.assetName.toLowerCase() === name) {
      return i;
    }
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Internal                                                                   */
/* -------------------------------------------------------------------------- */

function tankFromUtxo(utxo: UTxO): TankUtxo | null {
  if (!utxo.datum) return null;
  let datum: Data.Data;
  try {
    datum = Data.fromCBORHex(utxo.datum);
  } catch {
    return null;
  }
  const decoded = decodeDatumTank(datum);
  if (decoded === null) return null;
  return { utxo, datum: decoded };
}

/**
 * Aquarium tank script address (mainnet/preprod). Base address with
 * the script payment credential + the script stake credential. The
 * stake credential is non-trivial — FluidTokens registered the script
 * for delegation so the stake-cred bytes are baked into every tank
 * UTxO. The encoder is the same on every network — networkId is the
 * only varying byte.
 */
function aquariumTankBech32(networkId: 0 | 1): string {
  return Address.toBech32(
    new Address.Address({
      networkId,
      paymentCredential: Credential.makeScriptHash(
        hexToBytes(AQUARIUM_TANK_SCRIPT_HASH),
      ),
      stakingCredential: Credential.makeScriptHash(
        hexToBytes(AQUARIUM_TANK_STAKE_HASH),
      ),
    }),
  );
}

/**
 * Parameters script address (mainnet) — derived from the parameters
 * policy id (= the parameters validator's script hash). The script
 * doubles as a mint policy, so the policy id IS the script hash.
 */
function parametersBech32(networkId: 0 | 1): string {
  return Address.toBech32(
    new Address.Address({
      networkId,
      paymentCredential: Credential.makeScriptHash(
        hexToBytes(AQUARIUM_PARAMETERS_POLICY_ID),
      ),
    }),
  );
}

function networkIdFromClient(client: EvolutionClient): 0 | 1 {
  // The Evolution Client carries its network on `.network.networkId`.
  // We erase to `unknown` here because pulling Evolution's Network type
  // into the discovery module is unnecessary for this single read.
  const id = (client as unknown as { network: { networkId: number } }).network
    .networkId;
  return id === 1 ? 1 : 0;
}

function hexEncodeAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : "0" + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
