/**
 * Build + submit the config-deploy tx (SPEC §5.1).
 *
 * Steps:
 *   1. Pick a seed UTxO from the connected wallet (input: caller-chosen
 *      or first ≥ 5 ADA UTxO).
 *   2. Apply the seed UTxO as `OutputReference` parameter to the
 *      multi-handler `config.config.mint` compiled code.
 *   3. Compute the resulting policy id = blake2b-224 of the applied
 *      script bytes (Evolution SDK does this for us).
 *   4. Build a `ConfigDatum` Plutus Data value matching SPEC §3.1.
 *   5. Build a tx that:
 *      - consumes the seed UTxO,
 *      - mints 1× (policyId, collection_policy_id_28_bytes),
 *      - attaches the applied script as a minting policy,
 *      - outputs to the script enterprise address with inline `ConfigDatum`
 *        + the minted NFT.
 *   6. Sign + submit via the wallet.
 *
 * Returns `{ txHash, configNftPolicy, scriptAddress }`.
 */

import {
  Constr,
  Data,
  applyParamsToScript,
  credentialToAddress,
  mintingPolicyToId,
  scriptHashToCredential,
  type LucidEvolution,
  type MintingPolicy,
  type Network,
  type UTxO,
} from "@lucid-evolution/lucid";

import { getValidator, loadBlueprint } from "./plutusBlueprint";

export type DeployConfigInput = {
  /** 28-byte policy id of the dead collection — becomes the config NFT's asset name. */
  collectionPolicyId: string;
  /** Integer ≥ 1. */
  m: number;
  /** Lovelace ≥ 0. */
  protocolFeeLovelace: bigint;
  /** Lovelace ≥ MIN_LISTER_FEE = 1_000_000. */
  listerFeeLovelace: bigint;
  /** Bech32 treasury address (mainnet or testnet aware). */
  treasuryAddrBech32: string;
  /** 28-byte hex Ed25519 verification-key hash. */
  adminPkhHex: string;
  /** Seed UTxO to spend (provides the one-shot anchor). */
  seedUtxo: UTxO;
  /** Network — must match the wallet. */
  network: Network;
};

export type DeployConfigResult = {
  txHash: string;
  configNftPolicy: string;
  scriptAddress: string;
  /** The 28-byte hex asset name of the config NFT. */
  collectionPolicyId: string;
  /** The applied (parameterized) compiled script — useful for indexers. */
  appliedCompiledCode: string;
};

const MIN_LISTER_FEE_LOVELACE = 1_000_000n;

/**
 * Build the Plutus `OutputReference` Constr from a UTxO.
 * Matches Aiken's `cardano/transaction/OutputReference` shape — Constr 0
 * with `[tx_id: ByteArray, output_index: Int]`.
 */
function outputReferenceData(utxo: UTxO): Constr<Data> {
  return new Constr(0, [utxo.txHash, BigInt(utxo.outputIndex)]);
}

/**
 * Build the Plutus `Address` Constr from a bech32 string.
 *
 * Aiken `cardano/address/Address`:
 *   Constr 0 [payment_credential, stake_credential]
 *
 * `payment_credential` / `Credential`:
 *   Constr 0 (VerificationKey [keyHash])
 *   Constr 1 (Script [scriptHash])
 *
 * `stake_credential` / `Option<StakeCredential>`:
 *   Constr 0 (Some [StakeCredential])  — StakeCredential is Inline(Credential) | Pointer(...)
 *   Constr 1 (None [])
 *
 * Pointer addresses are rejected — they're unsupported by the BE too.
 */
function addressData(details: {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
}): Constr<Data> {
  const paymentCred = new Constr(
    details.paymentCredentialType === "verification_key" ? 0 : 1,
    [details.paymentKeyHashHex],
  );

  let stakeCredOption: Constr<Data>;
  if (details.stakeCredentialHashHex && details.stakeCredentialType) {
    // StakeCredential::Inline(Credential)
    const stakeInner = new Constr(
      details.stakeCredentialType === "verification_key" ? 0 : 1,
      [details.stakeCredentialHashHex],
    );
    const inline = new Constr(0, [stakeInner]); // Inline
    stakeCredOption = new Constr(0, [inline]); // Some
  } else {
    stakeCredOption = new Constr(1, []); // None
  }
  return new Constr(0, [paymentCred, stakeCredOption]);
}

/**
 * Decode a bech32 address into the pieces we need for the Plutus Address Constr.
 * Importing `getAddressDetails` again here (rather than reusing the wallet
 * decoder) so we can grab the stake credential too.
 */
