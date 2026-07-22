/**
 * Form-level validation for the admin update-config page.
 *
 * Mirrors the register-config schema's numeric bounds (same SPEC §3.1
 * concepts) for the three editable numeric fields. Done with zod so a
 * typo'd fee surfaces as an inline field error instead of a bare throw
 * from the tx builder landing in the error box.
 */

import { z } from "zod";

import { MAX_M } from "../register-config/validation";

export const updateConfigFormSchema = z.object({
  m: z
    .number({ message: "must be an integer >= 1" })
    .int("must be a whole number")
    .min(1, "must be >= 1")
    .max(MAX_M, "too many buckets (max 1,000,000)"),
  protocolFeeAda: z
    .number({ message: "must be a number" })
    .min(0, "must be >= 0")
    .max(1000, "too high (max 1000 ADA)"),
  listerFeeAda: z
    .number({ message: "must be a number" })
    .min(1, "below the 1 ADA floor")
    .max(1000, "too high (max 1000 ADA)"),
});

export type UpdateConfigFormValues = z.infer<typeof updateConfigFormSchema>;
