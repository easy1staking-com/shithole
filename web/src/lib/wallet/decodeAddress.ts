/**
 * Bridge between CIP-30 hex addresses and Evolution SDK / bech32 strings.
 *
 * CIP-30 returns Shelley address bytes as hex; we need bech32 for the BE
 * + Tx builder and the 28-byte payment-key hash for the on-chain admin_pkh.
 *
 * Evolution SDK's `getAddressDetails` accepts either form, so we just feed
 * it the hex. The import is dynamic so the heavy CML/WASM dep only loads
 * when the user actually clicks "connect wallet" — keeps the Next 16
 * prerender step from trying to resolve `.wasm` files at build time.
 */

export type DecodedAddress = {
  bech32: string;
  paymentKeyHashHex: string;
  /** "verification_key" or "script". For an admin wallet, expect verification_key. */
  paymentCredentialType: "verification_key" | "script";
};

export async function decodeCip30Address(hex: string): Promise<DecodedAddress> {
  const { getAddressDetails } = await import("@lucid-evolution/lucid");
  const details = getAddressDetails(hex);
  const bech32 = details.address.bech32;
  const pc = details.paymentCredential;
  if (!pc) {
    throw new Error("address has no payment credential (reward address?)");
  }
  const paymentCredentialType =
    pc.type === "Key" ? "verification_key" : "script";
  return {
    bech32,
    paymentKeyHashHex: pc.hash,
    paymentCredentialType,
  };
}
