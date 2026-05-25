/**
 * Build + submit a "merge N jars into one" tx. Spends every supplied jar
 * UTxO with the Sweep redeemer ({@code Constr 1 [output_index=0]}),
 * recreates a single jar UTxO at index 0 carrying the summed value, with
 * a fresh sentinel JarDatum.
 *
 * <p>Requires the admin signature (the jar's Sweep handler enforces
 * {@code signed_by(admin_pkh)}). The validator is permissive on the
 * recreated datum so we can use a sentinel ({@code update_ref = 0x00})
 * — the next Deposit overwrites with the correct tag.
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

export type JarMergeInput = {
  network: Network;
  adminPkhHex: string;
  consumed: UTxO[];
};

export async function submitJarMerge(
  client: EvolutionClient,
  input: JarMergeInput,
): Promise<{ txHash: string }> {
  if (input.consumed.length < 2) {
    throw new Error("merge requires at least two jars");
  }
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Sum all jar inputs into one value bag.
  const merged: Record<string, bigint> = {};
  for (const u of input.consumed) {
    for (const [unit, qty] of Object.entries(u.assets)) {
      merged[unit] = (merged[unit] ?? 0n) + qty;
    }
  }

  // Sweep redeemer = Constr 1 [output_index]. Every input points to the
  // merged jar at index 0.
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

  // Output 0: merged jar — same address, summed value, sentinel datum.
  builder = builder.payToAddress({
    address: toAddress(jar.address),
    assets: toAssets(merged),
    datum: inlineDatum(buildJarDatum()),
  });

  const built = await builder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