async function fullAddressDetails(bech32: string) {
  const { getAddressDetails } = await import("@lucid-evolution/lucid");
  const d = getAddressDetails(bech32);
  const pc = d.paymentCredential;
  if (!pc) {
    throw new Error(`address ${bech32} has no payment credential`);
  }
  if (d.type === "Pointer") {
    throw new Error("pointer addresses are not supported");
  }
  return {
    bech32: d.address.bech32,
    paymentKeyHashHex: pc.hash,
    paymentCredentialType:
      pc.type === "Key" ? ("verification_key" as const) : ("script" as const),
    stakeCredentialHashHex: d.stakeCredential?.hash ?? null,
    stakeCredentialType: d.stakeCredential
      ? d.stakeCredential.type === "Key"
        ? ("verification_key" as const)
        : ("script" as const)
      : null,
  };
}

function buildConfigDatum(args: {
  m: bigint;
  protocolFee: bigint;
  listerFee: bigint;
  treasuryAddrConstr: Constr<Data>;
  adminPkhHex: string;
}): string {
  // ConfigDatum: Constr 0 [m, protocol_fee, lister_fee, treasury_addr, admin_pkh]
  const constr = new Constr(0, [
    args.m,
    args.protocolFee,
    args.listerFee,
    args.treasuryAddrConstr,
    args.adminPkhHex,
  ]);
  return Data.to(constr);
}

/** Apply the seed_utxo parameter to the config validator's compiled code. */
export async function applyConfigSeed(
  seedUtxo: UTxO,
): Promise<{ appliedScript: string; policyId: string }> {
  const blueprint = await loadBlueprint();
  const mintHandler = getValidator(blueprint, "config.config.mint");
  // Param is `seed_utxo: OutputReference` — Constr 0 [tx_id, output_index].
  const applied = applyParamsToScript(
    mintHandler.compiledCode,
    [outputReferenceData(seedUtxo)],
  );
  const policy: MintingPolicy = {
    type: "PlutusV3",
    script: applied,
  };
  return {
    appliedScript: applied,
    policyId: mintingPolicyToId(policy),
  };
}

/**
 * Build + submit the deploy-config tx. The connected Lucid instance must
 * already have a wallet selected (via `selectWallet.fromAPI(cip30Api)`).
 */
export async function deployConfig(
  lucid: LucidEvolution,
  input: DeployConfigInput,
): Promise<DeployConfigResult> {
  // Sanity-check the floor before bothering the wallet.
  if (input.listerFeeLovelace < MIN_LISTER_FEE_LOVELACE) {
    throw new Error(
      `lister_fee must be >= ${MIN_LISTER_FEE_LOVELACE} lovelace (MIN_LISTER_FEE floor)`,
    );
  }
  if (input.m < 1) {
    throw new Error("m must be >= 1");
  }
  if (input.protocolFeeLovelace < 0n) {
    throw new Error("protocol_fee must be >= 0");
  }
  if (!/^[0-9a-fA-F]{56}$/.test(input.collectionPolicyId)) {
    throw new Error("collection_policy_id must be 56 hex chars (28 bytes)");
  }
  if (!/^[0-9a-fA-F]{56}$/.test(input.adminPkhHex)) {
    throw new Error("admin_pkh must be 56 hex chars (28 bytes)");
  }

  const { appliedScript, policyId } = await applyConfigSeed(input.seedUtxo);
  const mintingPolicy: MintingPolicy = {
    type: "PlutusV3",
    script: appliedScript,
  };

  // Enterprise script address — `addr(ScriptCredential(policyId))`,
  // no stake credential. SPEC §3.1: the spend handler's hash and the
  // mint policy id are the same script hash.
  const scriptAddress = credentialToAddress(
    input.network,
    scriptHashToCredential(policyId),
  );

  // Treasury Address Plutus data.
  const treasury = await fullAddressDetails(input.treasuryAddrBech32);
  const treasuryAddrConstr = addressData({
    paymentKeyHashHex: treasury.paymentKeyHashHex,
    paymentCredentialType: treasury.paymentCredentialType,
    stakeCredentialHashHex: treasury.stakeCredentialHashHex,
    stakeCredentialType: treasury.stakeCredentialType,
  });

  const configDatumHex = buildConfigDatum({
    m: BigInt(input.m),
    protocolFee: input.protocolFeeLovelace,
    listerFee: input.listerFeeLovelace,
    treasuryAddrConstr,
    adminPkhHex: input.adminPkhHex.toLowerCase(),
  });

  const unit = policyId + input.collectionPolicyId.toLowerCase();
  const mintAssets = { [unit]: 1n };

  // Redeemer for the mint handler is `Void`. Aiken encodes Void as
  // `Constr 0 []` — Data.void() returns the same.
  const redeemer = Data.void();

  const tx = await lucid
    .newTx()
    .collectFrom([input.seedUtxo])
    .mintAssets(mintAssets, redeemer)
    .attach.MintingPolicy(mintingPolicy)
    .pay.ToAddressWithData(
      scriptAddress,
      { kind: "inline", value: configDatumHex },
      { lovelace: 2_000_000n, ...mintAssets },
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  return {
    txHash,
    configNftPolicy: policyId,
    scriptAddress,
    collectionPolicyId: input.collectionPolicyId.toLowerCase(),
    appliedCompiledCode: appliedScript,
  };
}
