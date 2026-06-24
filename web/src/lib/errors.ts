/**
 * Error description helpers shared across the FE.
 *
 * <p>The problem this solves: Evolution SDK (and most layered libs)
 * throw an outer error with a useless generic {@code message} — e.g.
 * {@code "Blockfrost submitTx failed"} — while the ACTUAL node /
 * Blockfrost rejection (a {@code ScriptFailure}, {@code BadInputsUTxO},
 * {@code OutsideValidityIntervalUTxO}, etc.) is buried in the error's
 * {@code .cause} chain. Rendering only {@code e.message} discards the
 * one string that tells us what really happened.
 *
 * <p>{@link describeError} walks the whole {@code .cause} chain AND
 * serialises each node's own enumerable props (where libs like Effect's
 * HTTP client stash the response body), producing a single complete,
 * copy-pasteable dump suitable for a user to send back for debugging.
 */

/** Hard cap so a pathological nested error can't blow up the UI. */
const MAX_DEPTH = 8;
/** Total character cap on the produced string. */
const MAX_LEN = 8000;

/** JSON.stringify that tolerates bigint + circular refs (both occur in
 * tx-building errors). Returns {@code null} when there is nothing
 * meaningful to serialise. */
function safeStringify(value: unknown): string | null {
  const seen = new WeakSet<object>();
  try {
    const out = JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return undefined;
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        return v;
      },
      2,
    );
    if (out === undefined || out === "{}" || out === "null") return null;
    return out;
  } catch {
    try {
      return String(value);
    } catch {
      return null;
    }
  }
}

/** Format a single node of the cause chain. */
function formatNode(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (
    typeof node === "number" ||
    typeof node === "boolean" ||
    typeof node === "bigint"
  ) {
    return String(node);
  }

  if (node instanceof Error) {
    const lines: string[] = [];
    const head = node.name && node.name !== "Error"
      ? `${node.name}: ${node.message}`
      : node.message || node.name || "Error";
    lines.push(head);
    // Many libs hang the useful payload (HTTP body, status, redeemer
    // index…) off own enumerable props rather than the message.
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key === "message" || key === "stack" || key === "cause") continue;
      extra[key] = (node as unknown as Record<string, unknown>)[key];
    }
    if (Object.keys(extra).length > 0) {
      const serialised = safeStringify(extra);
      if (serialised) lines.push(serialised);
    }
    return lines.join("\n");
  }

  // Plain object / anything else.
  const serialised = safeStringify(node);
  return serialised ?? String(node);
}

/**
 * Produce a complete, human-readable, copy-pasteable description of an
 * unknown thrown value — including the full {@code .cause} chain.
 */
export function describeError(error: unknown): string {
  if (error == null) return "Unknown error";

  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = error;
  let depth = 0;

  while (cur != null && depth < MAX_DEPTH && !seen.has(cur)) {
    seen.add(cur);
    const formatted = formatNode(cur).trim();
    if (formatted) parts.push(formatted);
    cur = (cur as { cause?: unknown } | null)?.cause;
    depth += 1;
  }

  let text = parts.join("\n↳ caused by: ").trim();
  if (!text) text = "Unknown error";
  if (text.length > MAX_LEN) {
    text = `${text.slice(0, MAX_LEN)}\n… (truncated)`;
  }
  return text;
}

/**
 * Build a self-contained error report — the error plus environment
 * context (page URL, timestamp, user agent) — for the user to copy and
 * send back. Browser-only fields are guarded for SSR safety.
 */
export function buildErrorReport(error: unknown): string {
  const body = typeof error === "string" ? error : describeError(error);
  const lines = ["shithole error report"];
  if (typeof window !== "undefined") {
    try {
      lines.push(`time: ${new Date().toISOString()}`);
      lines.push(`page: ${window.location.href}`);
      lines.push(`ua:   ${window.navigator.userAgent}`);
    } catch {
      /* best-effort context */
    }
  }
  lines.push("----------");
  lines.push(body);
  return lines.join("\n");
}
