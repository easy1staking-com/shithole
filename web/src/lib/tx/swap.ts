/**
 * Build + submit the swap tx (SPEC §5.4 / §6.3). TypeScript port of
 * {@code api/.../tools/preprod/PreprodSwapTool.java}.
 *
 * <p>Pattern: consume ONE listing UTxO at the listing-script address
 * (carries NA), recreate a successor listing carrying the swapper's NB
 * deposit + (consumed.lovelace + cfg.lister_fee) + inline {@code ListingDatum}
 * with the original {@code lister_pkh} and
 * {@code update_ref = Some(compute_output_tag(consumed.outRef))}; pay
 * {@code cfg.protocol_fee} to the treasury address with the SAME
 * {@code output_tag} as a raw-bytes inline datum (no Constr wrapper);
 * read the config UTxO as CIP-31 reference input.
 *
 * <p>Migrated from @lucid-evolution/lucid to @evolution-sdk/evolution
 * 2026-05-15. Critical byte-level parity confirmed by parity.test.ts.
 */

import {
  Address,
  Bytes,
  Credential,
  Data,
  KeyHash,
  PlutusV3,
  ScriptHash,
  TransactionHash,
  UPLC,
  preprod,
  mainnet,
  preview,
} from "@evolution-sdk/evolution";
import { blake2b } from "@noble/hashes/blake2b";

import { serialiseOutputReference, hexToBytes } from "@/lib/pit/bucketMath";

import type { EvolutionClient } from "./evolutionClient";
import { getValidator, loadBlueprint } from "./plutusBlueprint";
import { stripOneCborByteStringWrapper } from "./scriptBytes";
import {
  inlineDatum,
  toAddress,
  toAssets,
  toTxInput,
  txHashHex,
} from "./txAdapters";
import { adaptUtxo, adaptUtxos, type UTxO } from "./utxo";

// silence unused-import flagging for KeyHash + TransactionHash — they
// surface as types in builder signatures; runtime values flow elsewhere
void KeyHash;
void TransactionHash;

// Treasury min-UTxO is computed by Evolution's auto-min-UTxO calculator
// at build time (per the output's actual serialized byte size — typically
// ~1.03 ADA for our 32-byte inline datum). The validator's S9 only
// requires `treasury.lovelace >= cfg.protocol_fee`, so overpaying is
// safe but wasteful. Passing `autoMinUtxo: true` on the payToAddress
// lets Evolution bump only when protocol_fee falls below the chain min,
// instead of our previous hardcoded 1.2 ADA floor that overpaid by
// ~170k lovelace per swap.

/**
 * Local Network discriminator. Stays as a string so callers don't have
 * to import Evolution's network constants; we resolve to the actual
 * value inside this module.
 */
export type Network = "Preprod" | "Preview" | "Mainnet";

function resolveNetworkId(network: Network): 0 | 1 {
  return network === "Mainnet" ? 1 : 0;
}

function resolveNetwork(network: Network): typeof preprod | typeof preview | typeof mainnet {
  switch (network) {
    case "Mainnet":
      return mainnet;
    case "Preview":
      return preview;
    default:
      return preprod;
  }
}

/* -------------------------------------------------------------------------- */
/* UTxO type: re-exported from the adapter for caller convenience.            */
/* -------------------------------------------------------------------------- */

export type { UTxO } from "./utxo";

export type BuildSwapInput = {
  network: Network;
  /** 28-byte hex policy id of the dead collection. */
  collectionPolicyHex: string;
  /** 28-byte hex policy id of the config NFT (= listing-script param). */
  configNftPolicyHex: string;
  /** Bech32 listing-script address (must equal `applyParams(listing, configNftPolicy)` hash). */
  listingScriptAddress: string;
  /** Bech32 treasury address (decoded from {@code cfg.treasury_addr}). */
  treasuryAddrBech32: string;
  /** From {@code ConfigDatum.protocol_fee}. */
  protocolFeeLovelace: bigint;
  /** From {@code ConfigDatum.lister_fee} (≥ MIN_LISTER_FEE = 1 ADA). */
  listerFeeLovelace: bigint;

  /** Consumed listing — SPEC's "NA" carrier. */
  consumed: UTxO;
  consumedAssetNameHex: string;
  consumedListerPkhHex: string;

  /** Swapper's deposit (NB) — bound to its wallet UTxO. */
  depositUtxo: UTxO;
  depositAssetNameHex: string;

  /** Config UTxO at `Address(ScriptCredential(configNftPolicy))` — CIP-31 ref input. */
  configUtxo: UTxO;
};

export type SwapResult = {
  txHash: string;
  successorOutRef: { txHash: string; outputIndex: number };
  outputTagHex: string;
};

/* -------------------------------------------------------------------------- */
/* Applied listing script — pure helper (no client needed)                    */
/* -------------------------------------------------------------------------- */

