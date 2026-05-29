/**
 * Babel-fee math. Mirrors the {@code validate_payment_output_oracle}
 * function in {@code validators/tank.ak} byte-for-byte using BigInt
 * arithmetic — every integer division must use the same flooring
 * semantics Aiken's {@code Int} operations use, otherwise the
 * tx-builder produces a payment amount the validator rejects.
 *
 * <p>Validator formula (verbatim, with the names mapped to TS):
 * <pre>
 *   tokenPrice       = priceInLovelaces / denominator        // rational, lossless
 *   minTokenPayment  = ada_used / tokenPrice                 // rational
 *                    = ada_used * denominator / priceInLov   // ceiling-rounded
 *   required_token   = ceil(minTokenPayment) * amount / divider
 *                                                            // INTEGER div — truncates
 * </pre>
 *
 * <p>The validator's inequality is:
 * <pre>
 *   required_token ≤ outputPaymentAmount
 * </pre>
 * so the tx-builder must provide AT LEAST {@code requiredTokenPayment(...)}
 * tokens on the payment output. Providing the exact computed value is
 * safe — the validator accepts equality.
 */

import { MIN_ADA_SPENDABLE, MAX_ADA_SPENDABLE_FREE_TANKS } from "./types";

/**
 * Inputs the tx-builder hands to {@link requiredTokenPayment}:
 *   - {@code adaUsed}: lovelace that flows out of the tank (= input ADA
 *     minus continuing-tank ADA minus payment-output ADA).
 *   - {@code priceInLovelaces} / {@code denominator}: from the live
 *     oracle feed (api.fluidtokens.com/get-oracle-tokens). NOT the
 *     tank datum's markup.
 *   - {@code amount} / {@code divider}: from the tank datum's
 *     {@link CardanoToken}. The tank operator's markup on top of spot.
 *     E.g. 120 / 100 = 1.2× spot.
 */
export type BabelFeeInputs = {
  adaUsed: bigint;
  priceInLovelaces: bigint;
  denominator: bigint;
  amount: bigint;
  divider: bigint;
};

/**
 * Smallest-unit count of the paying token the tx-builder MUST attach
 * to the tank-owner payment output. Mirrors the Aiken validator's
 * inequality byte-for-byte.
 *
 * @throws when {@code priceInLovelaces} or {@code divider} is zero.
 */
export function requiredTokenPayment(inputs: BabelFeeInputs): bigint {
  const { adaUsed, priceInLovelaces, denominator, amount, divider } = inputs;
  if (priceInLovelaces <= 0n) {
    throw new Error("oracle priceInLovelaces must be > 0");
  }
  if (denominator <= 0n) {
    throw new Error("oracle denominator must be > 0");
  }
  if (divider <= 0n) {
    throw new Error("tank divider must be > 0");
  }
  if (amount < 0n) {
    throw new Error("tank amount must be >= 0");
  }
  // ceil( ada_used * denominator / priceInLovelaces )
  const minTokenPayment = ceilDiv(adaUsed * denominator, priceInLovelaces);
  // INTEGER truncating division — matches Aiken's `Int /` semantics.
  return (minTokenPayment * amount) / divider;
}

/**
 * Inverse of {@link requiredTokenPayment} — given a desired token
 * payment, the maximum {@code ada_used} the validator will accept.
 * Useful for "user has X HOSKY; what's the most fee subsidy they can
 * afford" computations.
 *
 * <p>Derived from the inequality {@code ceil(adaUsed * denom / price) *
 * amount / divider ≤ tokenBudget}; we solve for the largest adaUsed
 * such that this holds. Since the formula is monotonic in adaUsed,
 * binary search would work; closed-form below.
 */
export function maxAdaUsedForToken(
  tokenBudget: bigint,
  priceInLovelaces: bigint,
  denominator: bigint,
  amount: bigint,
  divider: bigint,
): bigint {
  if (amount === 0n) {
    // Free tank: no token payment required, so adaUsed is capped only
    // by the validator's max_ada_spendable (5 ADA).
    return MAX_ADA_SPENDABLE_FREE_TANKS;
  }
  // maxMinTokenPayment = floor(tokenBudget * divider / amount)
  const maxMinTokenPayment = (tokenBudget * divider) / amount;
  // adaUsed * denom / price ≤ maxMinTokenPayment + 1 (ceil leaves room)
  // → adaUsed ≤ maxMinTokenPayment * price / denom (floor)
  const adaUsed = (maxMinTokenPayment * priceInLovelaces) / denominator;
  return adaUsed;
}

/**
 * Validate {@code adaUsed} respects the static lower bound enforced by
 * the validator. The upper bound only applies to "free" tanks ({@code
 * amount == 0}) — paying-token tanks have no upper limit.
 *
 * <p>Returns null when valid; a short reason string when not.
 */
export function checkAdaUsedBounds(
  adaUsed: bigint,
  tankAmount: bigint,
): string | null {
  if (adaUsed < MIN_ADA_SPENDABLE) {
    return `ada_used (${adaUsed}) below MIN_ADA_SPENDABLE (${MIN_ADA_SPENDABLE} = 0.3 ADA)`;
  }
  if (tankAmount === 0n && adaUsed > MAX_ADA_SPENDABLE_FREE_TANKS) {
    return `ada_used (${adaUsed}) above MAX_ADA_SPENDABLE_FREE_TANKS (${MAX_ADA_SPENDABLE_FREE_TANKS} = 5 ADA) for a free tank`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Internal                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * BigInt ceiling division for positive operands.
 *
 * <pre>
 *   ceilDiv(11, 3)  === 4
 *   ceilDiv(12, 3)  === 4
 *   ceilDiv(13, 3)  === 5
 * </pre>
 *
 * @throws when {@code den <= 0n} — callers above guard before invoking.
 */
function ceilDiv(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("ceilDiv: divisor must be > 0");
  if (num <= 0n) return 0n;
  return (num + den - 1n) / den;
}
