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

  const payout: Record<string, bigint> = {
    lovelace: totalLovelace - LEAVE_BEHIND_LOVELACE,
  };
  for (const [unit, qty] of Object.entries(inAssets)) {
    if (unit === "lovelace") continue;
    if (qty > 0n) payout[unit] = qty;
  }

  // Sweep { output_index: 0 } — continuing jar at index 0.
  const sweepRedeemer: Data.Data = Data.constr(1n, [Data.int(0n)]);

  const built = await client
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
    })
    .payToAddress({
      address: toAddress(input.payoutBech32Address),
      assets: toAssets(payout),
    })
    .build();

  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
