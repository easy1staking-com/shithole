/**
 * Strip one CBOR byte-string wrapper from a hex-encoded applied script.
 *
 * <p>Aiken emits compiledCode + lucid/evolution's
 * {@code applyParamsToScript} returns DOUBLE-CBOR encoded bytes
 * ({@code 59 LL LL  59 LL LL  <inner uplc>}). Evolution's
 * {@code new PlutusV3({bytes})} constructor expects the SINGLE-CBOR
 * form (one wrapper stripped). Without this strip, the script hash
 * computed by {@code ScriptHash.fromScript} differs from what
 * lucid's {@code mintingPolicyToId} produced for the same applied
 * script, and the derived enterprise address diverges from what's
 * registered on the BE — breaking every existing preprod deployment.
 *
 * <p>Pinned down by the parity test
 * {@code parity.test.ts > Script-hash + bech32 address parity}.
 *
 * <p>For Aiken's compiledCode the outer wrapper is always 3 bytes
 * (major type 2 byte-string + uint16 length): `59 XX XX`. So 6 hex
 * chars get sliced. For scripts < 256 bytes the header is 2 bytes —
 * we don't ship validators that small.
 */
export function stripOneCborByteStringWrapper(doubleCborHex: string): string {
  if (doubleCborHex.length < 6) {
    throw new Error(
      `expected at least a 6-hex-char CBOR wrapper, got ${doubleCborHex.length} chars`,
    );
  }
  return doubleCborHex.slice(6);
}
