/**
 * Tests for {@link describeError}.
 *
 * The motivating bug: Evolution SDK runs on Effect-TS, so a failed tx
 * surfaces as a {@code (FiberFailure)} whose REAL cause (the
 * TransactionBuilderError → the Blockfrost provider error → the node's
 * response body) is NOT a plain {@code .cause} property. Effect stashes
 * the {@code Cause} tree behind a <b>Symbol-keyed, non-enumerable</b>
 * field. The old extractor walked only {@code .cause} and dumped only
 * {@code Object.keys()}, so users got an empty report showing just
 * {@code name}. These tests pin the traversal that now digs it out.
 */

import { describe, expect, it } from "vitest";

import { describeError } from "@/lib/errors";

/** Build an Effect-style FiberFailure with the cause Symbol-stashed and
 * the Blockfrost body hung off non-enumerable props — the exact shape
 * that produced the empty on-screen report. */
function makeFiberFailure(nodeRejection: string): Error {
  const blockfrost = new Error("Blockfrost provider error");
  blockfrost.name = "HttpClientError";
  Object.defineProperty(blockfrost, "status", {
    value: 400,
    enumerable: false,
  });
  Object.defineProperty(blockfrost, "responseBody", {
    value: nodeRejection,
    enumerable: false,
  });

  const builder = new Error(
    "Failed to submit transaction: Blockfrost submitTx failed",
  );
  builder.name = "TransactionBuilderError";
  builder.cause = blockfrost;

  // Effect Cause.Fail node holding the builder error under `.error`.
  const cause = { _tag: "Fail", error: builder };

  const fiber = new Error(
    "Failed to submit transaction: Blockfrost submitTx failed",
  );
  fiber.name = "(FiberFailure) TransactionBuilderError";
  // Stashed under a Symbol, non-enumerable — invisible to Object.keys.
  Object.defineProperty(
    fiber,
    Symbol.for("effect/Runtime/FiberFailure/Cause"),
    { value: cause, enumerable: false },
  );
  return fiber;
}

describe("describeError", () => {
  it("digs the node rejection out of a Symbol-stashed Effect cause", () => {
    const rejection =
      '{"error":"Bad Request","message":"transaction submit error ... [CollateralIsScript ...]"}';
    const out = describeError(makeFiberFailure(rejection));

    // The whole point: the buried node rejection is now surfaced.
    expect(out).toContain("CollateralIsScript");
    expect(out).toContain("HttpClientError");
    expect(out).toContain("400");
    // And the outer framing is still there for context.
    expect(out).toContain("(FiberFailure) TransactionBuilderError");
  });

  it("follows a plain .cause chain", () => {
    const inner = new Error("inner boom");
    inner.name = "InnerError";
    const outer = new Error("outer wrap");
    outer.cause = inner;
    const out = describeError(outer);
    expect(out).toContain("outer wrap");
    expect(out).toContain("InnerError: inner boom");
  });

  it("surfaces non-enumerable own props (HTTP body / status)", () => {
    const e = new Error("request failed");
    Object.defineProperty(e, "status", { value: 503, enumerable: false });
    Object.defineProperty(e, "body", {
      value: "service unavailable",
      enumerable: false,
    });
    const out = describeError(e);
    expect(out).toContain("503");
    expect(out).toContain("service unavailable");
  });

  it("does not loop on circular cause references", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    const out = describeError(a);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("handles a bare string and nullish input", () => {
    expect(describeError("just a string")).toBe("just a string");
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError(undefined)).toBe("Unknown error");
  });
});
