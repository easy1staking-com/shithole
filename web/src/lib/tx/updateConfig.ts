/**
 * Build + submit a config-update tx (SPEC §5.2 / §6.2).
 *
 * Spends the existing config UTxO (identified by the config NFT under the
 * `config_nft_policy`) and recreates it at the same script address with a
 * new {@link ConfigDatum}. Admin-only — the config validator's spend
 * handler enforces `signed_by(admin_pkh)` and (if admin rotation) a second
 * signature from the incoming admin.
 *
 * <p>Re-derives the applied script bytes via Blockfrost's
 * {@code /scripts/{hash}/cbor} endpoint — we don't need the original seed
 * UTxO. The config UTxO itself is found via Blockfrost's
 * {@code /addresses/{addr}/utxos} (filtered by the config NFT asset).
 */

import {
  Address,
  Bytes,
  Credential,
  Data,
  PlutusV3,
  ScriptHash,
} from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import {
  getBlockfrostProjectId,
  getBlockfrostUrl,
  type CardanoNetworkName,
} from "../wallet/network";
import type { Network } from "./swap";
import { fetchUtxoByOutRef } from "./swap";
import { inlineDatum, toAddress, toAssets, toKeyHash, txHashHex } from "./txAdapters";

export type UpdateConfigInput = {
  /** 28-byte hex policy id of the config NFT. Also = the config script hash. */
  configNftPolicyHex: string;
  /** 28-byte hex asset name of the config NFT = the collection's policy id. */
  collectionPolicyIdHex: string;
  /** New datum values; ALL fields supplied (no partial update support). */
  newDatum: {
    m: number;
    protocolFeeLovelace: bigint;
    listerFeeLovelace: bigint;
    treasuryAddrBech32: string;
    adminPkhHex: string;
  };
  /** PKH that signs the current admin's authorization. Must match the
   *  on-chain `cfg.admin_pkh` at spend time. If the new datum's
   *  adminPkhHex differs from this, the new admin must ALSO sign — the
   *  wallet running this tx must be capable of producing both
   *  signatures (typically not possible from a single CIP-30 session),
   *  so admin rotation is unsupported here. */
  currentAdminPkhHex: string;
  network: Network;
};

export type UpdateConfigResult = {
  txHash: string;
};

const MIN_LISTER_FEE_LOVELACE = 1_000_000n;

