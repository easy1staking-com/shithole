/**
 * Codec for the FluidTokens Aquarium {@code DatumTank}.
 *
 * <p>Source of truth: {@code lib/types/datum.ak} in
 * {@code FluidTokens/ft-cardano-aquarium-sc}. Field order is positional
 * on the wire — re-order anything and the CBOR diverges.
 *
 * <p>Decode is the load-bearing direction for the babel-fee feature:
 * we read a tank UTxO's datum to learn (a) which paying tokens it
 * accepts + at what markup, (b) the {@code tankOwner} address the
 * payment-output must land at, (c) whether a whitelist is in play.
 *
 * <p>Encode is needed for the continuing tank output — its datum must
 * equal the input verbatim ({@code inputTank.output.datum == outputTank.datum}
 * in the validator's {@code validate_tank_output}). The simplest
 * guarantee is to round-trip through this codec: decode → re-encode →
 * attach to the output. As a defensive shortcut, we also support
 * passing the raw inline-datum CBOR through unchanged.
 */

import {
  Address,
  Credential as EvCredential,
  Data,
} from "@evolution-sdk/evolution";

import type {
  CardanoToken,
  Credential,
  DatumTank,
  OnChainAddress,
} from "./types";

/**
 * Decode a Plutus {@link Data.Data} into the structured {@link DatumTank}.
 * Returns {@code null} when the shape doesn't fit — caller treats that
 * as "not a tank UTxO" and skips it.
 *
 * <p>The seven-field positional layout is verbatim from
 * {@code datum.ak::DatumTank}.
 */
export function decodeDatumTank(data: Data.Data): DatumTank | null {
  try {
    if (!Data.isConstr(data)) return null;
    const c = data as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
    if (c.index !== 0n) return null;
    if (c.fields.length < 7) return null;

    const [
      allowedTokensF,
      tankOwnerF,
      whitelistF,
      executionTimeF,
      destinationAddressF,
      scheduledAmountF,
      rewardF,
    ] = c.fields;

    const allowedTokens = decodeTokenList(allowedTokensF);
    if (allowedTokens === null) return null;

    const tankOwner = decodeAddress(tankOwnerF);
    if (tankOwner === null) return null;

    const whitelistedAddresses = decodeAddressList(whitelistF);
    if (whitelistedAddresses === null) return null;

    if (typeof executionTimeF !== "bigint") return null;

    const destinationAddress = decodeAddress(destinationAddressF);
    if (destinationAddress === null) return null;

    const scheduledAmount = decodeCardanoToken(scheduledAmountF);
    if (scheduledAmount === null) return null;

    const reward = decodeCardanoToken(rewardF);
    if (reward === null) return null;

    return {
      allowedTokens,
      tankOwner,
      whitelistedAddresses,
      executionTime: executionTimeF,
      destionationaAddress: destinationAddress,
      scheduledAmount,
      reward,
    };
  } catch {
    return null;
  }
}

/**
 * Encode a {@link DatumTank} back into Plutus {@link Data.Data} for use
 * as an inline datum on the continuing tank output. The validator
 * compares input.datum and output.datum byte-by-byte; this MUST
 * produce the same bytes as the input did or the spend fails.
 *
 * <p>For paranoia, callers are allowed to skip this round-trip and
 * simply re-attach the input's raw inline-datum CBOR to the continuing
 * output. {@link encodeDatumTank} is provided so a builder *can* verify
 * round-tripping during dev.
 */
export function encodeDatumTank(d: DatumTank): Data.Data {
  return Data.constr(0n, [
    Data.list(d.allowedTokens.map(encodeCardanoToken)),
    encodeAddressOnChain(d.tankOwner),
    Data.list(d.whitelistedAddresses.map(encodeAddressOnChain)),
    Data.int(d.executionTime),
    encodeAddressOnChain(d.destionationaAddress),
    encodeCardanoToken(d.scheduledAmount),
    encodeCardanoToken(d.reward),
  ]);
}

/**
 * Convert a decoded on-chain {@link OnChainAddress} back to a bech32
 * string against the active network. Used for displaying the tankOwner
 * (so the FE can show "you'll pay 13.9M HOSKY to addr1q…") and for
 * building the payment output's address inside the tx-builder.
 */
