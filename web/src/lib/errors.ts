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

/**
 * Evolution runs on Effect-TS: a failed tx surfaces as a
 * {@code (FiberFailure)} whose real cause tree is stashed under this
 * Symbol (non-enumerable), NOT on {@code .cause}. We follow it explicitly.
 */
const FIBER_CAUSE = Symbol.for("effect/Runtime/FiberFailure/Cause");

/** Walk an Effect {@code Cause} tree to the first Fail/Die payload. */
function effectCauseError(cause: unknown): unknown {
  const seen = new Set<unknown>();
  const stack: unknown[] = [cause];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n == null || typeof n !== "object" || seen.has(n)) continue;
    seen.add(n);
    const o = n as Record<string, unknown>;
    if (o.error != null) return o.error;
    if (o.defect != null) return o.defect;
    if (o.left != null) stack.push(o.left);
    if (o.right != null) stack.push(o.right);
    if (o.cause != null) stack.push(o.cause);
  }
  return undefined;
}

/** Next node in the cause chain: plain {@code .cause} first, then the
 * Effect FiberFailure Symbol-stashed cause. */
function nextCause(node: unknown): unknown {
  if (node == null || typeof node !== "object") return undefined;
  const direct = (node as { cause?: unknown }).cause;
  if (direct != null) return direct;
  const fiber = (node as Record<symbol, unknown>)[FIBER_CAUSE];
  if (fiber != null) return effectCauseError(fiber);
  return undefined;
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
    // index…) off own props rather than the message — and often make them
    // NON-enumerable (Effect's HTTP client does this), so getOwnPropertyNames
    // is required; Object.keys would miss them.
    const extra: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(node)) {
      if (key === "message" || key === "stack" || key === "cause" || key === "name") {
        continue;
      }
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
    cur = nextCause(cur);
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

/* -------------------------------------------------------------------------- */
/* classifyError — split expected/operational errors from unexpected ones      */
/* -------------------------------------------------------------------------- */

/**
 * Severity levels for user-facing messaging. Maps to colour + a11y role in
 * the {@code Notice} component. {@code neutral} is for loading/empty labels.
 */
export type NoticeSeverity = "error" | "warning" | "info" | "success" | "neutral";

/**
 * The result of classifying a thrown value.
 *
 * <p>{@code kind: "known"} → an expected operational failure (declined
 * signature, insufficient funds, contended UTxO, wrong network…). Render
 * {@code title}/{@code message} via the inline severity-aware {@code Notice}
 * — no copy-report box.
 *
 * <p>{@code kind: "unknown"} → a genuinely unexpected failure (script
 * evaluation, FE/BE drift, internal invariant, buried node rejection).
 * Render the full {@link describeError} dump via {@code ErrorNotice} with
 * the copy-report affordance. {@code message} is empty here — the box
 * re-derives detail from {@code raw}.
 */
export type ClassifiedError = {
  kind: "known" | "unknown";
  severity: NoticeSeverity;
  title: string;
  message: string;
  /** The original thrown value, always preserved for the debug path. */
  raw: unknown;
};

/** Optional context to fill message tails at the call site. */
export type ClassifyContext = {
  /** Past-tense verb for the decline tail: "listed", "bought", "swept". */
  action?: string;
  /** Noun for the contention message: "listing", "jar", "offer". */
  subject?: string;
  /** Network names for the wrong-network message. */
  appNetwork?: string;
  walletNetwork?: string;
};

/**
 * Best-effort structural probe for a CIP-30 numeric error code. CIP-30
 * errors arrive as plain {@code {code, info}} objects (NOT Error
 * instances) and wallets differ, so we also walk a few link fields.
 */
function extractCip30Code(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = error;
  let depth = 0;
  while (cur != null && typeof cur === "object" && depth < 6 && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "number") return code;
    const next =
      (cur as { cause?: unknown }).cause ??
      (cur as { error?: unknown }).error;
    cur = next;
    depth += 1;
  }
  return undefined;
}

/** Script-evaluation / builder-drift failures always stay in the debug
 * bucket — a validator rejecting our own tx is a bug we want reported. */
function isScriptEvalFailure(t: string): boolean {
  return /scriptfailure|evaluation failed|script hash mismatch|redeemer|does not include the|disagreement|address mismatch/.test(
    t,
  );
}

/**
 * Classify a thrown value into a friendly, severity-tagged message
 * (known/operational) or the unknown-debug bucket. Match order is
 * significant — first hit wins, most-specific first. Matching runs against
 * the fully-flattened {@link describeError} string (which already digs the
 * real rejection out of Effect FiberFailures / non-enumerable props) plus a
 * structural CIP-30 code probe.
 */
