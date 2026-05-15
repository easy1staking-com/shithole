/**
 * Bridge between CIP-30 hex addresses and bech32 strings.
 *
 * <p>CIP-30 returns Shelley address bytes as hex; we need bech32 for
 * the BE + tx builder + the 28-byte payment-key hash for the on-chain
 * {@code admin_pkh}.
 *
 * <p>Migrated from lucid-evolution's {@code getAddressDetails} to
 * Evolution SDK's {@code Address.fromHex} + {@code Address.toBech32}
 * + the typed credential accessors. The import is dynamic so SDK
 * bundling stays out of the wallet-detection module.
 */

export type DecodedAddress = {
  bech32: string;
  paymentKeyHashHex: string;
  /** "verification_key" or "script". For an admin wallet, expect verification_key. */
  paymentCredentialType: "verification_key" | "script";
};

export async function decodeCip30Address(hex: string): Promise<DecodedAddress> {
  const E = await import("@evolution-sdk/evolution");
  const addr = E.Address.fromHex(hex);
  const bech32 = E.Address.toBech32(addr);
  const a = addr as unknown as {
    paymentCredential?: { _tag: "KeyHash" | "ScriptHash"; hash: Uint8Array };
  };
  if (!a.paymentCredential) {
    throw new Error("address has no payment credential (reward address?)");
  }
  const pc = a.paymentCredential;
  return {
    bech32,
    paymentKeyHashHex: bytesToHex(pc.hash),
    paymentCredentialType:
      pc._tag === "KeyHash" ? "verification_key" : "script",
  };
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