export function onChainAddressToBech32(
  addr: OnChainAddress,
  networkId: 0 | 1,
): string {
  const payment = credentialToEvolution(addr.paymentCredential);
  if (addr.stakeCredential === null) {
    return Address.toBech32(
      new Address.Address({ networkId, paymentCredential: payment }),
    );
  }
  const stake = credentialToEvolution(addr.stakeCredential.credential);
  return Address.toBech32(
    new Address.Address({
      networkId,
      paymentCredential: payment,
      stakingCredential: stake,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Internal: per-field decoders/encoders                                      */
/* -------------------------------------------------------------------------- */

function decodeCardanoToken(d: unknown): CardanoToken | null {
  if (!Data.isConstr(d as Data.Data)) return null;
  const c = d as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.index !== 0n || c.fields.length < 5) return null;
  const [pF, nF, amtF, divF, oracleF] = c.fields;
  if (!(pF instanceof Uint8Array)) return null;
  if (!(nF instanceof Uint8Array)) return null;
  if (typeof amtF !== "bigint") return null;
  if (typeof divF !== "bigint") return null;
  // oracle: Option<Asset> — Constr 0 [Asset] = Some, Constr 1 [] = None.
  const oracle = decodeOption(oracleF, decodeAsset);
  if (oracle === undefined) return null;
  return {
    policyId: bytesToHex(pF),
    assetName: bytesToHex(nF),
    amount: amtF,
    divider: divF,
    oracle,
  };
}

function encodeCardanoToken(t: CardanoToken): Data.Data {
  return Data.constr(0n, [
    Data.bytearray(t.policyId),
    Data.bytearray(t.assetName),
    Data.int(t.amount),
    Data.int(t.divider),
    encodeOption(t.oracle, (a) =>
      Data.constr(0n, [Data.bytearray(a.policyId), Data.bytearray(a.assetName)]),
    ),
  ]);
}

function decodeAsset(d: unknown): { policyId: string; assetName: string } | null {
  if (!Data.isConstr(d as Data.Data)) return null;
  const c = d as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.index !== 0n || c.fields.length < 2) return null;
  const [pF, nF] = c.fields;
  if (!(pF instanceof Uint8Array)) return null;
  if (!(nF instanceof Uint8Array)) return null;
  return { policyId: bytesToHex(pF), assetName: bytesToHex(nF) };
}

function decodeTokenList(d: unknown): CardanoToken[] | null {
  if (!Data.isList(d as Data.Data)) return null;
  const items = d as unknown as ReadonlyArray<unknown>;
  const out: CardanoToken[] = [];
  for (const it of items) {
    const t = decodeCardanoToken(it);
    if (t === null) return null;
    out.push(t);
  }
  return out;
}

function decodeAddressList(d: unknown): OnChainAddress[] | null {
  if (!Data.isList(d as Data.Data)) return null;
  const items = d as unknown as ReadonlyArray<unknown>;
  const out: OnChainAddress[] = [];
  for (const it of items) {
    const a = decodeAddress(it);
    if (a === null) return null;
    out.push(a);
  }
  return out;
}

/**
 * Decode a {@code cardano/address.Address} Constr into an
 * {@link OnChainAddress}.
 * <pre>
 *   Constr 0 [payment_credential, stake_credential]
 *   payment_credential: Constr 0 [bytes] (VerificationKey) | Constr 1 [bytes] (Script)
 *   stake_credential:
 *     Some(Inline(cred)) → Constr 0 [Constr 0 [cred]]
 *     None               → Constr 1 []
 * </pre>
 * Pointer addresses are reported as null stake (rare in practice).
 */
function decodeAddress(d: unknown): OnChainAddress | null {
  if (!Data.isConstr(d as Data.Data)) return null;
  const c = d as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.index !== 0n || c.fields.length < 2) return null;
  const [paymentF, stakeF] = c.fields;
  const paymentCredential = decodeCredential(paymentF);
  if (paymentCredential === null) return null;

  // stakeF: Constr 0 [referenced] = Some, Constr 1 [] = None.
  // referenced: Constr 0 [credential] = Inline, Constr 1 [...] = Pointer (unsupported).
  if (!Data.isConstr(stakeF as Data.Data)) return null;
  const stakeConstr = stakeF as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  let stakeCredential: { kind: "inline"; credential: Credential } | null = null;
  if (stakeConstr.index === 0n) {
    if (stakeConstr.fields.length < 1) return null;
    const ref = stakeConstr.fields[0];
    if (!Data.isConstr(ref as Data.Data)) return null;
    const refConstr = ref as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
    if (refConstr.index !== 0n) {
      // Pointer variant — unsupported. Mirror the BE behaviour and skip.
      return null;
    }
    if (refConstr.fields.length < 1) return null;
    const inner = decodeCredential(refConstr.fields[0]);
    if (inner === null) return null;
    stakeCredential = { kind: "inline", credential: inner };
  } else if (stakeConstr.index !== 1n) {
    return null;
  }
  return { paymentCredential, stakeCredential };
}

function encodeAddressOnChain(a: OnChainAddress): Data.Data {
  const paymentCred = encodeCredential(a.paymentCredential);
  let stake: Data.Data;
  if (a.stakeCredential === null) {
    stake = Data.constr(1n, []);
  } else {
    const inner = encodeCredential(a.stakeCredential.credential);
    const inline = Data.constr(0n, [inner]);
    stake = Data.constr(0n, [inline]);
  }
  return Data.constr(0n, [paymentCred, stake]);
}

function decodeCredential(d: unknown): Credential | null {
  if (!Data.isConstr(d as Data.Data)) return null;
  const c = d as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.fields.length < 1) return null;
  const [hashF] = c.fields;
  if (!(hashF instanceof Uint8Array)) return null;
  const hashHex = bytesToHex(hashF);
  if (c.index === 0n) return { kind: "verificationKey", hash: hashHex };
  if (c.index === 1n) return { kind: "script", hash: hashHex };
  return null;
}

function encodeCredential(c: Credential): Data.Data {
  return Data.constr(c.kind === "verificationKey" ? 0n : 1n, [Data.bytearray(c.hash)]);
}

function credentialToEvolution(c: Credential) {
  const bytes = hexToBytes(c.hash);
  return c.kind === "verificationKey"
    ? EvCredential.makeKeyHash(bytes)
    : EvCredential.makeScriptHash(bytes);
}

function decodeOption<T>(
  d: unknown,
  inner: (x: unknown) => T | null,
): T | null | undefined {
  if (!Data.isConstr(d as Data.Data)) return undefined;
  const c = d as unknown as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.index === 1n) return null; // None
  if (c.index !== 0n) return undefined;
  if (c.fields.length < 1) return undefined;
  return inner(c.fields[0]);
}

function encodeOption<T>(v: T | null, encode: (x: T) => Data.Data): Data.Data {
  if (v === null) return Data.constr(1n, []);
  return Data.constr(0n, [encode(v)]);
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, "0");
  }
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : "0" + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