export type AppliedListing = {
  /** Double-CBOR-encoded applied script hex (the form to pass to attachScript). */
  appliedScript: string;
  scriptHash: string;
  address: string;
  /** PlutusV3 wrapper around the SINGLE-CBOR form, ready for attachScript. */
  validator: PlutusV3.PlutusV3;
};

/**
 * Apply {@code config_nft_policy} as the listing validator's parameter,
 * returning the compiled script + its enterprise address.
 *
 * <p>The applied output from {@code UPLC.applyParamsToScript} is
 * double-CBOR encoded (same as Aiken emits). Evolution's
 * {@code new PlutusV3({bytes})} expects the SINGLE-CBOR form — strip
 * one wrapper. See {@code scriptBytes.ts} and the parity test pinning
 * this asymmetry.
 */
export async function applyListingScript(
  network: Network,
  configNftPolicyHex: string,
): Promise<AppliedListing> {
  if (!/^[0-9a-fA-F]{56}$/.test(configNftPolicyHex)) {
    throw new Error("config_nft_policy must be 56 hex chars (28 bytes)");
  }
  const blueprint = await loadBlueprint();
  const v = getValidator(blueprint, "listing.listing.spend");
  const appliedScript = UPLC.applyParamsToScript(v.compiledCode, [
    Data.bytearray(configNftPolicyHex.toLowerCase()),
  ]);

  const innerHex = stripOneCborByteStringWrapper(appliedScript);
  const validator = new PlutusV3.PlutusV3({
    bytes: Bytes.fromHex(innerHex),
  });

  const sh = ScriptHash.fromScript(validator);
  const scriptHash = ScriptHash.toHex(sh);
  const networkId = resolveNetworkId(network);
  const cred = Credential.makeScriptHash(ScriptHash.toBytes(sh));
  const addr = new Address.Address({
    networkId,
    paymentCredential: cred,
  });
  const address = Address.toBech32(addr);

  return { appliedScript, scriptHash, address, validator };
}

/* -------------------------------------------------------------------------- */
/* compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))               */
/* -------------------------------------------------------------------------- */