export function classifyError(
  error: unknown,
  context: ClassifyContext = {},
): ClassifiedError {
  const raw = error;
  const t = describeError(error).toLowerCase();
  const code = extractCip30Code(error);
  const known = (
    severity: NoticeSeverity,
    title: string,
    message: string,
  ): ClassifiedError => ({ kind: "known", severity, title, message, raw });

  const scriptEval = isScriptEvalFailure(t);

  // 1. User declined / cancelled a wallet prompt (the most common "error").
  const declined =
    code === -3 ||
    /\b(user )?(declined|rejected|refused)\b/.test(t) ||
    (/(sign|signature)/.test(t) && (code === 2 || code === 3));
  if (declined) {
    const tail = context.action
      ? `nothing was ${context.action}`
      : "nothing happened";
    return known("info", "Signing cancelled", `You dismissed the wallet prompt — ${tail}.`);
  }

  // 2. Account switched mid-session.
  if (code === -4 || /account.?chang/.test(t)) {
    return known("warning", "Account changed", "You switched accounts — reconnect to continue.");
  }

  // 3. No wallet installed / detected.
  if (/no cardano wallet|is not installed|no wallet (found|detected)|window\.cardano/.test(t)) {
    return known("warning", "No wallet found", "Install Eternl, Vespr, or Lace, then refresh.");
  }

  // 4. Wrong network (wallet vs app).
  if (/wrong network|network.?mismatch|networkid|does not match app network/.test(t)) {
    const lead =
      context.walletNetwork && context.appNetwork
        ? `Your wallet is on ${context.walletNetwork} but the app runs on ${context.appNetwork}. `
        : "";
    return known(
      "warning",
      "Wrong network",
      `${lead}Switch your wallet to ${context.appNetwork ?? "the app's network"} and reconnect.`,
    );
  }

  // 5. Collateral — check before "insufficient" (InsufficientCollateral).
  if (/collateral/.test(t)) {
    return known("warning", "No collateral set", "Set a collateral UTxO in your wallet, then retry.");
  }

  // 6. Insufficient funds.
  if (/insufficient|not enough|inputsexhausted|balance insufficient|no available inputs|coin selection failed/.test(t)) {
    return known("warning", "Not enough funds", "Your wallet can't cover the amount plus fees. Top up and retry.");
  }

  // 7. Contended / already-spent UTxO (someone got there first). Never for
  // script-eval failures (those are the debug bucket).
  if (
    !scriptEval &&
    /badinputsutxo|already spent|already taken|already fulfilled|valuenotconserved|does not exist|not found in|utxo .* not found|input .* not found|vanished/.test(t)
  ) {
    return known(
      "warning",
      "Someone got there first",
      `That ${context.subject ?? "one"} was just taken or changed. Refresh and try another.`,
    );
  }

  // 8. Min-UTxO / amount below the on-chain floor.
  if (/min.?utxo|babbageoutputtoosmall|outputtoosmall|too small|below.*minimum/.test(t)) {
    return known("warning", "Amount too low", "That's below the on-chain minimum — raise it and retry.");
  }

  // 9. Wrong signer / not the admin.
  if (/missingrequiredsignature|missing.*signature|signature_not_admin|not the admin|is ?n[o']t the admin/.test(t)) {
    return known("warning", "Not authorized", "This wallet isn't the admin for that action.");
  }

  // 10. Validity interval expired.
  if (/outsidevalidityinterval|validity interval/.test(t)) {
    return known("warning", "Expired", "This transaction window closed — rebuild and retry.");
  }

  // 11. Submitted-but-unconfirmed (confirmation timeout).
  if (/not confirmed within|hasn.t confirmed|not seen on chain|not seen yet|polling returned false/.test(t)) {
    return known(
      "warning",
      "Not confirmed yet",
      "Submitted, but not seen on-chain yet — it may still land. Check the explorer before retrying.",
    );
  }

  // 12. Config already registered.
  if (/\b409\b|already registered|already exists/.test(t)) {
    return known("info", "Already registered", "This collection is already registered.");
  }

  // 13. Backend / indexer busy or unreachable.
  if (/api error (5\d\d)|\b(429|500|502|503|504)\b|timed? ?out|indexer|bad gateway|service unavailable/.test(t)) {
    return known("warning", "Service busy", "Our indexer is catching up. Try again in a moment.");
  }

  // Fallback — genuinely unknown. Keep the red debug box + copy report.
  return { kind: "unknown", severity: "error", title: "Something went wrong", message: "", raw };
}
