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
      const root = Data.fromCBORHex(u.datum);
      // Runtime shape per Evolution SDK: Constr is an object with bigint
      // `index` + Data[] `fields`; byte fields are raw Uint8Array.
      if (!Data.isConstr(root)) {
        junk.push(u);
        continue;
      }
      const c = root as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
      if (c.index !== 0n) {
        junk.push(u);
        continue;
      }
      const first = c.fields[0];
      if (!(first instanceof Uint8Array)) {
        junk.push(u);
        continue;
      }
      let hex = "";
      for (let i = 0; i < first.length; i++) {
        hex += first[i].toString(16).padStart(2, "0");
      }
      jars.push({ utxo: u, updateRefHex: hex });
    } catch {
      junk.push(u);
    }
  }
  return { jars, junk };
}
