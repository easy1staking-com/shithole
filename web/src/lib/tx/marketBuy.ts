/**
 * Build + submit a single-listing marketplace `Buy` tx. The leader-pattern
 * bulk-buy is supported by the on-chain validator but not yet wired in the
 * FE — single-listing buy is by far the common path and is enough for the
 * dev-environment shakeout.
 *
 * <p>Tx shape (one listing, one jar leg):
 * <pre>
 *   inputs:                                  outputs:
 *     - listing UTxO (Buy)                     0: seller payout
 *     - jar UTxO (Deposit)                     1: jar continuing
 *     - buyer wallet UTxO(s)                   2: buyer's NFT
 *                                              3..: change (auto)
 * </pre>
 *
 * <p>Cardano sorts tx inputs canonically by (tx_hash, output_index). We
 * pre-sort our caller-supplied inputs the same way so we can compute
 * the on-chain index of the jar input and pass it to the validator via the
 * Buy redeemer's {@code jar_input_index} hint.
 */

import { Address, Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { applyJarScript, applyMarketplaceScript } from "./marketScripts";
import type { DecodedMarketDatum } from "./marketDatum";
import type { Network } from "./swap";
import {
  inlineDatum,
  toAddress,
  toAssets,
  txHashHex,
} from "./txAdapters";
import type { UTxO } from "./utxo";
import { tokenAwareLargestFirst } from "./coinSelection";
import { blake2b } from "@noble/hashes/blake2b";
import { serialiseOutputReference, hexToBytes } from "@/lib/pit/bucketMath";

import type { LiveOraclePrice } from "@/lib/fluidtokens/api";
import { onChainAddressToBech32 } from "@/lib/fluidtokens/datum";
import { tankAcceptsToken, type TankUtxo } from "@/lib/fluidtokens/discovery";
import { requiredTokenPayment } from "@/lib/fluidtokens/math";
import {
  buildConsumeOracleRedeemer,
  buildOracleRedeemer,
} from "@/lib/fluidtokens/redeemer";
import { stakeCredentialFromRewardAddress } from "@/lib/fluidtokens/credential";
import { getNetworkName } from "@/lib/wallet/network";

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** {@code blake2b_256(cbor.serialise(out_ref))} — same recipe as `compute_output_tag`. */
function computeOutputTag(txHashHex: string, outputIndex: number): string {
  const cbor = serialiseOutputReference(hexToBytes(txHashHex), outputIndex);
  return bytesToHex(blake2b(cbor, { dkLen: 32 }));
}

/**
 * Optional babel-fee config. When set, the buy tx ALSO spends a
 * FluidTokens tank to subsidise the ADA fee, paying the equivalent of
 * the paying token (HOSKY today) to the tank owner. A buyer holding
 * the paying token + ~2 ADA for change min-utxo can complete a
 * token-priced buy without holding the tx fee in ADA on top.
 *
 * <p>The 4 reference UTxOs (parameters, oracle data, oracle
 * ref-script, tank ref-script) are caller-supplied so the buy page
 * can fetch them in parallel with the listing lookup.
 */
export type BabelFeeConfig = {
  tank: TankUtxo;
  oracle: LiveOraclePrice;
  /** Lovelace to extract from the tank (default ~500_000 = 0.5 ADA). */
  adaUsedLovelace: bigint;
  /** Lovelace on the payment-to-tankOwner output (~1.2 ADA min-utxo). */
  paymentMinLovelace: bigint;
  parameters: UTxO;
  oracleDataUtxo: UTxO;
  oracleRefScriptUtxo: UTxO;
  tankRefScriptUtxo: UTxO;
};

export type MarketBuyInput = {
  network: Network;
  /** Bech32 jar address (manifest). */
  jarAddress: string;
  /** Hex script hash of jar (manifest). */
  jarScriptHashHex: string;
  /** Hex pkh of jar admin (manifest). Used to compile the jar validator. */
  adminPkhHex: string;
  /** Listing being bought. */
  listingUtxo: UTxO;
  /** Decoded MarketDatum of the listing — caller-side decode so we don't
   *  redo the work here. */
  listing: DecodedMarketDatum;
  /** Seller's bech32 address (caller decodes from `listing.sellerAddressRaw`). */
  sellerBech32Address: string;
  /** Jar UTxO the fee will be deposited to. */
  jarUtxo: UTxO;
  /** Bech32 destination for the listed asset(s) — typically the connected wallet. */
  buyerBech32Address: string;
  /** Optional FluidTokens babel-fee subsidy. Off by default. */
  babelFee?: BabelFeeConfig;
};

export type MarketBuyResult = { txHash: string };

/**
 * Safety buffer added on top of the measured tx fee when rebuilding the
 * babel tx for the second pass.
 *
 * <p>Set to {@code 0n} so {@code ada_used == measuredFee} exactly. The
 * downside: iter2's HOSKY varint encoding can shift by 1-3 bytes from
 * iter1 if the amount magnitude crossed a varint boundary, which can
 * push iter2's actual fee ~50-200 lovelace above the measurement. In
 * that edge case the buyer's wallet absorbs the difference (well under
 * one cent today). The upside: buyers don't over-pay HOSKY for a tank
 * subsidy they never used, matching the "0-ADA buy" property the user
 * requested.
 *
 * <p>If we start seeing iter2 evaluate failures from the size shift, a
 * third pass — measure fee on iter2, rebuild a final time if it still
 * shifts — would converge with no over-payment. Two passes ship now;
 * three-pass is a follow-up if needed.
 */
const BABEL_FEE_SAFETY_BUFFER_LOVELACE = 0n;

export async function submitMarketBuy(
  client: EvolutionClient,
  input: MarketBuyInput,
): Promise<MarketBuyResult> {
  // No babel-fee: single build, sign, submit. Standard path.
  if (!input.babelFee) {
    const built = await buildMarketBuyTx(client, input, null);
    const signed = await built.sign();
    return { txHash: txHashHex(await signed.submit()) };
  }

  // Babel-fee: two-pass iterative ada_used so the tank covers the
  // ACTUAL tx fee rather than a hardcoded guess.
  //
  // Pass 1: build with the caller-supplied placeholder (~0.68 ADA today).
  //         Read estimateFee() off the built result — that's the real
  //         fee for THIS tx shape, including Plutus eval + ref-script
  //         cost + linear fee on tx size with fake witnesses.
  // Pass 2: rebuild with ada_used = realFee + safety buffer. This shifts
  //         the HOSKY amount + the continuing-tank lovelace by exactly
  //         the right amount so the buyer nets ~0 ADA.
  //
  // If the placeholder already covered the fee with margin, pass 2 still
  // runs to align HOSKY paid with ADA used (otherwise the buyer
  // over-pays HOSKY for a tank subsidy they don't need).
  const initial = await buildMarketBuyTx(client, input, input.babelFee.adaUsedLovelace);
  const measuredFee = await initial.estimateFee();
  const targetAdaUsed = measuredFee + BABEL_FEE_SAFETY_BUFFER_LOVELACE;
  const willRebuild = targetAdaUsed !== input.babelFee.adaUsedLovelace;
  console.info(
    `[babel-fee] pass 1 built (adaUsed=${input.babelFee.adaUsedLovelace}, measuredFee=${measuredFee}); ` +
      `pass 2 ${willRebuild ? `rebuild (adaUsed=${targetAdaUsed})` : "skipped — reusing pass 1"}`,
  );
  const finalBuilt = willRebuild
    ? await buildMarketBuyTx(client, input, targetAdaUsed)
    : initial;
  const signed = await finalBuilt.sign();
  return { txHash: txHashHex(await signed.submit()) };
}

/**
 * Build (but do not sign) the marketplace Buy tx. Used by both the
 * single-build (no-babel) path and the two-pass babel-fee path.
 *
 * <p>{@code adaUsedOverride} replaces {@code input.babelFee.adaUsedLovelace}
 * when set. {@code null} = use the caller-supplied value (or no-babel build).
 */
async function buildMarketBuyTx(
  client: EvolutionClient,
  input: MarketBuyInput,
  adaUsedOverride: bigint | null,
) {
  const babelFee = input.babelFee
    ? {
        ...input.babelFee,
        adaUsedLovelace: adaUsedOverride ?? input.babelFee.adaUsedLovelace,
      }
    : undefined;
  const mp = await applyMarketplaceScript(input.network, input.jarScriptHashHex);
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Sanity: the jar UTxO must sit at the parameterised jar address.
  if (input.jarUtxo.address !== jar.address) {
    throw new Error(
      `jarUtxo address ${input.jarUtxo.address} != derived jar address ${jar.address}`,
    );
  }

  // ----- Fee math (mirrors validator) -----
  const priceQty = input.listing.priceQty;
  const expectedFee = (priceQty * 2n + 99n) / 100n;
  const sellerAmount = priceQty - expectedFee;

  // ----- Input-index resolution -----
  // The jar INPUT index depends on the final canonical (tx_hash,
  // output_index) sort of ALL inputs — which isn't known until coin
  // selection has added funding UTxOs. Rather than pin the whole wallet
  // to force a deterministic order, we defer the Buy redeemer: Evolution
  // resolves the jar's final index after selection (see the batch-mode
  // redeemer on the listing collectFrom below). OUTPUT indices, by
  // contrast, are stable — Evolution appends change at the tail and never
  // reorders authored outputs — so they're computed here directly.

  // Outputs are emitted in the order we call payToAddress (Evolution
  // doesn't reorder authored outputs; change goes at the tail).
  //   Without babel-fee:
  //     0: seller payout
  //     1: jar continuing
  //     2: buyer NFT
  //   With babel-fee (tank validator demands outputs[0..1]):
  //     0: continuing tank
  //     1: payment to tankOwner
  //     2: seller payout                (shifted +2)
  //     3: jar continuing               (shifted +2)
  //     4: buyer NFT                    (shifted +2)
  const babelOutputOffset = babelFee ? 2 : 0;
  const sellerOutputIndex = 0 + babelOutputOffset;
  const jarOutputIndex = 1 + babelOutputOffset;

  // ----- Anti-double-sat tag for the seller output -----
  const ownTagHex = computeOutputTag(
    input.listingUtxo.txHash,
    input.listingUtxo.outputIndex,
  );
  const sellerTagDatum: Data.Data = Data.bytearray(ownTagHex);

  // ----- Seller output value: price-token (less fee) + bond -----
  const priceUnit = (input.listing.pricePolicyHex + input.listing.priceNameHex).toLowerCase();
  const sellerAssets: Record<string, bigint> = {
    lovelace: input.listing.accompanyingLovelace,
  };
  if (priceUnit === "" || priceUnit === "0000000000000000000000000000000000000000000000000000000000000000") {
    // No-op — ADA-priced listings have empty policy + name; the price IS
    // lovelace. Already accounted for in `accompanyingLovelace` below.
  }
  if (input.listing.pricePolicyHex.length === 0 && input.listing.priceNameHex.length === 0) {
    // ADA-priced: roll seller_amount into lovelace, leave non-ADA side empty.
    sellerAssets.lovelace = (sellerAssets.lovelace ?? 0n) + sellerAmount;
  } else {
    if (sellerAmount > 0n) {
      sellerAssets[priceUnit] = sellerAmount;
    }
  }

  // ----- Jar continuing output value: jar_in + Σfee -----
  // For a single-listing buy, the per-token sum is just `expectedFee` on
  // the (price_policy, price_name) pair.
  const jarInAssets = { ...input.jarUtxo.assets };
  const jarOutAssets: Record<string, bigint> = { ...jarInAssets };
  if (input.listing.pricePolicyHex.length === 0 && input.listing.priceNameHex.length === 0) {
    jarOutAssets.lovelace = (jarOutAssets.lovelace ?? 0n) + expectedFee;
  } else {
    jarOutAssets[priceUnit] = (jarOutAssets[priceUnit] ?? 0n) + expectedFee;
  }

  // ----- Jar continuing datum: JarDatum { update_ref = compute_output_tag(jar.outRef) } -----
  const jarTagHex = computeOutputTag(
    input.jarUtxo.txHash,
    input.jarUtxo.outputIndex,
  );
  const jarOutDatum: Data.Data = Data.constr(0n, [Data.bytearray(jarTagHex)]);

  // ----- Redeemers -----
  // Buy: [jar_input_index, jar_output_index, seller_output_index]. The
  // input index is filled in by the deferred (batch) redeemer once coin
  // selection settles the final input order; output indices are stable.
  const buildBuyRedeemer = (jarInputIndex: number): Data.Data =>
    Data.constr(0n, [
      Data.int(BigInt(jarInputIndex)),
      Data.int(BigInt(jarOutputIndex)),
      Data.int(BigInt(sellerOutputIndex)),
    ]);

  // Jar Deposit redeemer: {fee_token_policy, fee_token_name, qty, output_index}.
  const depositRedeemer: Data.Data = Data.constr(0n, [
    Data.bytearray(input.listing.pricePolicyHex.toLowerCase()),
    Data.bytearray(input.listing.priceNameHex.toLowerCase()),
    Data.int(expectedFee),
    Data.int(BigInt(jarOutputIndex)),
  ]);

  // ----- Identify the listed asset (the value the listing carries
  // minus the bond lovelace). -----
  const listedAssets: Record<string, bigint> = {};
  for (const [unit, qty] of Object.entries(input.listingUtxo.assets)) {
    if (unit === "lovelace") continue;
    if (qty > 0n) listedAssets[unit] = qty;
  }
  if (Object.keys(listedAssets).length === 0) {
    throw new Error("listing has no non-ADA assets to deliver");
  }

  // ----- Build -----
  let txBuilder = client
    .newTx()
    .collectFrom({
      inputs: [input.listingUtxo._evolution],
      // Batch mode: the visibility set ([jar]) is decoupled from the input
      // this redeemer is attached to (the listing). Evolution resolves the
      // jar's final sorted index after coin selection and hands it here.
      redeemer: {
        inputs: [input.jarUtxo._evolution],
        all: (indexed) => buildBuyRedeemer(indexed[0].index),
      },
    })
    .attachScript({ script: mp.validator })
    .collectFrom({
      inputs: [input.jarUtxo._evolution],
      redeemer: depositRedeemer,
    })
    .attachScript({ script: jar.validator });

  // Babel-fee leg: tank input (with ConsumeOracle redeemer) + 4 ref
  // inputs + withdraw-zero from the oracle stake address carrying the
  // signed OraclePriceFeed payload. Outputs[0..1] are reserved for the
  // tank's continuing + payment outputs (added below).
  if (babelFee) {
    const bf = babelFee;
    const payingTokenIndex = tankAcceptsToken(
      bf.tank.datum,
      input.listing.pricePolicyHex,
      input.listing.priceNameHex,
    );
    if (payingTokenIndex < 0) {
      throw new Error(
        "babel tank does not accept the listing's paying token",
      );
    }
    const refInputs = canonicalRefSort([
      bf.parameters,
      bf.oracleDataUtxo,
      bf.oracleRefScriptUtxo,
      bf.tankRefScriptUtxo,
    ]);
    // oracleIndex/paramsIndex are REFERENCE-input positions — coin selection
    // never touches ref inputs, so these are stable and computed directly.
    //
    // inputTankIndex is NOT the absolute tx.inputs position — it's the index
    // within the TANK-filtered inputs. We spend exactly one tank, so it is
    // always 0, regardless of where the tank lands in the canonical sort.
    // Empirically confirmed against mainnet consume tx 2a07cb2d…: the
    // ConsumeOracle redeemer carried inputTankIndex=0 while the ledger placed
    // the tank at absolute input index 3. (An earlier attempt to "fix" this
    // with the tank's Self index broke every babel buy — do NOT reintroduce.)
    const oracleIndex = refIndex(refInputs, bf.oracleDataUtxo);
    const paramsIndex = refIndex(refInputs, bf.parameters);
    const tankSpendRedeemer = buildConsumeOracleRedeemer({
      payingTokenIndex,
      inputTankIndex: 0,
      receivers: 0,
      oracleIndex,
      paramsIndex,
      whitelistIndex: 0,
    });
    const oracleWithdrawRedeemer = buildOracleRedeemer(bf.oracle);
    const oracleStake = stakeCredentialFromRewardAddress(
      bf.oracle.oracleWithdrawAddress,
    );
    txBuilder = txBuilder
      .collectFrom({
        inputs: [bf.tank.utxo._evolution],
        redeemer: tankSpendRedeemer,
      })
      .readFrom({ referenceInputs: refInputs.map((r) => r._evolution) })
      .withdraw({
        stakeCredential: oracleStake,
        amount: 0n,
        redeemer: oracleWithdrawRedeemer,
      });
  }

  // No wallet inputs are pinned here: coin selection during .build() pulls
  // exactly the buyer UTxOs needed to cover the price token + fee + min-UTxO
  // and returns the rest as change. The jar_input_index / inputTankIndex
  // redeemers resolve against whatever inputs selection settles on.

  // Babel-fee outputs (when set) — MUST be the first two outputs per
  // the tank validator's positional addressing.
  if (babelFee) {
    const bf = babelFee;
    if (!bf.tank.utxo.datum) {
      throw new Error("babel tank UTxO has no inline datum — not a real tank");
    }
    const tankInputLovelace = bf.tank.utxo.assets.lovelace ?? 0n;
    const continuingTankLovelace =
      tankInputLovelace - bf.adaUsedLovelace - bf.paymentMinLovelace;
    if (continuingTankLovelace < 0n) {
      throw new Error(
        `babel tank under-funded: ${tankInputLovelace} ADA in, want ${bf.adaUsedLovelace + bf.paymentMinLovelace} (ada_used + payment min)`,
      );
    }
    const networkId = getNetworkName() === "mainnet" ? 1 : 0;
    const payingToken = bf.tank.datum.allowedTokens.find(
      (t) =>
        t.policyId.toLowerCase() === input.listing.pricePolicyHex.toLowerCase() &&
        t.assetName.toLowerCase() === input.listing.priceNameHex.toLowerCase(),
    );
    if (!payingToken) {
      throw new Error("babel: paying token not in tank datum (post-discovery)");
    }
    const tokenPayment = requiredTokenPayment({
      adaUsed: bf.adaUsedLovelace,
      priceInLovelaces: bf.oracle.priceInLovelaces,
      denominator: bf.oracle.denominator,
      amount: payingToken.amount,
      divider: payingToken.divider,
    });
    const tankOwnerBech32 = onChainAddressToBech32(bf.tank.datum.tankOwner, networkId);
    const paymentUnit = (input.listing.pricePolicyHex + input.listing.priceNameHex).toLowerCase();
    txBuilder = txBuilder
      // Output 0: continuing tank (same address + datum, reduced ADA).
      .payToAddress({
        address: Address.fromBech32(bf.tank.utxo.address),
        assets: toAssets({ lovelace: continuingTankLovelace }),
        datum: inlineDatum(Data.fromCBORHex(bf.tank.utxo.datum)),
      })
      // Output 1: payment to tankOwner (paying-token + min-utxo lovelace).
      .payToAddress({
        address: Address.fromBech32(tankOwnerBech32),
        assets: toAssets({
          lovelace: bf.paymentMinLovelace,
          [paymentUnit]: tokenPayment,
        }),
      });
  }

  txBuilder = txBuilder
    // (Now at outputs[0+offset]: seller payout (tagged datum).
    .payToAddress({
      address: toAddress(input.sellerBech32Address),
      assets: toAssets(sellerAssets),
      datum: inlineDatum(sellerTagDatum),
    })
    // outputs[1+offset]: jar continuing.
    .payToAddress({
      address: toAddress(input.jarAddress),
      assets: toAssets(jarOutAssets),
      datum: inlineDatum(jarOutDatum),
    })
    // outputs[2+offset]: buyer receives the listed asset(s).
    .payToAddress({
      address: toAddress(input.buyerBech32Address),
      assets: toAssets({ lovelace: 0n, ...listedAssets }),
      autoMinUtxo: true,
    });

  // Babel-fee tx validity range: Date.now() ± 100s, second-aligned —
  // pinned from FluidTokens' reference implementation. Required to
  // satisfy the oracle's inclusive validity check without falling foul
  // of Evolution's ms→slot rounding.
  if (babelFee) {
    const nowMs = BigInt(Date.now());
    const rawLower = nowMs - 100_000n;
    const rawUpper = nowMs + 100_000n;
    const validFromMs = rawLower - (rawLower % 1000n);
    const validToMs = rawUpper - (rawUpper % 1000n);
    if (
      validFromMs < babelFee.oracle.validFrom ||
      validToMs > babelFee.oracle.validTo
    ) {
      throw new Error(
        "babel oracle feed has expired between fetch and submit — refresh the buy page",
      );
    }
    txBuilder = txBuilder.setValidity({ from: validFromMs, to: validToMs });
  }

  // Token-aware coin selection: HOSKY-priced listings otherwise drag in
  // every ADA-heavy UTxO before the SDK's largest-first selector reaches the
  // token (see coinSelection.ts). This keeps the input set minimal.
  return txBuilder.build({ coinSelection: tokenAwareLargestFirst });
}

function canonicalRefSort(refs: UTxO[]): UTxO[] {
  return [...refs].sort(compareOutRefs);
}

function refIndex(refs: UTxO[], target: UTxO): number {
  const i = refs.findIndex((r) => sameRef(r, target));
  if (i < 0) throw new Error("babel: ref input not found in canonical sort");
  return i;
}

function compareOutRefs(a: UTxO, b: UTxO): number {
  if (a.txHash < b.txHash) return -1;
  if (a.txHash > b.txHash) return 1;
  return a.outputIndex - b.outputIndex;
}

function sameRef(a: UTxO, b: UTxO): boolean {
  return a.txHash === b.txHash && a.outputIndex === b.outputIndex;
}
