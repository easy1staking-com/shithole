/**
 * Byte-identity tests for the canonical CIP-8 payload.
 *
 * The expected hex values were produced by mirroring the Java helper
 * {@code Cip8SignatureVerifier.buildCanonicalPayload} in
 * `api/src/main/java/com/easy1staking/shithole/service/Cip8SignatureVerifier.java`.
 *
 * For each fixture, the byte output is also computable as:
 *   echo -n "<canonical-payload>" | xxd -p -c 1024
 *
 * If you change the canonical format you MUST update both sides AND the
 * expected hex below — that's the point of these tests.
 */

import { describe, expect, it } from "vitest";

import {
  buildCanonicalPayloadBytes,
  buildCanonicalPayloadHex,
  buildCanonicalPayloadString,
  bytesToHex,
} from "../canonicalPayload";

describe("buildCanonicalPayload — byte identity vs Java helper", () => {
  it("minimal fixture (no theme, displayOrder defaults to 0)", () => {
    // Mirrors the ConfigRegistrationServiceTest happy path:
    //   POLICY = "abababababababababababababababababababababababababababab"
    //   slug   = "hosky"
    //   name   = "Hosky"
    const expectedHex =
      "73686974686f6c652f72656769737465722d636f6e6669670a" + // shithole/register-config\n
      "61626162616261626162616261626162616261626162616261626162" + // 56-hex policy chars (28 ab pairs) — first 28
      "61626162616261626162616261626162616261626162616261626162" + // (continued — total 56 chars)
      "0a" + // \n
      "686f736b790a" + // hosky\n
      "486f736b790a" + // Hosky\n
      "300a" + // 0\n
      "0a" + // empty bg + \n
      "0a"; // empty accent + \n (mascot is empty, no trailing newline)

    const bytes = buildCanonicalPayloadBytes({
      configNftPolicy: "abababababababababababababababababababababababababababab",
      slug: "hosky",
      displayName: "Hosky",
      displayOrder: 0,
    });

    expect(bytesToHex(bytes)).toBe(expectedHex);
    expect(bytes.length).toBe(98);
  });

  it("full theme + non-default displayOrder", () => {
    const expectedHex =
      "73686974686f6c652f72656769737465722d636f6e6669670a" +
      "61356262306535623030303030303030303030303030303030303030303030303030303030303030303030303030303030303030666666660a" +
      "686f736b792d7275676765640a" +
      "486f736b792028522e492e502e290a" +
      "370a" +
      "68747470733a2f2f6578616d706c652e636f6d2f62672e706e670a" +
      "236162633132330a" +
      "68747470733a2f2f6578616d706c652e636f6d2f6d6173636f742e737667";

    const hex = buildCanonicalPayloadHex({
      configNftPolicy: "a5bb0e5b00000000000000000000000000000000000000000000FFFF", // uppercase to test toLowerCase()
      slug: "hosky-rugged",
      displayName: "Hosky (R.I.P.)",
      displayOrder: 7,
      theme: {
        backgroundUrl: "https://example.com/bg.png",
        accentColor: "#abc123",
        mascotImageUrl: "https://example.com/mascot.svg",
      },
    });

    expect(hex).toBe(expectedHex);
  });

  it("treats null theme fields as empty strings", () => {
    const s = buildCanonicalPayloadString({
      configNftPolicy: "ab".repeat(28),
      slug: "x",
      displayName: "y",
      displayOrder: null,
      theme: {
        backgroundUrl: null,
        accentColor: null,
        mascotImageUrl: null,
      },
    });
    // displayOrder ?? 0; null theme fields ?? "".
    expect(s).toBe(
      "shithole/register-config\n" +
        "ab".repeat(28) +
        "\n" +
        "x\n" +
        "y\n" +
        "0\n" +
        "\n" +
        "\n" +
        "",
    );
  });

  it("lowercases the config_nft_policy", () => {
    const upper = buildCanonicalPayloadString({
      configNftPolicy: "AB".repeat(28),
      slug: "x",
      displayName: "y",
    });
    const lower = buildCanonicalPayloadString({
      configNftPolicy: "ab".repeat(28),
      slug: "x",
      displayName: "y",
    });
    expect(upper).toBe(lower);
  });

  it("never appends a trailing newline", () => {
    const s = buildCanonicalPayloadString({
      configNftPolicy: "ab".repeat(28),
      slug: "x",
      displayName: "y",
      theme: { mascotImageUrl: "https://example.com/m.svg" },
    });
    expect(s.endsWith("\n")).toBe(false);
    expect(s.endsWith("https://example.com/m.svg")).toBe(true);
  });
});