function networkId(network: Network): 0 | 1 {
  return network === "Mainnet" ? 1 : 0;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/* -------------------------------------------------------------------------- */
/* Plutus Data builders (mirror deployConfig.ts)                              */
/* -------------------------------------------------------------------------- */

function addressData(details: {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
}): Data.Data {
  const pay: Data.Data = Data.constr(
    details.paymentCredentialType === "verification_key" ? 0n : 1n,
    [Data.bytearray(details.paymentKeyHashHex)],
  );
  const stake: Data.Data =
    details.stakeCredentialHashHex && details.stakeCredentialType
      ? Data.constr(0n, [
          Data.constr(0n, [
            Data.constr(
              details.stakeCredentialType === "verification_key" ? 0n : 1n,
              [Data.bytearray(details.stakeCredentialHashHex)],
            ),
          ]),
        ])
      : Data.constr(1n, []);
  return Data.constr(0n, [pay, stake]);
}

function decomposeAddress(bech32: string): {
  paymentKeyHashHex: string;
  paymentCredentialType: "verification_key" | "script";
  stakeCredentialHashHex: string | null;
  stakeCredentialType: "verification_key" | "script" | null;
} {
  const addr = Address.fromBech32(bech32);
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

function buildConfigDatum(args: {
  m: bigint;
  protocolFee: bigint;
  listerFee: bigint;
  treasuryAddrConstr: Data.Data;
  adminPkhHex: string;
}): Data.Data {
  return Data.constr(0n, [
    Data.int(args.m),
    Data.int(args.protocolFee),
    Data.int(args.listerFee),
    args.treasuryAddrConstr,
    Data.bytearray(args.adminPkhHex),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Blockfrost helpers                                                          */
/* -------------------------------------------------------------------------- */

function bf(networkName: CardanoNetworkName): {
  url: string;
  projectId: string;
} {
  const url = getBlockfrostUrl(networkName);
  const projectId = getBlockfrostProjectId();
  if (!projectId) {
    throw new Error("NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not configured");
  }
  return { url, projectId };
}

/** Fetch the applied compiled-code (CBOR-encoded UPLC) for a script hash. */
async function fetchScriptCborByHash(
  networkName: CardanoNetworkName,
  scriptHashHex: string,
): Promise<string> {
  const { url, projectId } = bf(networkName);
  const resp = await fetch(`${url}/scripts/${scriptHashHex}/cbor`, {
    headers: { project_id: projectId },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `blockfrost /scripts/${scriptHashHex}/cbor returned ${resp.status}: ${body.slice(0, 200)}`,
    );
  }
  const j = (await resp.json()) as { cbor: string };
  if (!j.cbor) {
    throw new Error(
      `blockfrost /scripts/${scriptHashHex}/cbor returned empty cbor`,
    );
  }
  return j.cbor;
}

/**
 * Find the (tx_hash, output_index) of the UTxO at `addr` carrying `unit`.
 * Uses Blockfrost's address/{addr}/utxos/{asset} endpoint — one chain-wide
 * by construction for the config NFT (one-shot mint).
 */
async function fetchUtxoOutRefHoldingUnit(
  networkName: CardanoNetworkName,
  addrBech32: string,
  unit: string,
): Promise<{ txHash: string; outputIndex: number }> {
  const { url, projectId } = bf(networkName);
  const resp = await fetch(
    `${url}/addresses/${addrBech32}/utxos/${unit}`,
    { headers: { project_id: projectId } },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `blockfrost /addresses/${addrBech32}/utxos/${unit} returned ${resp.status}: ${body.slice(0, 200)}`,
    );
  }
  const rows = (await resp.json()) as Array<{
    tx_hash: string;
    output_index: number;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `no UTxO at ${addrBech32} holding ${unit} (Blockfrost returned empty)`,
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `expected exactly 1 UTxO at ${addrBech32} holding ${unit}, found ${rows.length}`,
    );
  }
  return { txHash: rows[0].tx_hash, outputIndex: rows[0].output_index };
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Spend the config UTxO and recreate at the same address with a new
 * ConfigDatum. Caller is expected to be the current admin (their wallet
 * signs).
 */
export async function submitConfigUpdate(
  client: EvolutionClient,
  networkName: CardanoNetworkName,
  input: UpdateConfigInput,
): Promise<UpdateConfigResult> {
  // -------- validation --------
  if (!/^[0-9a-fA-F]{56}$/.test(input.configNftPolicyHex))
    throw new Error("configNftPolicyHex must be 56 hex chars");
  if (!/^[0-9a-fA-F]+$/.test(input.collectionPolicyIdHex))
    throw new Error("collectionPolicyIdHex must be hex");
  if (input.newDatum.m < 1) throw new Error("m must be >= 1");
  if (input.newDatum.protocolFeeLovelace < 0n)
    throw new Error("protocol_fee must be >= 0");
  if (input.newDatum.listerFeeLovelace < MIN_LISTER_FEE_LOVELACE)
    throw new Error(
      `lister_fee must be >= ${MIN_LISTER_FEE_LOVELACE} lovelace (MIN_LISTER_FEE floor)`,
    );
  if (!/^[0-9a-fA-F]{56}$/.test(input.newDatum.adminPkhHex))
    throw new Error("admin_pkh must be 56 hex chars");
  if (
    input.newDatum.adminPkhHex.toLowerCase() !==
    input.currentAdminPkhHex.toLowerCase()
  ) {
    // Admin rotation requires both signatures; single-wallet CIP-30
    // can't satisfy that. Defer to a future flow.
    throw new Error(
      "admin rotation is not supported in this flow — keep adminPkhHex unchanged",
    );
  }

  const policy = input.configNftPolicyHex.toLowerCase();
  const assetName = input.collectionPolicyIdHex.toLowerCase();
  const configNftUnit = policy + assetName;

  // -------- derive script address from policy --------
  const cred = Credential.makeScriptHash(Bytes.fromHex(policy));
  const scriptAddrObj = new Address.Address({
    networkId: networkId(input.network),
    paymentCredential: cred,
  });
  const scriptAddress = Address.toBech32(scriptAddrObj);

  // -------- fetch the config UTxO --------
  // Direct Blockfrost — find the outRef of the UTxO at the config script
  // address that holds the config NFT (exactly one chain-wide by the
  // one-shot mint), then hydrate via the existing fetchUtxoByOutRef
  // helper (which returns the full Evolution UTxO shape we need to
  // .collectFrom).
  const outRef = await fetchUtxoOutRefHoldingUnit(
    networkName,
    scriptAddress,
    configNftUnit,
  );
  const consumed = await fetchUtxoByOutRef(
    client,
    outRef.txHash,
    outRef.outputIndex,
  );

  // -------- fetch the applied script CBOR + wrap as PlutusV3 --------
  const cbor = await fetchScriptCborByHash(networkName, policy);
  const scriptV3 = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(cbor) });
  // Sanity: the script's hash must match the policy we just used to
  // derive the address.
  const derivedHash = ScriptHash.toHex(ScriptHash.fromScript(scriptV3));
  if (derivedHash.toLowerCase() !== policy) {
    throw new Error(
      `fetched script hash ${derivedHash} does not match policy ${policy}`,
    );
  }

  // -------- build the new datum --------
  const treasury = decomposeAddress(input.newDatum.treasuryAddrBech32);
  const treasuryAddrConstr = addressData(treasury);
  const newConfigDatum = buildConfigDatum({
    m: BigInt(input.newDatum.m),
    protocolFee: input.newDatum.protocolFeeLovelace,
    listerFee: input.newDatum.listerFeeLovelace,
    treasuryAddrConstr,
    adminPkhHex: input.newDatum.adminPkhHex.toLowerCase(),
  });

  // Preserve the lovelace amount on the continuing output (or bump to
  // min-utxo via autoMinUtxo as a safety net).
  const consumedLovelace = consumed.assets.lovelace ?? 2_000_000n;

  // The spend handler doesn't inspect the redeemer (declared `_redeemer: Data`),
  // so Void (Constr 0 []) is fine.
  const voidRedeemer: Data.Data = Data.constr(0n, []);

  const built = await client
    .newTx()
    .collectFrom({
      inputs: [consumed._evolution],
      redeemer: voidRedeemer,
    })
    .attachScript({ script: scriptV3 })
    .addSigner({ keyHash: toKeyHash(input.currentAdminPkhHex) })
    .payToAddress({
      address: toAddress(scriptAddress),
      assets: toAssets({ lovelace: consumedLovelace, [configNftUnit]: 1n }),
      datum: inlineDatum(newConfigDatum),
      autoMinUtxo: true,
    })
    .build();

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return { txHash };
}
