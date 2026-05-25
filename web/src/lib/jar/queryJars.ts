/**
 * Enumerate jar UTxOs at the connected admin's parameterised jar address.
 * Each UTxO is shape-checked for a JarDatum-decodable inline datum; UTxOs
 * with garbage or missing datums are treated as "junk left at jar address"
 * and surfaced separately (rare; jar's Sweep redeemer can still rescue them
 * since we made it permissive — but a future "Rescue" extension would be
 * cleaner).
 */

import { Address, Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "@/lib/tx/evolutionClient";
import { adaptUtxos, type UTxO } from "@/lib/tx/utxo";

export type Jar = {
  utxo: UTxO;
  /** Decoded update_ref hex from the JarDatum (sentinel "00" on freshly-seeded). */
  updateRefHex: string;
};

export async function fetchJars(
  client: EvolutionClient,
  jarBech32Address: string,
): Promise<{ jars: Jar[]; junk: UTxO[] }> {
  const addr = Address.fromBech32(jarBech32Address);
  const utxos = adaptUtxos(await client.getUtxos(addr));
  const jars: Jar[] = [];
  const junk: UTxO[] = [];
  for (const u of utxos) {
    if (!u.datum) {
      junk.push(u);
      continue;
    }
    try {
      const root = Data.fromCBORHex(u.datum) as unknown as {
        _tag?: string;
        index?: bigint;
        fields?: unknown[];
      };
      if (root._tag !== "Constr" || root.index !== 0n) {
        junk.push(u);
        continue;
      }
      const fields = root.fields ?? [];
      const first = fields[0] as { _tag?: string; bytes?: string } | undefined;
      if (first?._tag !== "ByteArray") {
        junk.push(u);
        continue;
      }
      jars.push({ utxo: u, updateRefHex: first.bytes ?? "" });
    } catch {
      junk.push(u);
    }
  }
  return { jars, junk };
}
