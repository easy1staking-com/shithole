"use client";

/**
 * Single entry point for rendering a caught error. Classifies the thrown
 * value ({@link classifyError}) and renders:
 *   - KNOWN/operational → inline severity-aware {@link Notice} (friendly,
 *     no copy box);
 *   - UNKNOWN → the {@link ErrorNotice} red debug box + copy-report.
 *
 * <p>Migration pattern: replace
 * {@code setErr(describeError(e)); <ErrorNotice message={err} />}
 * with storing the RAW error and rendering
 * {@code <ErrorView error={err} context={{ action: "bought" }} />}.
 */

import { classifyError, type ClassifyContext } from "@/lib/errors";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Notice } from "@/components/Notice";

export type ErrorViewProps = {
  /** The raw thrown value (NOT a pre-formatted string). */
  error: unknown;
  /** Optional context to fill message tails (action verb, subject noun, networks). */
  context?: ClassifyContext;
  className?: string;
};

export function ErrorView({ error, context, className }: ErrorViewProps) {
  if (error == null) return null;
  const classified = classifyError(error, context);

  if (classified.kind === "known") {
    return (
      <Notice severity={classified.severity} title={classified.title} className={className}>
        {classified.message}
      </Notice>
    );
  }

  // Unknown → keep the full debug treatment (copy-report affordance).
  return <ErrorNotice error={error} className={className} />;
}
