/**
 * Tx assembler for the FluidTokens "consume tank for ADA, pay back in
 * HOSKY" babel-fee flow. Standalone today (no marketplace coupling) —
 * v2 will wrap this into a {@code submitMarketBuy} variant that puts
 * the tank pieces alongside the marketplace ones.
 *
 * <p>What goes into a tank-consume tx (from
 * {@code validators/tank.ak}'s {@code ConsumeOracle} handler):
 *
 * <ul>
 *   <li><b>1 tank input</b> at the Aquarium tank script address
 *       (exactly one — validator enforces).</li>
 *   <li><b>3 reference inputs</b>: the Parameters NFT UTxO, the
 *       oracle data UTxO (carries the per-token oracle NFT), and the
 *       tank validator's CIP-33 reference-script UTxO. The
 *       oracle's own reference-script UTxO is added too so the
 *       withdraw-target's validator can be resolved without a fat
 *       attachScript. So really 4 ref inputs in the typical case.</li>
 *   <li><b>Buyer wallet inputs</b> to cover the HOSKY payment +
 *       change min-utxo. Evolution's coin selector handles this.</li>
 *   <li><b>Output 0</b> = continuing tank output (same address, same
 *       datum, reduced lovelace).</li>
 *   <li><b>Output 1</b> = payment to {@code tankOwner} (the HOSKY +
 *       a small min-utxo of lovelace).</li>
 *   <li><b>Output 2+</b> = change back to buyer wallet.</li>
 *   <li><b>1 withdrawal certificate</b> of 0 lovelace from the
 *       oracle's stake address, carrying the
 *       {@link buildOracleRedeemer} redeemer. The tank validator
 *       reads the signed price feed from this redeemer.</li>
 *   <li><b>tx validity range</b> bounded within the oracle feed's
 *       {@code [validFrom, validTo]} window (~50 min).</li>
 * </ul>
 *
 * <p>The validator addresses reference inputs positionally
 * ({@code list.at(self.reference_inputs, oracleIndex)} etc.), so the
 * tx-builder needs to KNOW the canonical sort order before writing
 * the ConsumeOracle redeemer's indices. We sort by (tx_hash hex
 * ascending, output_index ascending) which matches Conway's canonical
 * set encoding.
 */

import {
  Address,
  Credential as EvCredential,
  Data,
} from "@evolution-sdk/evolution";

import type { EvolutionClient } from "@/lib/tx/evolutionClient";
import { inlineDatum, toAssets, toTxInput } from "@/lib/tx/txAdapters";
import { adaptUtxo, type UTxO } from "@/lib/tx/utxo";

import type { LiveOraclePrice } from "./api";
import { onChainAddressToBech32 } from "./datum";
import { type TankUtxo, tankAcceptsToken } from "./discovery";
import { checkAdaUsedBounds, requiredTokenPayment } from "./math";
import { buildConsumeOracleRedeemer, buildOracleRedeemer } from "./redeemer";

/* -------------------------------------------------------------------------- */
/* Known mainnet on-chain wiring                                              */
/* -------------------------------------------------------------------------- */

/**
 * CIP-33 reference-script UTxO for the Aquarium tank validator on
 * mainnet — observed in real consume tx {@code c8b738aa…} on
 * 2026-05-29. If FluidTokens redeploys the validator this rolls; the
 * tx-builder will fail with "ref-script not found" until updated.
 */
const TANK_REF_SCRIPT_OUTREF = {
  txHash: "354ffe7958d62a8a2bf0b0bd97a06694d59dc49b6d02f1ab40165a3955257168",
  outputIndex: 0,
} as const;

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Inputs the caller hands to {@link buildAndSubmitBabelConsume}.
 */
