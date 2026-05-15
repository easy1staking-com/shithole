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
 * <p>The caller supplies the {@code (consumed listing, deposit NFT)}
 * pair (bucket-matched off-chain). This builder does NOT search for a
 * match — it assumes the caller already used {@code computeMatches()}.
 */

import {
  CML,
  Constr,
  Data,
  applyParamsToScript,
  credentialToAddress,
  mintingPolicyToId,
  scriptHashToCredential,
  type LucidEvolution,
  type Network,
  type SpendingValidator,
  type UTxO,
} from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";

import { serialiseOutputReference, hexToBytes } from "@/lib/pit/bucketMath";

import { getValidator, loadBlueprint } from "./plutusBlueprint";

/** Conservative min-UTxO floor for the treasury output (small inline datum). */
const TREASURY_MIN_UTXO_LOVELACE = 1_200_000n;

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

  /**
   * The consumed listing — SPEC's "NA" carrier (asset name = NA).
   * Caller supplies the full UTxO (looked up by outRef via Lucid).
   */
  consumed: UTxO;
  /** Hex asset name of the asset carried in {@code consumed} (NA). */
  consumedAssetNameHex: string;
  /** Hex pkh of the original lister (decoded from the consumed UTxO's datum). */
  consumedListerPkhHex: string;

  /**
   * The swapper's deposit NFT — SPEC's "NB" (asset name = NB). The UTxO
   * is the wallet UTxO that physically holds NB; we must include it as
   * an explicit input so the Lucid balancer doesn't pick a different
   * ADA-bearing UTxO (which would leave change with a negative NB qty).
   */
  depositUtxo: UTxO;
  /** Hex asset name of the deposit (NB). Matches what's in {@code depositUtxo.assets}. */
  depositAssetNameHex: string;

  /** The config UTxO at `Address(ScriptCredential(configNftPolicy))`. Used as CIP-31 ref input. */
  configUtxo: UTxO;
};

export type SwapResult = {
  txHash: string;
  successorOutRef: { txHash: string; outputIndex: number };
  /** Hex of the compute_output_tag — handy for the BE indexer log line. */
  outputTagHex: string;
};

/* -------------------------------------------------------------------------- */
/* Applied listing script — pure helper (no wallet needed)                    */
/* -------------------------------------------------------------------------- */

export type AppliedListing = {
  appliedScript: string;
  scriptHash: string;
  address: string;
  validator: SpendingValidator;
};

/**
 * Apply {@code config_nft_policy} as the listing validator's parameter,
 * returning the compiled script + its enterprise address. Mirrors the
 * BE's {@code ListingScriptAddressDeriver}.
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
  // Param is `config_nft_policy: PolicyId` — a bare ByteArray in Plutus Data.
  // Evolution SDK encodes a `Data` string as ByteString.
  const appliedScript = applyParamsToScript(
    v.compiledCode,
    [configNftPolicyHex.toLowerCase()],
  );
  const validator: SpendingValidator = {
    type: "PlutusV3",
    script: appliedScript,
  };
  // Evolution exposes mintingPolicyToId, which is just blake2b-224 of the
  // serialized script — same hash for spending validators.
  const scriptHash = mintingPolicyToId(validator);
  const address = credentialToAddress(
    network,
    scriptHashToCredential(scriptHash),
  );
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
/* Plutus Data builders                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Successor listing datum: {@code Constr 0 [lister_pkh: bytes, update_ref: Option<bytes>]}
 * with {@code update_ref = Some(output_tag)}.
 */
function buildSuccessorDatum(
  listerPkhHex: string,
  outputTagHex: string,
): string {
  const someOutputTag = new Constr(0, [outputTagHex]);
  return Data.to(new Constr(0, [listerPkhHex, someOutputTag]));
}

/**
 * Swap redeemer: {@code Constr 0 [nb_asset_name: bytes, listing_output_index: int, treasury_output_index: int]}.
 * Listing successor sits at index 0, treasury at index 1 (deterministic
 * order is the on-chain S5/S7 expectation).
 */
function buildSwapRedeemer(
  nbAssetNameHex: string,
  listingOutputIndex: bigint,
  treasuryOutputIndex: bigint,
): string {
  return Data.to(new Constr(0, [
    nbAssetNameHex,
    listingOutputIndex,
    treasuryOutputIndex,
  ]));
}

/* -------------------------------------------------------------------------- */
/* Listing datum decoding (read lister_pkh from consumed UTxO)                 */
/* -------------------------------------------------------------------------- */

