/**
 * Plutus Data encoders for the redeemers we attach to a tank-consume
 * tx. Two redeemers in play:
 *
 * <ol>
 *   <li><b>{@code ConsumeOracle}</b> — attached to the tank spend.
 *       6 integer fields (verbatim from {@code lib/types/redeemer.ak}).</li>
 *   <li><b>{@code OracleRedeemer}</b> — attached to the
 *       {@code withdraw 0 lovelace} certificate that triggers the
 *       oracle validator. Carries the signed price feed + multisig
 *       signatures. The tank validator reads the price from THIS
 *       redeemer (not from the oracle UTxO's datum) via
 *       {@code retrieve_oracle_data}.</li>
 * </ol>
 *
 * <p>Constructor indices are positional in the Aiken source — re-order
 * the variants and the wire format diverges. Pinned values:
 *   RedeemerTank: Consume=0, ConsumeAll=1, Withdraw=2,
 *                 ScheduledTransaction=3, ConsumeOracle=4, ConsumeAllOracle=5.
 *   OraclePriceFeed: Aggregated=0, Pooled=1, Dedicated=2,
 *                    PriceDataCharlie=3, PriceDataOrcfax=4.
 */

import { Data } from "@evolution-sdk/evolution";

import type { LiveOraclePrice } from "./api";

/**
 * Build the {@code ConsumeOracle} redeemer attached to the tank spend.
 * Every field is a non-negative integer; indices into the tx's
 * reference-input list and the tank datum's allowedTokens list.
 *
 * @param payingTokenIndex   index into {@code tank.datum.allowedTokens}
 *                           of the paying token. For a single-token
 *                           tank (HOSKY-only) this is 0.
 * @param oracleIndex        index of the oracle data UTxO in the
 *                           tx's reference_inputs after canonical sort.
 * @param paramsIndex        index of the Parameters UTxO in the
 *                           tx's reference_inputs after canonical sort.
 * @param whitelistIndex     index into {@code tank.datum.whitelistedAddresses}
 *                           — only consulted when the whitelist is
 *                           non-empty; pass 0 otherwise. The user's
 *                           HOSKY tank has an empty whitelist so this
 *                           is irrelevant for v1.
 */
export function buildConsumeOracleRedeemer(args: {
  payingTokenIndex: number;
  inputTankIndex: number; // 0 — we always spend exactly one tank input
  receivers: number; // 0 — unused by the validator (prefixed _ in source)
  oracleIndex: number;
  paramsIndex: number;
  whitelistIndex: number;
}): Data.Data {
  return Data.constr(4n, [
    Data.int(BigInt(args.payingTokenIndex)),
    Data.int(BigInt(args.inputTankIndex)),
    Data.int(BigInt(args.receivers)),
    Data.int(BigInt(args.oracleIndex)),
    Data.int(BigInt(args.paramsIndex)),
    Data.int(BigInt(args.whitelistIndex)),
  ]);
}

/**
 * Build the {@code OracleRedeemer} attached to the
 * {@code withdraw 0 lovelace} certificate.
 *
 * <p>Wire shape:
 * <pre>
 *   Constr 0 [
 *     data: OraclePriceFeed = Constr 0 [common, priceInLov, denom]  // Aggregated
 *     signatures: List [ Constr 0 [signature_bytes, key_position] … ]
 *   ]
 * </pre>
 *
 * <p>FluidTokens multisig HOSKY oracle uses the
 * {@link OraclePriceFeedAggregated} variant (constructor index 0).
 * The validator's {@code retrieve_oracle_data} pattern-matches on
 * this and produces a rational {@code priceInLovelaces / denominator}.
 *
 * <p>Key positions are looked up from the oracle entry's
 * {@code multisigOracle.publicKeys} list (the registry-side ordering
 * the oracle validator was parameterized on). For single-signer
 * tanks the only key is at position 0 — that's the common case
 * today.
 */
export function buildOracleRedeemer(
  oracle: LiveOraclePrice,
): Data.Data {
  const publicKeys = oracle.raw.fluidOracle
    ? (
        oracle.raw.supportedOracle?.[oracle.source]?.multisigOracle
          ?.signatures ?? []
      ).map((s) => s.publicKey)
    : [];
  // Map each signature → on-chain Signature{signature, key_position}.
  // key_position is the index of the matching publicKey in the
  // oracle validator's verification_keys parameter. The registry
  // returns publicKeys in the same order the validator was
  // parameterised on, so the position = index in that list. For our
  // current single-signer setup this resolves to 0.
  const signatures: Data.Data[] = [];
  for (let i = 0; i < oracle.signatures.length; i++) {
    const sig = oracle.signatures[i];
    const keyPosition = publicKeys.length > 0
      ? publicKeys.findIndex(
          (pk) => pk.toLowerCase() === sig.publicKey.toLowerCase(),
        )
      : i;
    if (keyPosition < 0) {
      throw new Error(
        `signature publicKey ${sig.publicKey} not in oracle multisig key list`,
      );
    }
    signatures.push(
      Data.constr(0n, [
        Data.bytearray(sig.signature.toLowerCase()),
        Data.int(BigInt(keyPosition)),
      ]),
    );
  }

  // OraclePriceFeed.Aggregated = Constr 0 [ commonFeedData, price, denom ].
  // commonFeedData = Constr 0 [ validFrom, validTo, token: Constr 0 [policy, name] ].
  const tokenPolicy = oracle.raw.token?.policyId ?? "";
  const tokenName = oracle.raw.token?.assetName ?? "";
  const commonFeedData = Data.constr(0n, [
    Data.int(oracle.validFrom),
    Data.int(oracle.validTo),
    Data.constr(0n, [
      Data.bytearray(tokenPolicy.toLowerCase()),
      Data.bytearray(tokenName.toLowerCase()),
    ]),
  ]);
  const aggregated = Data.constr(0n, [
    commonFeedData,
    Data.int(oracle.priceInLovelaces),
    Data.int(oracle.denominator),
  ]);

  return Data.constr(0n, [aggregated, Data.list(signatures)]);
}