export type BabelConsumeInputs = {
  /** Connected wallet's bech32 (mainnet `addr1q…`). Change lands here. */
  buyerBech32Address: string;
  /** Tank we're spending. */
  tank: TankUtxo;
  /** Paying token unit (policy + asset_name hex). E.g. HOSKY. */
  paymentTokenUnitHex: string;
  /** Target {@code ada_used} in lovelace. Must be ≥ 0.3 ADA. */
  adaUsedLovelace: bigint;
  /**
   * Lovelace to put on the payment-to-tankOwner output. Will be
   * clamped at runtime to the network's min-utxo for an output
   * carrying (lovelace + paying-token). Capped by
   * {@code DatumParameters.min_ada} (≈ 30,000 ADA — effectively
   * unbounded).
   */
  paymentMinLovelace: bigint;
  /** Live oracle feed pulled from {@code api.fluidtokens.com}. */
  oracle: LiveOraclePrice;
  /** Parameters UTxO (discovered via {@code findParametersUtxo}). */
  parameters: UTxO;
  /** Oracle data UTxO — carries the {@code oracle*} NFT. */
  oracleDataUtxo: UTxO;
  /** Oracle validator's CIP-33 reference-script UTxO. */
  oracleRefScriptUtxo: UTxO;
};

/**
 * Result of a successful submit: the tx hash + the assembled pieces
 * (useful for debugging / tests).
 */
export type BabelConsumeResult = {
  txHash: string;
  /** Number of HOSKY (or other paying token) the tx actually pays. */
  tokenPayment: bigint;
  /** What the resulting tank UTxO carries in lovelace. */
  continuingTankLovelace: bigint;
};

/**
 * Build + sign + submit a standalone babel-fee tank consume.
 *
 * <p>Throws on any validation issue (bounds check, missing oracle
 * signature, network mismatch, Evolution-side build failure). The
 * caller is expected to surface the message verbatim in the UI.
 */