/**
 * Decode the inline datum of a listing UTxO and extract {@code lister_pkh}
 * (the 28-byte hex pkh of the original lister). Listing datum shape per
 * SPEC §3.2: {@code Constr 0 [bytes(lister_pkh), Option<bytes>(update_ref)]}.
 *
 * <p>The TS port mirrors the BE's {@code ListingDatumDecoder} so we don't
 * trust the BE-supplied {@code lister_pkh} blindly — a typo or MITM there
 * would yield a doomed tx + bad UX. If the consumed UTxO has no inline
 * datum, throws (the listing pool filter only ever shows UTxOs with one).
 */
export function decodeConsumedListerPkh(consumed: UTxO): string {
  if (!consumed.datum) {
    throw new Error(
      `consumed UTxO ${consumed.txHash}#${consumed.outputIndex} has no inline datum`,
    );
  }
  let decoded: Data;
  try {
    decoded = Data.from(consumed.datum);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `consumed UTxO ${consumed.txHash}#${consumed.outputIndex} datum did not parse: ${msg}`,
    );
  }
  if (!(decoded instanceof Constr) || decoded.index !== 0) {
    throw new Error("listing datum is not Constr 0");
  }
  const listerField = decoded.fields[0];
  if (typeof listerField !== "string") {
    throw new Error("listing datum field 0 (lister_pkh) is not a byte string");
  }
  // Plutus Data byte strings round-trip as lowercase hex through Lucid.
  if (!/^[0-9a-fA-F]{56}$/.test(listerField)) {
    throw new Error(`lister_pkh has unexpected shape: ${listerField}`);
  }
  return listerField.toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build, sign, and submit the swap tx. Returns the tx hash + the
 * successor's outref (`{txHash}#0`) so the caller can drive cache
 * invalidation and (optionally) wait for confirmation.
 *
 * <p>Throws on builder / sign / submit failure. The caller surfaces the
 * error to the UI ("your shit got stuck in the pipes").
 */
export async function submitSwap(
  lucid: LucidEvolution,
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
  // Fast-fail: BE-supplied address must equal what we just derived. A
  // mismatch would fail on-chain (S3 / script witnessing) but a local
  // check surfaces the misconfiguration cleanly before the wallet prompts.
  if (applied.address !== input.listingScriptAddress) {
    throw new Error(
      `listing script address mismatch — derived=${applied.address}, BE=${input.listingScriptAddress}`,
    );
  }
  const validator = applied.validator;

  // Cross-check the BE-supplied lister_pkh against the actual consumed
  // datum. If they disagree, the tx would build but the validator would
  // reject it (S4 requires lister_pkh preservation), so we'd burn fees
  // on a doomed submission. Fail fast.
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

  // Successor listing inline datum (Constr) — successor sits at output index 0.
  const successorDatum = buildSuccessorDatum(
    input.consumedListerPkhHex.toLowerCase(),
    outputTagHex,
  );

  // Treasury inline datum = raw bytes(output_tag). On-chain S8 expects
  // bare ByteArray, NOT a Constr wrapper. Evolution encodes a hex string
  // passed to Data.to as ByteString.
  const treasuryDatum = Data.to(outputTagHex);

  // S5: redeemer.nb_asset_name names the asset in the successor listing
  // output = the deposit's asset name.
  const swapRedeemer = buildSwapRedeemer(depositAssetName, 0n, 1n);

  // Successor carries NB + (consumed.lovelace + listerFee). Lovelace
  // accrues on the listing UTxO itself; SPEC §6.3 S6.
  const consumedLovelace = input.consumed.assets.lovelace ?? 0n;
  const successorLovelace = consumedLovelace + input.listerFeeLovelace;
  const treasuryLovelace =
    input.protocolFeeLovelace > TREASURY_MIN_UTXO_LOVELACE
      ? input.protocolFeeLovelace
      : TREASURY_MIN_UTXO_LOVELACE;

  const tx = await lucid
    .newTx()
    // CIP-31 reference input — config UTxO, never spent.
    .readFrom([input.configUtxo])
    // S2: consumed listing input with the Swap redeemer.
    .collectFrom([input.consumed], swapRedeemer)
    // Force the deposit-bearing wallet UTxO into the inputs; without this
    // the auto-selector picks an ADA-only UTxO and change ends up with
    // negative NB qty (see PreprodSwapTool.java:312).
    .collectFrom([input.depositUtxo])
    // S3 + S5 + S6: successor listing at index 0.
    .pay.ToAddressWithData(
      input.listingScriptAddress,
      { kind: "inline", value: successorDatum },
      { lovelace: successorLovelace, [nbUnit]: 1n },
    )
    // S7 + S8 + S9: treasury at index 1.
    .pay.ToAddressWithData(
      input.treasuryAddrBech32,
      { kind: "inline", value: treasuryDatum },
      { lovelace: treasuryLovelace },
    )
    .attach.SpendingValidator(validator)
    .complete();

  // Post-complete safety check: the validator's S5 + S7 invariants read
  // tx.outputs[0] and tx.outputs[1]. We authored them in that order, but
  // verify Lucid didn't shuffle (defense against future SDK changes — the
  // Java tool used `mergeOutputs(false)` for the same reason). Decode
  // the assembled tx body via CML and compare addresses on the first two
  // outputs.
  assertOutputOrder(tx.toTransaction(), {
    listingScriptAddress: input.listingScriptAddress,
    treasuryAddrBech32: input.treasuryAddrBech32,
  });

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  return {
    txHash,
    successorOutRef: { txHash, outputIndex: 0 },
    outputTagHex,
  };
}

