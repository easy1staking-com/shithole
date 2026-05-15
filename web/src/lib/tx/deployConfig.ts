/**
 * Build + submit the config-deploy tx (SPEC §5.1).
 *
 * Steps:
 *   1. Apply the seed UTxO as OutputReference param to config.config.mint.
 *   2. Derive policy id (= script hash of the applied code).
 *   3. Build ConfigDatum (Constr 0 [m, protocol_fee, lister_fee,
 *      treasury_addr, admin_pkh]).
 *   4. Tx: spend seed UTxO, mint 1×(policyId, collection_policy_id_28b),
 *      attach minting policy, pay-to-script with inline datum + the NFT.
 *
 * Migrated from @lucid-evolution/lucid to @evolution-sdk/evolution.
 */

import {
  Address,
  Bytes,
  Credential,
  Data,
  PlutusV3,
  ScriptHash,
  UPLC,
} from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { getValidator, loadBlueprint } from "./plutusBlueprint";
import { stripOneCborByteStringWrapper } from "./scriptBytes";
import type { Network } from "./swap";
import { inlineDatum, toAddress, toAssets, txHashHex } from "./txAdapters";
import type { UTxO } from "./utxo";

export type DeployConfigInput = {
  collectionPolicyId: string;
  m: number;
  protocolFeeLovelace: bigint;
  listerFeeLovelace: bigint;
  treasuryAddrBech32: string;
  adminPkhHex: string;
  seedUtxo: UTxO;
  network: Network;
};

export type DeployConfigResult = {
  txHash: string;
  configNftPolicy: string;
  scriptAddress: string;
  collectionPolicyId: string;
  appliedCompiledCode: string;
};

const MIN_LISTER_FEE_LOVELACE = 1_000_000n;

