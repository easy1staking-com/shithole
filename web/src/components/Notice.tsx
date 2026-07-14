"use client";

/**
 * Inline, severity-aware notice for EXPECTED/operational messaging —
 * declined signature, insufficient funds, contended UTxO, wrong network,
 * etc. Deliberately NOT the debug box: no copy-report affordance, no
 * "Something went wrong" framing. Colour + a11y role follow the severity.
 *
 * <p>For genuinely-unknown failures use {@link ErrorNotice} (the red
 * debug box) — usually via {@code ErrorView}, which classifies and picks
 * the right one.
 */

import type { ReactNode } from "react";

import type { NoticeSeverity } from "@/lib/errors";

const STYLES: Record<
  NoticeSeverity,
  { box: string; title: string; icon: string; glyph: string; role: "alert" | "status" }
> = {
  error: {
    box: "border-red-900 bg-red-950/40 text-red-200",
    title: "text-red-300",
    icon: "text-red-400",
    glyph: "✕",
    role: "alert",
  },
  warning: {
    box: "border-amber-900 bg-amber-950/30 text-amber-200",
    title: "text-amber-300",
    icon: "text-amber-400",
    glyph: "!",
    role: "alert",
  },
  info: {
    box: "border-sky-900 bg-sky-950/30 text-sky-200",
    title: "text-sky-300",
    icon: "text-sky-400",
    glyph: "i",
    role: "status",
  },
  success: {
    box: "border-emerald-900 bg-emerald-950/30 text-emerald-200",
    title: "text-emerald-300",
    icon: "text-emerald-400",
    glyph: "✓",
    role: "status",
  },
  neutral: {
    box: "border-zinc-800 bg-zinc-950 text-zinc-300",
    title: "text-zinc-300",
    icon: "text-zinc-500",
    glyph: "•",
    role: "status",
  },
};

export type NoticeProps = {
  severity: NoticeSeverity;
  /** Short bold headline. Omit for a message-only notice. */
  title?: string;
  /** The message body. */
  children?: ReactNode;
  className?: string;
};

export function Notice({ severity, title, children, className = "" }: NoticeProps) {
  const s = STYLES[severity];
  return (
    <div
      role={s.role}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${s.box} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 font-mono text-xs font-bold leading-5 ${s.icon}`}
      >
        {s.glyph}
      </span>
      <div className="min-w-0 space-y-0.5">
        {title ? (
          <p className={`font-semibold leading-5 ${s.title}`}>{title}</p>
        ) : null}
        {children ? <div className="leading-snug opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
