/**
 * Build + submit a "collect non-ADA, leave 5 ADA" tx. Spends ONE jar UTxO
 * with the Sweep redeemer, recreates the jar at index 0 carrying exactly
 * {@code LEAVE_BEHIND_LOVELACE} (default 5,000,000) and ZERO non-ADA
 * tokens; routes everything else (extra ADA + every non-ADA asset) to the
 * admin's wallet.
 *
 * <p>Requires the admin signature (Sweep handler enforces it). Recreated
 * jar carries a sentinel JarDatum — the next Deposit re-tags it.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { applyJarScript } from "./marketScripts";
import { buildJarDatum } from "@/lib/jar/datum";
import type { Network } from "./swap";
import {
  inlineDatum,
  toAddress,
  toAssets,
  toKeyHash,
  txHashHex,
} from "./txAdapters";
import type { UTxO } from "./utxo";

export type JarCollectInput = {
  network: Network;
  adminPkhHex: string;
  consumed: UTxO;
  /** Bech32 destination for the swept assets — typically the connected admin. */
  payoutBech32Address: string;
};

export const LEAVE_BEHIND_LOVELACE = 5_000_000n;

/**
 * Conservative min-UTxO floor for an output bagging both lovelace AND CNTs.
 * Real min-UTxO depends on the asset bag (a few NFTs + a fee token usually
 * needs ~1.4-1.6 ADA); 2 ADA covers typical Hosky-flavoured multi-token
 * payouts with headroom. If the actual min is lower Evolution still accepts;
 * we never undershoot.
 *
 * <p>Only used when the payout output carries at least one non-ADA asset.
 * ADA-only excess is routed via the wallet's change output instead, so the
 * Evolution balancer handles min-UTxO sizing for us.
 */
export const MIN_TOKEN_PAYOUT_LOVELACE = 2_000_000n;

export async function submitJarCollect(
  client: EvolutionClient,
  input: JarCollectInput,
): Promise<{ txHash: string }> {
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Split the input value into "jar continuing" (5 ADA, no non-ADA) and
  // "admin payout" (everything else).
  const inAssets = input.consumed.assets;
  const totalLovelace = inAssets.lovelace ?? 0n;
  if (totalLovelace < LEAVE_BEHIND_LOVELACE) {
    throw new Error(
      `jar has only ${totalLovelace} lovelace, need >= ${LEAVE_BEHIND_LOVELACE} to leave behind`,
    );
  }

  const tokens: Record<string, bigint> = {};
  for (const [unit, qty] of Object.entries(inAssets)) {
    if (unit === "lovelace") continue;
    if (qty > 0n) tokens[unit] = qty;
  }
  const extraLovelace = totalLovelace - LEAVE_BEHIND_LOVELACE;
  const hasTokens = Object.keys(tokens).length > 0;

  // Sweep { output_index: 0 } — continuing jar at index 0.
  const sweepRedeemer: Data.Data = Data.constr(1n, [Data.int(0n)]);

  let builder = client
    .newTx()
    .attachScript({ script: jar.validator })
    .addSigner({ keyHash: toKeyHash(input.adminPkhHex) })
    .collectFrom({
      inputs: [input.consumed._evolution],
      redeemer: sweepRedeemer,
    })
    .payToAddress({
      address: toAddress(jar.address),
      assets: toAssets({ lovelace: LEAVE_BEHIND_LOVELACE }),
      datum: inlineDatum(buildJarDatum()),
    });

  // Token payout output is only emitted when there are tokens to ship —
  // otherwise the excess lovelace flows back as change to the connected
  // wallet (Evolution balancer auto-sizes that against min-UTxO).
  if (hasTokens) {
    // Floor the payout's ADA at the token-output min-UTxO. When the jar's
    // own surplus (extraLovelace) is below that floor — e.g. a jar sitting
    // at the 5 ADA leave-behind floor, so extraLovelace = 0 — the Evolution
    // balancer funds the shortfall from the connected wallet's own UTxOs
    // during build. (Previously we hard-pinned the payout lovelace to
    // extraLovelace and threw when it was below the floor, which made such
    // jars impossible to sweep even though the wallet could cover the
    // min-UTxO — the "not enough excess ADA to sweep tokens" error.)
    const payoutLovelace =
      extraLovelace > MIN_TOKEN_PAYOUT_LOVELACE
        ? extraLovelace
        : MIN_TOKEN_PAYOUT_LOVELACE;
    builder = builder.payToAddress({
      address: toAddress(input.payoutBech32Address),
      assets: toAssets({ lovelace: payoutLovelace, ...tokens }),
    });
  }

  const built = await builder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}

/* -------------------------------------------------------------------------- */
/* Bulk collect — N jars, N continuing jars, ONE combined payout              */
/* -------------------------------------------------------------------------- */

