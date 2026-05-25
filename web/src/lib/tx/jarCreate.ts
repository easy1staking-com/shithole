/**
 * Build + submit a "seed N new jars" tx. Pure pay-to-script — no
 * validator, no redeemer. Each output carries {@code lovelacePerJar} ADA
 * (default 5,000,000) + an inline {@link buildJarDatum} sentinel
 * ({@code update_ref = 0x00}). The first Deposit on a freshly-seeded jar
 * overwrites the sentinel with the correct compute_output_tag.
 */

import type { EvolutionClient } from "./evolutionClient";
import { applyJarScript } from "./marketScripts";
import { buildJarDatum } from "@/lib/jar/datum";
import type { Network } from "./swap";
import { inlineDatum, toAddress, toAssets, txHashHex } from "./txAdapters";

export type JarCreateInput = {
  network: Network;
  adminPkhHex: string;
  count: number;
  lovelacePerJar?: bigint;
};

export const DEFAULT_JAR_SEED_LOVELACE = 5_000_000n;

export async function submitJarCreate(
  client: EvolutionClient,
  input: JarCreateInput,
): Promise<{ txHash: string; jarAddress: string }> {
  if (!Number.isInteger(input.count) || input.count <= 0) {
    throw new Error("count must be a positive integer");
  }
  const seed = input.lovelacePerJar ?? DEFAULT_JAR_SEED_LOVELACE;
  if (seed < 1_500_000n) {
    throw new Error("lovelacePerJar must be >= 1_500_000 (Cardano min-UTxO floor)");
  }
  const jar = await applyJarScript(input.network, input.adminPkhHex);
  const datum = buildJarDatum();
  let builder = client.newTx();
  for (let i = 0; i < input.count; i++) {
    builder = builder.payToAddress({
      address: toAddress(jar.address),
      assets: toAssets({ lovelace: seed }),
      datum: inlineDatum(datum),
    });
  }
  const built = await builder.build();
  const signed = await built.sign();
  return {
    txHash: txHashHex(await signed.submit()),
    jarAddress: jar.address,
  };
}