export async function buildAndSubmitBabelConsume(
  client: EvolutionClient,
  inputs: BabelConsumeInputs,
): Promise<BabelConsumeResult> {
  validateInputs(inputs);

  const networkId = networkIdFromClient(client);
  const policyHex = inputs.paymentTokenUnitHex.slice(0, 56).toLowerCase();
  const nameHex = inputs.paymentTokenUnitHex.slice(56).toLowerCase();
  const unitLower = (policyHex + nameHex).toLowerCase();

  const payingTokenIndex = tankAcceptsToken(inputs.tank.datum, policyHex, nameHex);
  if (payingTokenIndex < 0) {
    throw new Error(
      `tank does not accept ${unitLower} — its allowedTokens list has no match`,
    );
  }
  const payingToken = inputs.tank.datum.allowedTokens[payingTokenIndex];

  // Math: how many tokens must land on the payment-to-tankOwner output.
  const tokenPayment = requiredTokenPayment({
    adaUsed: inputs.adaUsedLovelace,
    priceInLovelaces: inputs.oracle.priceInLovelaces,
    denominator: inputs.oracle.denominator,
    amount: payingToken.amount,
    divider: payingToken.divider,
  });

  // Fetch the tank validator's CIP-33 ref-script UTxO. Hardcoded
  // mainnet outref; we adapt-and-throw if it's been rolled so the
  // operator knows to update the constant.
  const tankRefScriptUtxos = await client.getUtxosByOutRef([
    toTxInput(TANK_REF_SCRIPT_OUTREF.txHash, TANK_REF_SCRIPT_OUTREF.outputIndex),
  ]);
  if (tankRefScriptUtxos.length === 0) {
    throw new Error(
      `tank CIP-33 ref-script UTxO ${TANK_REF_SCRIPT_OUTREF.txHash}#${TANK_REF_SCRIPT_OUTREF.outputIndex} not found — FluidTokens may have redeployed the validator; update TANK_REF_SCRIPT_OUTREF in tankConsume.ts`,
    );
  }
  const tankRefScript: UTxO = adaptUtxo(tankRefScriptUtxos[0]);

  // Canonical reference-input ordering matches Conway's serialised
  // set ordering — by (tx_hash bytes ascending, then output_index).
  // The validator reads ref inputs by integer index, so we need to
  // KNOW what index each ref will land at before encoding the
  // ConsumeOracle redeemer.
  const refInputs: UTxO[] = canonicalRefSort([
    inputs.parameters,
    inputs.oracleDataUtxo,
    inputs.oracleRefScriptUtxo,
    tankRefScript,
  ]);
  const oracleIndex = indexOfRef(refInputs, inputs.oracleDataUtxo);
  const paramsIndex = indexOfRef(refInputs, inputs.parameters);

  // Redeemers.
  const tankSpendRedeemer = buildConsumeOracleRedeemer({
    payingTokenIndex,
    inputTankIndex: 0,
    receivers: 0,
    oracleIndex,
    paramsIndex,
    whitelistIndex: 0,
  });
  const oracleWithdrawRedeemer = buildOracleRedeemer(inputs.oracle);

  // Outputs (positional!):
  //   outputs[0] = continuing tank (same address, same datum, reduced lovelace)
  //   outputs[1] = payment to tankOwner (paying-token + min-ada)
  // Evolution appends change at outputs[2+] automatically.
  const tankInputLovelace = inputs.tank.utxo.assets.lovelace ?? 0n;
  const continuingTankLovelace =
    tankInputLovelace - inputs.adaUsedLovelace - inputs.paymentMinLovelace;
  if (continuingTankLovelace < 0n) {
    throw new Error(
      `tank doesn't hold enough ADA: input ${tankInputLovelace}, want ${inputs.adaUsedLovelace + inputs.paymentMinLovelace} (ada_used + payment min)`,
    );
  }

  const tankBech32 = inputs.tank.utxo.address;
  const tankOwnerBech32 = onChainAddressToBech32(
    inputs.tank.datum.tankOwner,
    networkId,
  );
  // The continuing tank output's inline-datum CBOR is the tank's input
  // datum byte-for-byte (the validator does inputTank.output.datum ==
  // outputTank.datum). Easiest reliable way: pass the raw CBOR straight
  // through.
  if (!inputs.tank.utxo.datum) {
    throw new Error("tank UTxO has no inline datum — not a real tank");
  }

  // Pull the oracle stake credential from the rewardAddress bech32.
  const oracleStakeCredential = stakeCredentialFromRewardAddress(
    inputs.oracle.oracleWithdrawAddress,
  );

  // Tx validity range — must fall within the oracle feed's window.
  // Evolution's setValidity takes UnixTime (bigint ms).
  const validFromMs = inputs.oracle.validFrom;
  const validToMs = inputs.oracle.validTo;

  // Sanity: bound check on ada_used is mostly informational here —
  // the validator will fail loudly if violated.
  const boundsErr = checkAdaUsedBounds(inputs.adaUsedLovelace, payingToken.amount);
  if (boundsErr !== null) throw new Error(boundsErr);

  // Build.
  const builder = client
    .newTx()
    .collectFrom({
      inputs: [inputs.tank.utxo._evolution],
      redeemer: tankSpendRedeemer,
    })
    // ref inputs (canonical order — Evolution sorts internally, but
    // pass them as the same set we used to compute indices). The tank
    // ref-script entry brings the validator bytes; oracleRefScript
    // brings the oracle validator bytes for the withdraw eval.
    .readFrom({ referenceInputs: refInputs.map((r) => r._evolution) })
    .withdraw({
      stakeCredential: oracleStakeCredential,
      amount: 0n,
      redeemer: oracleWithdrawRedeemer,
    })
    // Output 0 — continuing tank. Same address + datum, reduced ADA.
    // The validator does inputTank.output.datum == outputTank.datum
    // byte-by-byte; safest is to round-trip the input's CBOR hex
    // through Data.fromCBORHex so the inline-datum on the output is
    // structurally identical.
    .payToAddress({
      address: Address.fromBech32(tankBech32),
      assets: toAssets({ lovelace: continuingTankLovelace }),
      datum: inlineDatum(Data.fromCBORHex(inputs.tank.utxo.datum)),
    })
    // Output 1 — payment to tankOwner. Carries the required paying-
    // token amount + a small min-ada the validator caps by params.
    .payToAddress({
      address: Address.fromBech32(tankOwnerBech32),
      assets: toAssets({
        lovelace: inputs.paymentMinLovelace,
        [unitLower]: tokenPayment,
      }),
    })
    .setValidity({ from: validFromMs, to: validToMs });

  const built = await builder.build();
  const signed = await built.sign();
  const txHash = await signed.submit();
  return {
    txHash: typeof txHash === "string" ? txHash : String(txHash),
    tokenPayment,
    continuingTankLovelace,
  };
}

