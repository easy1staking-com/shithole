/**
 * Tiny date formatters for the /me/history feed.
 *
 * Intl.RelativeTimeFormat handles localisation; we pick the largest unit
 * that gives a sensible-looking value (no "120 seconds ago" — say "2m ago"
 * instead). Both formatters are pure — no `now` parameter is exposed, so
 * tests should stub Date.now() if they need deterministic output.
 */

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

type Unit = Exclude<Intl.RelativeTimeFormatUnit, "quarter" | "quarters">;

const UNITS: { unit: Unit; seconds: number }[] = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
];

/**
 * Returns "2h ago", "just now", "in 3d", etc. Returns "" for an invalid
 * input (caller should not show anything rather than show "Invalid Date").
 */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 5) return "just now";
  for (const { unit, seconds } of UNITS) {
    if (abs >= seconds) {
      return RTF.format(Math.round(diffSec / seconds), unit);
    }
  }
  return RTF.format(diffSec, "second");
}

/**
 * Returns the absolute timestamp ("2026-05-20 14:32") for tooltips.
 * Locale-aware via Intl; falls back to the raw ISO on parse failure.
 */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
