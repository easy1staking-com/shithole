"use client";

/**
 * Reusable error panel. Renders a thrown value (or a pre-formatted
 * string) clearly, with a one-click "copy error" button so a user can
 * paste the FULL detail back to us for debugging.
 *
 * <p>Pass {@code error} (any thrown value) and the component unwraps the
 * whole {@code .cause} chain via {@link describeError} — this surfaces
 * the real Blockfrost / node rejection that Evolution otherwise hides
 * behind a generic "submitTx failed". For already-formatted strings
 * (e.g. local validation messages) pass {@code message} instead.
 */

import { useState } from "react";

import { buildErrorReport, describeError } from "@/lib/errors";

type ErrorNoticeProps = {
  /** A thrown value — unwrapped to its full cause chain. */
  error?: unknown;
  /** A pre-formatted message (used as-is). Takes precedence over `error`. */
  message?: string;
  /** Extra classes on the outer container. */
  className?: string;
  /** Header label. */
  title?: string;
};

export function ErrorNotice({
  error,
  message,
  className = "",
  title = "Something went wrong",
}: ErrorNoticeProps) {
  const [copied, setCopied] = useState(false);

  const text = message ?? describeError(error);
  if (!text) return null;

  const onCopy = async () => {
    const report = message ? buildErrorReport(message) : buildErrorReport(error);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be blocked (insecure context / permissions).
      // Fall back to a prompt the user can manually copy from.
      try {
        window.prompt("Copy this error and send it back:", report);
      } catch {
        /* nothing else we can do */
      }
    }
  };

  return (
    <div
      role="alert"
      className={`rounded border border-red-900 bg-red-950/40 px-3 py-2 text-red-300 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
          {title}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded border border-red-800 px-2 py-0.5 text-[11px] font-medium text-red-200 transition hover:bg-red-900/50"
        >
          {copied ? "copied!" : "copy error"}
        </button>
      </div>
      <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-red-200">
        {text}
      </pre>
      <p className="mt-1.5 text-[11px] text-red-400/80">
        Hit “copy error” and send it over so we can debug it.
      </p>
    </div>
  );
}