export type JarBulkCollectInput = {
  network: Network;
  adminPkhHex: string;
  /**
   * Jar UTxOs to sweep in one tx. Each one is recreated at the jar
   * address with exactly {@link LEAVE_BEHIND_LOVELACE} ADA + sentinel
   * datum; everything else (extra ADA + non-ADA assets) is aggregated
   * into a single payout to {@code payoutBech32Address}.
   */
  consumed: UTxO[];
  /** Bech32 destination for the swept profit — typically the connected admin. */
  payoutBech32Address: string;
};

/**
 * Spend N jar UTxOs in one tx, recreate N fresh continuing jars (each at
 * {@link LEAVE_BEHIND_LOVELACE} + sentinel datum), and route the combined
 * surplus (excess ADA + every CNT) to a single admin output.
 *
 * <p>Each input's Sweep redeemer carries its OWN
 * {@code output_index} pointing at its dedicated continuing-jar output:
 * input 0 → output 0, input 1 → output 1, …, input N-1 → output N-1.
 * The combined admin payout sits at output N. The validator runs once
 * per script input; each instance verifies the output at its declared
 * index is a valid continuing jar.
 *
 * <p>Requires the admin signature. Fails fast if any input lacks the
 * 5 ADA floor (the continuing jar must be fundable from its source
 * input — we don't try to cross-subsidise between inputs since that
 * would risk the validator's per-input integrity check).
 */
export async function submitJarBulkCollect(
  client: EvolutionClient,
  input: JarBulkCollectInput,
): Promise<{ txHash: string }> {
  if (input.consumed.length === 0) {
    throw new Error("bulk collect requires at least one jar");
  }
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Validate each input independently — every continuing jar must be
  // funded out of its OWN source UTxO so the per-input validator check
  // can verify the leave-behind amount without cross-input bookkeeping.
  let totalLovelace = 0n;
  const totalNonAda: Record<string, bigint> = {};
  for (const u of input.consumed) {
    const lov = u.assets.lovelace ?? 0n;
    if (lov < LEAVE_BEHIND_LOVELACE) {
      throw new Error(
        `jar ${u.txHash}#${u.outputIndex} has only ${lov} lovelace, need >= ${LEAVE_BEHIND_LOVELACE}`,
      );
    }
    totalLovelace += lov;
    for (const [unit, qty] of Object.entries(u.assets)) {
      if (unit === "lovelace") continue;
      if (qty > 0n) totalNonAda[unit] = (totalNonAda[unit] ?? 0n) + qty;
    }
  }

  // Admin payout = totalLovelace − N × LEAVE_BEHIND + every non-ADA asset.
  const n = BigInt(input.consumed.length);
  const extraLovelace = totalLovelace - LEAVE_BEHIND_LOVELACE * n;
  const hasTokens = Object.keys(totalNonAda).length > 0;

  let builder = client
    .newTx()
    .attachScript({ script: jar.validator })
    .addSigner({ keyHash: toKeyHash(input.adminPkhHex) });

  // Each input gets its own Sweep redeemer pointing at its dedicated
  // continuing-jar output. Index assignments mirror the order in which
  // we'll emit the payToAddress calls below.
  for (let i = 0; i < input.consumed.length; i++) {
    const u = input.consumed[i];
    const sweepRedeemer: Data.Data = Data.constr(1n, [Data.int(BigInt(i))]);
    builder = builder.collectFrom({
      inputs: [u._evolution],
      redeemer: sweepRedeemer,
    });
  }

  // Outputs 0..N-1: continuing jars, each exactly 5 ADA + sentinel.
  for (let i = 0; i < input.consumed.length; i++) {
    builder = builder.payToAddress({
      address: toAddress(jar.address),
      assets: toAssets({ lovelace: LEAVE_BEHIND_LOVELACE }),
      datum: inlineDatum(buildJarDatum()),
    });
  }

  // Token payout: only when there's something non-ADA to ship. Floor its
  // ADA at the token-output min-UTxO; when the combined surplus
  // (extraLovelace) is below that floor — e.g. every selected jar sitting
  // at the 5 ADA floor, so extraLovelace = 0 — the Evolution balancer funds
  // the shortfall from the connected wallet during build, instead of the
  // old hard-throw that made those jars unsweepable.
  if (hasTokens) {
    const payoutLovelace =
      extraLovelace > MIN_TOKEN_PAYOUT_LOVELACE
        ? extraLovelace
        : MIN_TOKEN_PAYOUT_LOVELACE;
    builder = builder.payToAddress({
      address: toAddress(input.payoutBech32Address),
      assets: toAssets({ lovelace: payoutLovelace, ...totalNonAda }),
    });
  }

  const built = await builder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