/* -------------------------------------------------------------------------- */
/* Post-complete tx-output assertion                                            */
/* -------------------------------------------------------------------------- */

/**
 * Throw if {@code outputs[0]} isn't the listing-script successor or
 * {@code outputs[1]} isn't the treasury output. The swap validator's
 * S5 (listing successor at index 0) + S7 (treasury at index 1) depend
 * on this order; the Java reference relied on `mergeOutputs(false)` to
 * guarantee it, but Lucid Evolution preserves declaration order. This
 * is a belt-and-braces check so a future SDK change can't silently
 * shuffle outputs and let us submit a doomed tx.
 */
function assertOutputOrder(
  cmlTx: CML.Transaction,
  expected: { listingScriptAddress: string; treasuryAddrBech32: string },
): void {
  const outputs = cmlTx.body().outputs();
  if (outputs.len() < 2) {
    throw new Error(
      `assembled tx has only ${outputs.len()} output(s); expected at least 2`,
    );
  }
  const out0Addr = outputs.get(0).address().to_bech32();
  const out1Addr = outputs.get(1).address().to_bech32();
  if (out0Addr !== expected.listingScriptAddress) {
    throw new Error(
      `output[0] is ${out0Addr}, expected listing script ${expected.listingScriptAddress}`,
    );
  }
  if (out1Addr !== expected.treasuryAddrBech32) {
    throw new Error(
      `output[1] is ${out1Addr}, expected treasury ${expected.treasuryAddrBech32}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* UTxO lookup helpers (caller composes these into one orchestrator)          */
/* -------------------------------------------------------------------------- */

/**
 * Find the config UTxO at {@code Address(ScriptCredential(configNftPolicy))}.
 * Returns the (single) UTxO whose value carries an asset under
 * {@code configNftPolicy} with quantity 1 and an inline datum. Throws on
 * "not found" or "more than one" (chain-impossible for a one-shot mint).
 */
export async function findConfigUtxo(
  lucid: LucidEvolution,
  network: Network,
  configNftPolicyHex: string,
): Promise<UTxO> {
  const policyLower = configNftPolicyHex.toLowerCase();
  const configAddress = credentialToAddress(
    network,
    scriptHashToCredential(policyLower),
  );
  const utxos = await lucid.utxosAt(configAddress);
  const hits = utxos.filter((u) => {
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

/**
 * Find the connected wallet UTxO that physically holds {@code unit} (qty 1).
 * Returns the first such UTxO (stable order: wallet UTxOs come back in
 * provider-defined order, so this is "first-served" rather than balanced).
 */
export async function findUtxoCarrying(
  lucid: LucidEvolution,
  unit: string,
): Promise<UTxO | null> {
  const utxos = await lucid.wallet().getUtxos();
  for (const u of utxos) {
    if (u.assets[unit] === 1n) return u;
  }
  return null;
}

/**
 * Fetch a single UTxO by outRef. Wraps Evolution's `utxosByOutRef`,
 * which returns an array.
 */
export async function fetchUtxoByOutRef(
  lucid: LucidEvolution,
  txHash: string,
  outputIndex: number,
): Promise<UTxO> {
  const utxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);
  if (utxos.length === 0) {
    throw new Error(`UTxO ${txHash}#${outputIndex} not found`);
  }
  return utxos[0];
}
