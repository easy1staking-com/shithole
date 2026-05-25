/**
 * Codec for the jar validator's `JarDatum` (mirrors
 * {@code contracts/validators/jar.ak::JarDatum}):
 *
 * <pre>Constr 0 [ByteArray update_ref]</pre>
 *
 * <p>The {@code update_ref} field is the anti-double-sat tag binding the
 * recreated jar to its consumed-input on the Deposit path. On the seed
 * (initial creation) any value is acceptable since the validator doesn't
 * run on outputs that aren't being spent later in the same tx. We default
 * to a single null byte ({@code 0x00}) — first Deposit overwrites with
 * {@code blake2b_256(serialise(out_ref))}.
 */

import { Data } from "@evolution-sdk/evolution";

const HEX = /^[0-9a-fA-F]*$/;

export const SENTINEL_UPDATE_REF_HEX = "00";

export function buildJarDatum(updateRefHex: string = SENTINEL_UPDATE_REF_HEX): Data.Data {
  if (!HEX.test(updateRefHex)) {
    throw new Error(`updateRefHex must be hex, got ${updateRefHex}`);
  }
  return Data.constr(0n, [Data.bytearray(updateRefHex.toLowerCase())]);
}
