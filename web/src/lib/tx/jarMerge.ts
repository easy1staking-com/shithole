/**
 * Build + submit a "merge N jars into one and sweep the profit" tx.
 * Spends every supplied jar UTxO with the Sweep redeemer
 * ({@code Constr 1 [output_index=0]}), recreates ONE jar at the script
 * address holding exactly {@code LEAVE_BEHIND_LOVELACE} (5 ADA) with a
 * sentinel JarDatum, and routes ALL excess (extra ADA + every non-ADA
 * asset) to the admin's wallet.
 *
 * <p>Mirrors {@code submitJarCollect}'s output shape but generalises the
 * input side to N. Common admin workflow: "I have a bunch of fee-laden
 * jars; collapse them, take the profit, leave one fresh operational jar."
 *
 * <p>Requires the admin signature (the jar's Sweep handler enforces
 * {@code signed_by(admin_pkh)}). The recreated jar carries the sentinel
 * datum ({@code update_ref = 0x00}); the next Deposit overwrites with
 * the correct compute_output_tag.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { applyJarScript } from "./marketScripts";
import { buildJarDatum } from "@/lib/jar/datum";
import {
  LEAVE_BEHIND_LOVELACE,
  MIN_TOKEN_PAYOUT_LOVELACE,
} from "./jarCollect";
import type { Network } from "./swap";
import {
  inlineDatum,
  toAddress,
  toAssets,
  toKeyHash,
  txHashHex,
} from "./txAdapters";
import type { UTxO } from "./utxo";

export type JarMergeInput = {
  network: Network;
  adminPkhHex: string;
  consumed: UTxO[];
  /** Bech32 destination for the swept profit — typically the connected admin. */
  payoutBech32Address: string;
};

export async function submitJarMerge(
  client: EvolutionClient,
  input: JarMergeInput,
): Promise<{ txHash: string }> {
  if (input.consumed.length < 2) {
    throw new Error("merge requires at least two jars");
  }
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Sum every input's value bag — needed to compute the admin payout
  // (everything except the 5 ADA we leave in the continuing jar).
  let totalLovelace = 0n;
  const totalNonAda: Record<string, bigint> = {};
  for (const u of input.consumed) {
    for (const [unit, qty] of Object.entries(u.assets)) {
      if (unit === "lovelace") {
        totalLovelace += qty;
      } else if (qty > 0n) {
        totalNonAda[unit] = (totalNonAda[unit] ?? 0n) + qty;
      }
    }
  }

  if (totalLovelace < LEAVE_BEHIND_LOVELACE) {
    throw new Error(
      `merged jars hold ${totalLovelace} lovelace, need >= ${LEAVE_BEHIND_LOVELACE} to leave behind`,
    );
  }

  const extraLovelace = totalLovelace - LEAVE_BEHIND_LOVELACE;
  const hasTokens = Object.keys(totalNonAda).length > 0;

  // Sweep redeemer = Constr 1 [output_index]. Every input points to the
  // SAME merged jar at index 0 — the validator runs once per input but
  // all instances see (and approve of) the same continuing output.
  const sweepRedeemer: Data.Data = Data.constr(1n, [Data.int(0n)]);

  let builder = client
    .newTx()
    .attachScript({ script: jar.validator })
    .addSigner({ keyHash: toKeyHash(input.adminPkhHex) });

  for (const u of input.consumed) {
    builder = builder.collectFrom({
      inputs: [u._evolution],
      redeemer: sweepRedeemer,
    });
  }

  // Output 0: continuing jar — exactly 5 ADA, no non-ADA, sentinel datum.
  builder = builder.payToAddress({
    address: toAddress(jar.address),
    assets: toAssets({ lovelace: LEAVE_BEHIND_LOVELACE }),
    datum: inlineDatum(buildJarDatum()),
  });

  // Token payout: only when there's something non-ADA to ship. Floor its
  // ADA at the token-output min-UTxO; when the merged surplus
  // (extraLovelace) is below that floor — e.g. merging two 5-ADA jars, so
  // extraLovelace = 0 — the Evolution balancer funds the shortfall from the
  // connected wallet during build, instead of the old hard-throw that made
  // those merges impossible.
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