function computeOutputTag(txHashHex: string, outputIndex: number): Uint8Array {
  const orefCbor = serialiseOutputReference(hexToBytes(txHashHex), outputIndex);
  return blake2b(orefCbor, { dkLen: 32 });
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/* -------------------------------------------------------------------------- */
/* Listing datum decoding (read lister_pkh from consumed UTxO)                 */
/* -------------------------------------------------------------------------- */

/**
 * Decode the inline datum of a listing UTxO and extract {@code lister_pkh}.
 * Listing datum shape: {@code Constr 0 [bytes(lister_pkh), Option<bytes>(update_ref)]}.
 *
 * <p>Evolution's {@code Data.fromCBORHex} returns a plain object for
 * Constr values: {@code {index: bigint, fields: Data[]}}. ByteString
 * fields decode as {@code Uint8Array}.
 */
export function decodeConsumedListerPkh(consumed: UTxO): string {
  if (!consumed.datum) {
    throw new Error(
      `consumed UTxO ${consumed.txHash}#${consumed.outputIndex} has no inline datum`,
    );
  }
  let decoded: unknown;
  try {
    decoded = Data.fromCBORHex(consumed.datum);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `consumed UTxO ${consumed.txHash}#${consumed.outputIndex} datum did not parse: ${msg}`,
    );
  }
  if (!Data.isConstr(decoded)) {
    throw new Error("listing datum is not a Constr");
  }
  const c = decoded as { index: bigint; fields: ReadonlyArray<unknown> };
  if (c.index !== 0n) {
    throw new Error(`listing datum is Constr ${c.index}, expected Constr 0`);
  }
  const listerField = c.fields[0];
  if (!(listerField instanceof Uint8Array)) {
    throw new Error("listing datum field 0 (lister_pkh) is not a byte string");
  }
  if (listerField.length !== 28) {
    throw new Error(
      `lister_pkh has unexpected length ${listerField.length}, want 28`,
    );
  }
  return bytesToHex(listerField).toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Plutus Data builders                                                        */
/* -------------------------------------------------------------------------- */

/** Successor listing datum: Constr 0 [lister_pkh, Some(output_tag)]. */
function buildSuccessorDatum(
  listerPkhHex: string,
  outputTagHex: string,
): Data.Data {
  return Data.constr(0n, [
    Data.bytearray(listerPkhHex),
    Data.constr(0n, [Data.bytearray(outputTagHex)]),
  ]);
}

/** Swap redeemer: Constr 0 [nb_asset_name, listing_idx, treasury_idx]. */
function buildSwapRedeemer(
  nbAssetNameHex: string,
  listingOutputIndex: bigint,
  treasuryOutputIndex: bigint,
): Data.Data {
  return Data.constr(0n, [
    Data.bytearray(nbAssetNameHex),
    Data.int(listingOutputIndex),
    Data.int(treasuryOutputIndex),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build, sign, and submit the swap tx. Returns the tx hash + the
 * successor's outref (`{txHash}#0`).
 */
export async function submitSwap(
  client: EvolutionClient,
  input: BuildSwapInput,
): Promise<SwapResult> {
  if (!/^[0-9a-fA-F]{56}$/.test(input.collectionPolicyHex)) {
    throw new Error("collectionPolicyHex must be 56 hex chars");
  }
  if (input.listerFeeLovelace < 0n || input.protocolFeeLovelace < 0n) {
    throw new Error("fees must be ≥ 0");
  }

  const collectionPolicy = input.collectionPolicyHex.toLowerCase();
  const consumedAssetName = input.consumedAssetNameHex.toLowerCase();
  const depositAssetName = input.depositAssetNameHex.toLowerCase();

  const naUnit = collectionPolicy + consumedAssetName;
  const nbUnit = collectionPolicy + depositAssetName;

  // Sanity: deposit UTxO must actually carry NB; consumed UTxO must carry NA.
  if (!(naUnit in input.consumed.assets)) {
    throw new Error(
      `consumed UTxO ${input.consumed.txHash}#${input.consumed.outputIndex} ` +
        `does not carry NA (${naUnit})`,
    );
  }
  if (!(nbUnit in input.depositUtxo.assets)) {
    throw new Error(
      `deposit UTxO ${input.depositUtxo.txHash}#${input.depositUtxo.outputIndex} ` +
        `does not carry NB (${nbUnit})`,
    );
  }

  const applied = await applyListingScript(
    input.network,
    input.configNftPolicyHex,
  );
  // Fast-fail: BE-supplied address must equal what we just derived.
  if (applied.address !== input.listingScriptAddress) {
    throw new Error(
      `listing script address mismatch — derived=${applied.address}, BE=${input.listingScriptAddress}`,
    );
  }

  // Cross-check the BE-supplied lister_pkh against the actual consumed
  // datum (S4 preservation is on-chain; this is a fail-fast).
  const datumListerPkh = decodeConsumedListerPkh(input.consumed);
  if (datumListerPkh !== input.consumedListerPkhHex.toLowerCase()) {
    throw new Error(
      `consumed lister_pkh disagreement — datum=${datumListerPkh}, BE=${input.consumedListerPkhHex}`,
    );
  }

  const outputTagBytes = computeOutputTag(
    input.consumed.txHash,
    input.consumed.outputIndex,
  );
  const outputTagHex = bytesToHex(outputTagBytes);

  // Successor datum (Constr) + treasury datum (raw bytes) + swap redeemer.
  const successorDatum = buildSuccessorDatum(
    input.consumedListerPkhHex.toLowerCase(),
    outputTagHex,
  );
  // Treasury inline datum is bare ByteArray(output_tag) per S8.
  const treasuryDatum: Data.Data = Data.bytearray(outputTagHex);
  const swapRedeemer = buildSwapRedeemer(depositAssetName, 0n, 1n);

  // S6: successor lovelace = consumed + listerFee.
  // Treasury lovelace = protocolFee (Evolution auto-bumps to chain min
  // via autoMinUtxo on the payToAddress call below).
  const consumedLovelace = input.consumed.assets.lovelace ?? 0n;
  const successorLovelace = consumedLovelace + input.listerFeeLovelace;
  const treasuryLovelace = input.protocolFeeLovelace;

  const built = await client
    .newTx()
    .readFrom({ referenceInputs: [input.configUtxo._evolution] })
    .collectFrom({
      inputs: [input.consumed._evolution],
      redeemer: swapRedeemer,
    })
    // Pin the deposit-bearing wallet UTxO into the inputs so the
    // balancer doesn't pick an ADA-only UTxO and leave change with a
    // negative NB qty.
    .collectFrom({ inputs: [input.depositUtxo._evolution] })
    // S3 + S5 + S6: successor listing at index 0.
    .payToAddress({
      address: toAddress(input.listingScriptAddress),
      assets: toAssets({ lovelace: successorLovelace, [nbUnit]: 1n }),
      datum: inlineDatum(successorDatum),
    })
    // S7 + S8 + S9: treasury at index 1. autoMinUtxo bumps lovelace
    // to the chain-computed min if cfg.protocol_fee falls below it
    // (S9 is `>=`, so overpaying is safe).
    .payToAddress({
      address: toAddress(input.treasuryAddrBech32),
      assets: toAssets({ lovelace: treasuryLovelace }),
      datum: inlineDatum(treasuryDatum),
      autoMinUtxo: true,
    })
    .attachScript({ script: applied.validator })
    .build();

  // Post-build safety check: the validator's S5 + S7 read tx.outputs[0]
  // and tx.outputs[1]. We authored them in that order, but verify
  // Evolution didn't reorder during balancing. Goes through
  // built.toTransaction() to inspect the assembled tx body — the
  // earlier built.outputs cast was inert (no such surface in 0.5.8).
  const tx = await built.toTransaction();
  assertOutputOrder(tx.body.outputs, {
    listingScriptAddress: input.listingScriptAddress,
    treasuryAddrBech32: input.treasuryAddrBech32,
  });

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return {
    txHash,
    successorOutRef: { txHash, outputIndex: 0 },
    outputTagHex,
  };
}

/* -------------------------------------------------------------------------- */
/* Post-build tx-output assertion                                              */
/* -------------------------------------------------------------------------- */

/**
 * Throw if {@code outputs[0]} isn't the listing-script successor or
 * {@code outputs[1]} isn't the treasury output. SPEC §6.3 S5/S7 read
 * those positional indices.
 */
function assertOutputOrder(
  outputs: ReadonlyArray<unknown>,
  expected: { listingScriptAddress: string; treasuryAddrBech32: string },
): void {
  if (outputs.length < 2) {
    throw new Error(
      `assembled tx has only ${outputs.length} output(s); expected at least 2`,
    );
  }
  const addr0 = txOutputAddressBech32(outputs[0]);
  const addr1 = txOutputAddressBech32(outputs[1]);
  if (addr0 !== expected.listingScriptAddress) {
    throw new Error(
      `output[0] is ${addr0}, expected listing script ${expected.listingScriptAddress}`,
    );
  }
  if (addr1 !== expected.treasuryAddrBech32) {
    throw new Error(
      `output[1] is ${addr1}, expected treasury ${expected.treasuryAddrBech32}`,
    );
  }
}

/**
 * Best-effort extraction of a tx output's bech32 address. Evolution's
 * {@code TxOut.TransactionOutput} may carry the address either as a
 * typed class (with {@code Address.toBech32}) or as a Babbage-format
 * record. Both shapes are handled.
 */
export function txOutputAddressBech32(output: unknown): string {
  if (!output || typeof output !== "object") {
    throw new Error("output is not an object");
  }
  const o = output as { address?: unknown };
  if (o.address && typeof o.address === "object") {
    try {
      return Address.toBech32(o.address as Address.Address);
    } catch {
      // fall through to other shape attempts
    }
  }
  if (typeof o.address === "string") return o.address;
  throw new Error("could not extract bech32 from tx output");
}

/* -------------------------------------------------------------------------- */
/* UTxO lookup helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Find the config UTxO at `Address(ScriptCredential(configNftPolicy))`.
 * Single match expected (one-shot mint).
 */
export async function findConfigUtxo(
  client: EvolutionClient,
  network: Network,
  configNftPolicyHex: string,
): Promise<UTxO> {
  const policyLower = configNftPolicyHex.toLowerCase();
  const networkId = resolveNetworkId(network);
  const cred = Credential.makeScriptHash(Bytes.fromHex(policyLower));
  const addr = new Address.Address({ networkId, paymentCredential: cred });
  const configAddress = Address.toBech32(addr);

  // client.getUtxos accepts the Address class instance.
  const adapted = adaptUtxos(await client.getUtxos(addr));
  const hits = adapted.filter((u: UTxO) => {
    if (!u.datum) return false;
    return Object.entries(u.assets).some(
      ([unit, qty]) =>
        unit !== "lovelace" &&
        unit.toLowerCase().startsWith(policyLower) &&
        qty === 1n,
    );
  });
  if (hits.length === 0) {
    throw new Error(
      `config UTxO not found at ${configAddress} for policy ${configNftPolicyHex}`,
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `multiple UTxOs at config address for policy ${configNftPolicyHex} — chain-impossible for a one-shot mint`,
    );
  }
  return hits[0];
}

/** Find the connected wallet UTxO that physically holds {@code unit} (qty 1). */
export async function findUtxoCarrying(
  client: EvolutionClient,
  unit: string,
): Promise<UTxO | null> {
  const adapted = adaptUtxos(await client.getWalletUtxos());
  for (const u of adapted) {
    if (u.assets[unit] === 1n) return u;
  }
  return null;
}

/** Fetch a single UTxO by outRef. */
export async function fetchUtxoByOutRef(
  client: EvolutionClient,
  txHash: string,
  outputIndex: number,
): Promise<UTxO> {
  const utxos = await client.getUtxosByOutRef([
    toTxInput(txHash, outputIndex),
  ]);
  if (utxos.length === 0) {
    throw new Error(`UTxO ${txHash}#${outputIndex} not found`);
  }
  return adaptUtxo(utxos[0]);
}

// Silence unused-import warnings while the network constants are only
// indirectly used through resolveNetwork.
void resolveNetwork;
