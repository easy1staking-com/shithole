/**
 * Bech32-decoding + credential helpers shared between
 * {@code tankConsume.ts} and the marketBuy babel-fee path.
 *
 * <p>Kept separate so the babel-fee additions to the marketplace tx
 * builder don't drag the whole {@code tankConsume.ts} module along.
 */

import { Credential as EvCredential } from "@evolution-sdk/evolution";

/**
 * Decode a Cardano-style stake-bech32 (e.g. {@code stake1u…} /
 * {@code stake_test1u…}) into an Evolution {@link EvCredential} suitable
 * for {@code .withdraw({stakeCredential, …})}.
 *
 * <p>FluidTokens' oracles use script credentials (the oracle script is
 * self-staked — its payment hash equals its stake hash). We assert
 * that here; key-credential reward addresses surface as a clear error.
 */
export function stakeCredentialFromRewardAddress(rewardBech32: string) {
  const decoded = decodeBech32(rewardBech32);
  if (decoded.length !== 29) {
    throw new Error(
      `reward address ${rewardBech32} decodes to ${decoded.length} bytes (expected 29 = header + 28)`,
    );
  }
  const header = decoded[0];
  const hash = decoded.slice(1);
  const isScript = (header & 0x0f) === 0x01 || (header & 0x0f) === 0x0f;
  if (!isScript) {
    throw new Error(
      `reward address ${rewardBech32} carries a key credential — FluidTokens oracles use script credentials`,
    );
  }
  return EvCredential.makeScriptHash(hash);
}

/* -------------------------------------------------------------------------- */
/* Minimal bech32 decoder — Cardano reward addresses (29 bytes payload)       */
/* -------------------------------------------------------------------------- */

/**
 * Decode a Cardano-style bech32 string (no length cap) into its raw
 * 5-bit payload converted back to 8-bit bytes. We carry our own
 * decoder so the FT module doesn't pull in a fat bech32 lib for one
 * call.
 */
function decodeBech32(s: string): Uint8Array {
  const lower = s.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1) throw new Error("bech32: separator not found");
  const dataPart = lower.slice(sep + 1, lower.length - 6); // last 6 = checksum
  const fiveBit: number[] = [];
  for (const c of dataPart) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) throw new Error(`bech32: invalid char ${c}`);
    fiveBit.push(v);
  }
  return convertBits(fiveBit, 5, 8, false);
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error("convertBits: invalid data");
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("convertBits: non-zero padding");
  }
  return new Uint8Array(out);
}
