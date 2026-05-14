/**
 * Form-level validation for the admin register-config page.
 *
 * Mirrors the BE validators in `ConfigRegistrationRequestDto` + the
 * SPEC §3.1 numeric bounds. Done with zod because the form has enough
 * shape for hand-rolled checks to get gnarly.
 */

import { z } from "zod";

export const MIN_LISTER_FEE_LOVELACE = 1_000_000n;
export const MAX_FEE_LOVELACE = 1_000_000_000n; // 1000 ADA — matches BE ceiling
export const MAX_M = 1_000_000;

const POLICY_HEX = /^[0-9a-fA-F]{56}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Mirrors Java `[^\p{Cntrl}]` — reject ASCII control chars (0x00-0x1F, 0x7F).
// Built via RegExp(...) to keep this file's source ASCII-safe.
const DISPLAY_NAME = new RegExp("^[^\\x00-\\x1f\\x7f]{1,64}$");
const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
// Either https:// or a same-origin absolute path. Leading `/[\w.\-]`
// anchor blocks protocol-relative `//evil.com/...` while still letting
// `/pit/foo.webp` through. Must mirror ThemeDto.URL_OR_PATH_REGEX on
// the BE — divergence here would mean the FE submits a payload the
// BE then rejects.
const URL_OR_PATH = /^(https:\/\/|\/[\w.\-])[\w.\-/?=&%~+,#:]*$/;

export const registerConfigFormSchema = z
  .object({
    collectionPolicyId: z
      .string()
      .regex(POLICY_HEX, "must be 56 hex chars (28-byte policy id)"),
    m: z
      .number({ message: "must be an integer >= 1" })
      .int()
      .min(1, "must be >= 1")
      .max(MAX_M, `must be <= ${MAX_M}`),
    // BE rejects fees above MAX_FEE_LOVELACE (1000 ADA). Caught FE-side
     // *before* the on-chain deploy so the admin doesn't end up with a
     // confirmed but unregistrable config UTxO.
    protocolFeeAda: z
      .number({ message: "must be a number" })
      .min(0, "must be >= 0")
      .max(1000, "must be <= 1000 ADA (MAX_FEE_LOVELACE)"),
    listerFeeAda: z
      .number({ message: "must be a number" })
      .min(1, "must be >= 1 ADA (MIN_LISTER_FEE floor)")
      .max(1000, "must be <= 1000 ADA (MAX_FEE_LOVELACE)"),
    treasuryAddrBech32: z
      .string()
      .min(1, "required")
      .refine(
        (s) => s.startsWith("addr1") || s.startsWith("addr_test1"),
        "must be a bech32 Cardano address (addr1… or addr_test1…)",
      ),
    adminPkhHex: z
      .string()
      .regex(POLICY_HEX, "must be 56 hex chars (28-byte verification-key hash)"),
    slug: z
      .string()
      .min(2, "must be 2..32 chars")
      .max(32, "must be 2..32 chars")
      .regex(SLUG, "must be [a-z0-9-], no leading/trailing/consecutive dashes"),
    displayName: z
      .string()
      .regex(DISPLAY_NAME, "1..64 chars, no control characters"),
    displayOrder: z
      .number({ message: "must be an integer >= 0" })
      .int()
      .min(0, "must be >= 0"),
    themeBackgroundUrl: z.string().optional().or(z.literal("")),
    themeAccentColor: z.string().optional().or(z.literal("")),
    themeMascotImageUrl: z.string().optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.themeBackgroundUrl && val.themeBackgroundUrl.length > 0) {
      if (!URL_OR_PATH.test(val.themeBackgroundUrl) || val.themeBackgroundUrl.length > 512) {
        ctx.addIssue({
          code: "custom",
          path: ["themeBackgroundUrl"],
          message: "must be https:// URL or same-origin /path (max 512 chars, restricted charset)",
        });
      }
    }
    if (val.themeMascotImageUrl && val.themeMascotImageUrl.length > 0) {
      if (!URL_OR_PATH.test(val.themeMascotImageUrl) || val.themeMascotImageUrl.length > 512) {
        ctx.addIssue({
          code: "custom",
          path: ["themeMascotImageUrl"],
          message: "must be https:// URL or same-origin /path (max 512 chars, restricted charset)",
        });
      }
    }
    if (val.themeAccentColor && val.themeAccentColor.length > 0) {
      if (!HEX_COLOR.test(val.themeAccentColor)) {
        ctx.addIssue({
          code: "custom",
          path: ["themeAccentColor"],
          message: "must be CSS hex color like #abc or #aabbcc",
        });
      }
    }
  });

export type RegisterConfigFormValues = z.infer<typeof registerConfigFormSchema>;
