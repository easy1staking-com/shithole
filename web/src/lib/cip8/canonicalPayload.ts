/**
 * Canonical CIP-8 payload for `POST /api/configs`.
 *
 * MUST produce byte-identical output to the Java
 * {@code Cip8SignatureVerifier.buildCanonicalPayload(...)} helper at
 * `api/src/main/java/com/easy1staking/shithole/service/Cip8SignatureVerifier.java`.
 *
 * Format (no trailing newline, `\n` between fields, `""` for null/missing
 * optional theme fields, decimal integer for display_order):
 *
 *   shithole/register-config
 *   <config_nft_policy>            (lowercase hex)
 *   <slug>
 *   <display_name>
 *   <display_order>                (decimal integer)
 *   <theme.background_url|"">
 *   <theme.accent_color|"">
 *   <theme.mascot_image_url|"">
 *
 * Encoded as UTF-8 bytes — the BE compares the raw bytes against the
 * `coseSign1.payload()` it parses out of the FE-supplied COSE_Sign1.
 */

export type CanonicalPayloadInput = {
  configNftPolicy: string;
  slug: string;
  displayName: string;
  /** Optional. Defaults to 0 to match the Java integer-default. */
  displayOrder?: number | null;
  theme?: {
    backgroundUrl?: string | null;
    accentColor?: string | null;
    mascotImageUrl?: string | null;
  };
};

/**
 * Build the canonical payload string (NOT UTF-8 bytes).
 *
 * The BE's `buildCanonicalPayload` also returns the UTF-8 bytes; we keep
 * the string form exposed for debugging / display purposes (the form
 * shows it to the admin before signing) and bytes-encode separately.
 */
export function buildCanonicalPayloadString(input: CanonicalPayloadInput): string {
  const policy = (input.configNftPolicy ?? "").toLowerCase();
  const slug = input.slug ?? "";
  const displayName = input.displayName ?? "";
  const displayOrder = input.displayOrder ?? 0;
  const bg = input.theme?.backgroundUrl ?? "";
  const accent = input.theme?.accentColor ?? "";
  const mascot = input.theme?.mascotImageUrl ?? "";

  // No trailing newline — the last line is the mascot URL or "".
  return (
    "shithole/register-config\n" +
    policy +
    "\n" +
    slug +
    "\n" +
    displayName +
    "\n" +
    String(displayOrder) +
    "\n" +
    bg +
    "\n" +
    accent +
    "\n" +
    mascot
  );
}

/** UTF-8 bytes of the canonical payload. */
export function buildCanonicalPayloadBytes(input: CanonicalPayloadInput): Uint8Array {
  return new TextEncoder().encode(buildCanonicalPayloadString(input));
}

/** Hex-encode a byte array (lower-case, no separators). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += (b < 0x10 ? "0" : "") + b.toString(16);
  }
  return out;
}

/** Convenience: canonical payload as lowercase hex (suitable for wallet.signData). */
export function buildCanonicalPayloadHex(input: CanonicalPayloadInput): string {
  return bytesToHex(buildCanonicalPayloadBytes(input));
}
