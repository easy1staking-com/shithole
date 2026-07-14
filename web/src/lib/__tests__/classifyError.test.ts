/**
 * Tests for {@link classifyError} — the known/operational vs unknown-debug
 * split. Anchored on the signature table in the messaging spec.
 *
 * Coverage priorities: the ordering hazards (collateral-before-insufficient,
 * contention-guarded-against-script-eval), the CIP-30 `.code` path (errors
 * arrive as plain objects, not Error instances), the Effect-FiberFailure
 * unwrap (real cause buried behind a Symbol), and the unknown fallback.
 */

import { describe, expect, it } from "vitest";

import { classifyError } from "@/lib/errors";

/** Mirror of the FiberFailure shape from errors.test.ts — real rejection
 * buried behind a Symbol + non-enumerable body, wrapped by Evolution. */
function fiberFailure(nodeRejection: string): Error {
  const blockfrost = new Error("Blockfrost provider error");
  blockfrost.name = "HttpClientError";
  Object.defineProperty(blockfrost, "responseBody", {
    value: nodeRejection,
    enumerable: false,
  });
  const builder = new Error("Failed to submit transaction");
  builder.name = "TransactionBuilderError";
  builder.cause = blockfrost;
  const fiber = new Error("Failed to submit transaction");
  fiber.name = "(FiberFailure) TransactionBuilderError";
  Object.defineProperty(fiber, Symbol.for("effect/Runtime/FiberFailure/Cause"), {
    value: { _tag: "Fail", error: builder },
    enumerable: false,
  });
  return fiber;
}

describe("classifyError — known operational errors", () => {
  it("declined: CIP-30 plain object with code 2 during signing", () => {
    const c = classifyError({ code: 2, info: "user declined sign tx" }, { action: "bought" });
    expect(c.kind).toBe("known");
    expect(c.severity).toBe("info");
    expect(c.title).toBe("Signing cancelled");
    expect(c.message).toContain("nothing was bought");
  });

  it("declined: enable refused (code -3), no action context", () => {
    const c = classifyError({ code: -3, info: "user refused" });
    expect(c.kind).toBe("known");
    expect(c.title).toBe("Signing cancelled");
    expect(c.message).toContain("nothing happened");
  });

  it("declined: message-only (no code)", () => {
    const c = classifyError(new Error("The request was rejected by the user."));
    expect(c.title).toBe("Signing cancelled");
  });

  it("account changed (code -4)", () => {
    const c = classifyError({ code: -4, info: "account changed" });
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("Account changed");
  });

  it("no wallet installed", () => {
    const c = classifyError(new Error('wallet "eternl" is not installed'));
    expect(c.title).toBe("No wallet found");
  });

  it("wrong network, with network context", () => {
    const c = classifyError(new Error("wallet network does not match app network"), {
      appNetwork: "preprod",
      walletNetwork: "mainnet",
    });
    expect(c.title).toBe("Wrong network");
    expect(c.message).toContain("preprod");
    expect(c.message).toContain("mainnet");
  });

  it("collateral wins over insufficient (ordering)", () => {
    // InsufficientCollateral contains both 'insufficient' and 'collateral'.
    const c = classifyError(fiberFailure("transaction submit error ... [InsufficientCollateral]"));
    expect(c.kind).toBe("known");
    expect(c.title).toBe("No collateral set");
  });

  it("insufficient balance (our coinSelection sentinel)", () => {
    const c = classifyError(new Error("Insufficient balance to complete this purchase."));
    expect(c.title).toBe("Not enough funds");
    expect(c.severity).toBe("warning");
  });

  it("contended UTxO (BadInputsUTxO) with subject", () => {
    const c = classifyError(fiberFailure("[BadInputsUTxO ...]"), { subject: "listing" });
    expect(c.title).toBe("Someone got there first");
    expect(c.message).toContain("listing");
  });

  it("min-utxo too small", () => {
    const c = classifyError(fiberFailure("[BabbageOutputTooSmallUTxO ...]"));
    expect(c.title).toBe("Amount too low");
  });

  it("not the admin / missing signature", () => {
    const c = classifyError(fiberFailure("[MissingRequiredSignature ...]"));
    expect(c.title).toBe("Not authorized");
  });

  it("validity interval expired", () => {
    const c = classifyError(fiberFailure("[OutsideValidityIntervalUTxO ...]"));
    expect(c.title).toBe("Expired");
  });

  it("confirmation timeout", () => {
    const c = classifyError(new Error("tx abc not confirmed within 180s — try again"));
    expect(c.title).toBe("Not confirmed yet");
  });

  it("already registered (409)", () => {
    const c = classifyError(new Error("409 conflict: already registered"));
    expect(c.severity).toBe("info");
    expect(c.title).toBe("Already registered");
  });

  it("backend busy (5xx)", () => {
    const c = classifyError(new Error("API error 503 at /api/curated"));
    expect(c.title).toBe("Service busy");
  });
});

describe("classifyError — unknown / debug bucket", () => {
  it("script evaluation failure stays unknown (never 'someone got there first')", () => {
    // Contains 'not found'-ish AND scriptfailure — must NOT be classified as contention.
    const c = classifyError(fiberFailure("ScriptFailure: evaluation failed, input not found"));
    expect(c.kind).toBe("unknown");
    expect(c.severity).toBe("error");
    expect(c.title).toBe("Something went wrong");
    expect(c.message).toBe("");
    expect(c.raw).toBeTruthy();
  });

  it("generic unrecognized error stays unknown", () => {
    const c = classifyError(new Error("some totally novel failure mode"));
    expect(c.kind).toBe("unknown");
  });

  it("FE/BE drift (address mismatch) stays unknown", () => {
    const c = classifyError(new Error("listing script address mismatch — derived=x BE=y"));
    expect(c.kind).toBe("unknown");
  });

  it("preserves the raw error for the debug path", () => {
    const raw = new Error("boom");
    expect(classifyError(raw).raw).toBe(raw);
  });

  it("nullish input is unknown-safe", () => {
    expect(classifyError(null).kind).toBe("unknown");
    expect(classifyError(undefined).kind).toBe("unknown");
  });
});