function networkId(network: Network): 0 | 1 {
  return network === "Mainnet" ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Plutus Data builders                                                       */
/* -------------------------------------------------------------------------- */

/** OutputReference = Constr 0 [bytes(tx_id), int(output_index)]. */
function outputReferenceData(utxo: UTxO) {
  return Data.constr(0n, [
    Data.bytearray(utxo.txHash),
    Data.int(BigInt(utxo.outputIndex)),
  ]);
}

/**
 * Aiken Address Plutus Data:
 *   Constr 0 [payment_credential, stake_credential]
 * payment_credential: Constr 0 [bytes] (VerificationKey) | Constr 1 [bytes] (Script)
 * stake_credential: Constr 0 [Constr 0 [credential]] (Some(Inline(...))) | Constr 1 [] (None)
 */
function addressData(details: {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
}) {
  const paymentCred = Data.constr(
    details.paymentCredentialType === "verification_key" ? 0n : 1n,
    [Data.bytearray(details.paymentKeyHashHex)],
  );
  let stakeCredOption;
  if (details.stakeCredentialHashHex && details.stakeCredentialType) {
    const stakeInner = Data.constr(
      details.stakeCredentialType === "verification_key" ? 0n : 1n,
      [Data.bytearray(details.stakeCredentialHashHex)],
    );
    const inline = Data.constr(0n, [stakeInner]); // Inline
    stakeCredOption = Data.constr(0n, [inline]); // Some
  } else {
    stakeCredOption = Data.constr(1n, []); // None
  }
  return Data.constr(0n, [paymentCred, stakeCredOption]);
}

/** Decompose a bech32 address into the parts we need for addressData(). */
function decomposeAddress(bech32: string): {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
} {
  const addr = Address.fromBech32(bech32);
  // Address shape in @evolution-sdk/evolution@0.5.8:
  //   { networkId, paymentCredential: { _tag: 'KeyHash'|'ScriptHash', hash: Uint8Array(28) },
  //     stakingCredential?: { _tag, hash: Uint8Array(28) } }
  // The hash is Uint8Array — the JSON form via .toJSON() converts to hex
  // string, but the live runtime value is bytes. Hex-encode here.
  const a = addr as unknown as {
    paymentCredential: { _tag: "KeyHash" | "ScriptHash"; hash: Uint8Array };
    stakingCredential?: { _tag: "KeyHash" | "ScriptHash"; hash: Uint8Array };
  };
  return {
    paymentKeyHashHex: bytesToHex(a.paymentCredential.hash),
    paymentCredentialType:
      a.paymentCredential._tag === "KeyHash" ? "verification_key" : "script",
    stakeCredentialHashHex: a.stakingCredential
      ? bytesToHex(a.stakingCredential.hash)
      : null,
    stakeCredentialType: a.stakingCredential
      ? a.stakingCredential._tag === "KeyHash"
        ? "verification_key"
        : "script"
      : null,
  };
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function buildConfigDatum(args: {
  m: bigint;
  protocolFee: bigint;
  listerFee: bigint;
  treasuryAddrConstr: ReturnType<typeof addressData>;
  adminPkhHex: string;
}): Data.Data {
  // ConfigDatum: Constr 0 [m, protocol_fee, lister_fee, treasury_addr, admin_pkh]
  return Data.constr(0n, [
    Data.int(args.m),
    Data.int(args.protocolFee),
    Data.int(args.listerFee),
    args.treasuryAddrConstr,
    Data.bytearray(args.adminPkhHex),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Apply seed_utxo to config validator                                         */
/* -------------------------------------------------------------------------- */

export type AppliedConfig = {
  /** Double-CBOR-encoded applied script hex. */
  appliedScript: string;
  /** Hex script hash = policy id. */
  policyId: string;
  /** Evolution PlutusV3 wrapper for attachScript / minting. */
  policy: PlutusV3.PlutusV3;
};

export async function applyConfigSeed(seedUtxo: UTxO): Promise<AppliedConfig> {
  const blueprint = await loadBlueprint();
  const mintHandler = getValidator(blueprint, "config.config.mint");
  const appliedScript = UPLC.applyParamsToScript(mintHandler.compiledCode, [
    outputReferenceData(seedUtxo),
  ]);
  const innerHex = stripOneCborByteStringWrapper(appliedScript);
  const policy = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(innerHex) });
  const policyId = ScriptHash.toHex(ScriptHash.fromScript(policy));
  return { appliedScript, policyId, policy };
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

export async function deployConfig(
  client: EvolutionClient,
  input: DeployConfigInput,
): Promise<DeployConfigResult> {
  if (input.listerFeeLovelace < MIN_LISTER_FEE_LOVELACE) {
    throw new Error(
      `lister_fee must be >= ${MIN_LISTER_FEE_LOVELACE} lovelace (MIN_LISTER_FEE floor)`,
    );
  }
  if (input.m < 1) throw new Error("m must be >= 1");
  if (input.protocolFeeLovelace < 0n)
    throw new Error("protocol_fee must be >= 0");
  if (!/^[0-9a-fA-F]{56}$/.test(input.collectionPolicyId))
    throw new Error("collection_policy_id must be 56 hex chars (28 bytes)");
  if (!/^[0-9a-fA-F]{56}$/.test(input.adminPkhHex))
    throw new Error("admin_pkh must be 56 hex chars (28 bytes)");

  const applied = await applyConfigSeed(input.seedUtxo);

  // Enterprise script address — addr(ScriptCredential(policyId)), no stake.
  const cred = Credential.makeScriptHash(Bytes.fromHex(applied.policyId));
  const scriptAddrObj = new Address.Address({
    networkId: networkId(input.network),
    paymentCredential: cred,
  });
  const scriptAddress = Address.toBech32(scriptAddrObj);

  // Treasury Plutus Data.
  const treasury = decomposeAddress(input.treasuryAddrBech32);
  const treasuryAddrConstr = addressData(treasury);

  const configDatum = buildConfigDatum({
    m: BigInt(input.m),
    protocolFee: input.protocolFeeLovelace,
    listerFee: input.listerFeeLovelace,
    treasuryAddrConstr,
    adminPkhHex: input.adminPkhHex.toLowerCase(),
  });

  const unit = applied.policyId + input.collectionPolicyId.toLowerCase();
  const mintFlatAssets = { [unit]: 1n };
  const outputFlatAssets = { lovelace: 2_000_000n, ...mintFlatAssets };

  // Mint redeemer is Void — Aiken encodes Void as Constr 0 [].
  const redeemer: Data.Data = Data.constr(0n, []);

  const built = await client
    .newTx()
    .collectFrom({ inputs: [input.seedUtxo._evolution] })
    .mintAssets({ assets: toAssets(mintFlatAssets), redeemer })
    .attachScript({ script: applied.policy })
    .payToAddress({
      address: toAddress(scriptAddress),
      assets: toAssets(outputFlatAssets),
      datum: inlineDatum(configDatum),
    })
    .build();

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return {
    txHash,
    configNftPolicy: applied.policyId,
    scriptAddress,
    collectionPolicyId: input.collectionPolicyId.toLowerCase(),
    appliedCompiledCode: applied.appliedScript,
  };
}