/* -------------------------------------------------------------------------- */
/* Internal                                                                   */
/* -------------------------------------------------------------------------- */

function validateInputs(inputs: BabelConsumeInputs): void {
  if (inputs.oracle.signatures.length === 0) {
    throw new Error(
      "oracle entry has no signatures — non-multisig oracle types aren't supported yet (only the FluidTokens multisig Aggregated path)",
    );
  }
  if (inputs.oracle.source !== "multisig") {
    throw new Error(
      `oracle source ${inputs.oracle.source} not supported — only "multisig" (Aggregated) for v1`,
    );
  }
}

function canonicalRefSort(refs: UTxO[]): UTxO[] {
  return [...refs].sort((a, b) => {
    if (a.txHash < b.txHash) return -1;
    if (a.txHash > b.txHash) return 1;
    return a.outputIndex - b.outputIndex;
  });
}

function indexOfRef(refs: UTxO[], target: UTxO): number {
  const idx = refs.findIndex(
    (r) => r.txHash === target.txHash && r.outputIndex === target.outputIndex,
  );
  if (idx < 0) throw new Error("reference input not found in canonical sort");
  return idx;
}

function stakeCredentialFromRewardAddress(rewardBech32: string) {
  // stake1u… / stake_test1u… → header byte tells key vs script. The
  // simpler portable path: use Evolution's RewardAccount helpers to
  // decode. We do the minimal manual parse for now since we don't
  // import RewardAccount elsewhere.
  // The reward bech32 decodes to: header (1 byte) || credential hash (28 bytes).
  // Header low-nibble: 0=key, 1=script. High-nibble: network.
  // We rebuild via Credential.makeScriptHash because the FluidTokens
  // oracle's reward address IS a script credential (validator-controlled).
  const decoded = decodeBech32(rewardBech32);
  if (decoded.length !== 29) {
    throw new Error(
      `reward address ${rewardBech32} decodes to ${decoded.length} bytes (expected 29 = header + 28)`,
    );
  }
  const header = decoded[0];
  const hash = decoded.slice(1);
  const isScript = (header & 0x0f) === 0x01 || (header & 0x0f) === 0x0f;
  if (!isScript) {
    throw new Error(
      `reward address ${rewardBech32} carries a key credential — FluidTokens oracles use script credentials`,
    );
  }
  return EvCredential.makeScriptHash(hash);
}

function networkIdFromClient(client: EvolutionClient): 0 | 1 {
  const id = (client as unknown as { network: { networkId: number } }).network
    .networkId;
  return id === 1 ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Minimal bech32 decoder — Cardano reward addresses                          */
/* -------------------------------------------------------------------------- */

/**
 * Decode a Cardano-style bech32 string (no length cap) into its raw
 * 5-bit payload converted back to 8-bit bytes. Sufficient for reward
 * addresses (header byte + 28-byte credential hash = 29 bytes).
 *
 * <p>We carry our own decoder so the babel-fee module doesn't pull in
 * a fat bech32 lib for one call.
 */
function decodeBech32(s: string): Uint8Array {
  const lower = s.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1) throw new Error("bech32: separator not found");
  const dataPart = lower.slice(sep + 1, lower.length - 6); // last 6 = checksum
  const fiveBit: number[] = [];
  for (const c of dataPart) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) throw new Error(`bech32: invalid char ${c}`);
    fiveBit.push(v);
  }
  return convertBits(fiveBit, 5, 8, false);
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error("convertBits: invalid data");
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("convertBits: non-zero padding");
  }
  return new Uint8Array(out);
}

// Re-export for any caller that needs a single-asset payment-output
// hint or wants to inspect the TANK_REF_SCRIPT_OUTREF constant.
export const _internals = {
  TANK_REF_SCRIPT_OUTREF,
  canonicalRefSort,
  indexOfRef,
};

