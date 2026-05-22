/**
 * Compile + parameterize the jar and marketplace validators, returning
 * their applied script bytes + bech32 addresses. Mirrors the pit's
 * {@code applyListingScript} pattern (see {@code swap.ts}).
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

import type { Network } from "./swap";
import { getValidator, loadBlueprint } from "./plutusBlueprint";
import { stripOneCborByteStringWrapper } from "./scriptBytes";

export type AppliedScript = {
  /** Double-CBOR encoded applied script bytes (Aiken format). */
  appliedScript: string;
  /** Single-CBOR encoded bytes (what Evolution's PlutusV3 wants). */
  innerHex: string;
  /** 28-byte hex script hash. */
  scriptHash: string;
  /** Bech32 enterprise address. */
  address: string;
  /** Typed PlutusV3 instance for attachScript. */
  validator: PlutusV3.PlutusV3;
};

function resolveNetworkId(network: Network): number {
  return network === "Mainnet" ? 1 : 0;
}

function buildApplied(
  appliedScript: string,
  network: Network,
): AppliedScript {
  const innerHex = stripOneCborByteStringWrapper(appliedScript);
  const validator = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(innerHex) });
  const sh = ScriptHash.fromScript(validator);
  const scriptHash = ScriptHash.toHex(sh);
  const cred = Credential.makeScriptHash(ScriptHash.toBytes(sh));
  const addr = new Address.Address({
    networkId: resolveNetworkId(network),
    paymentCredential: cred,
  });
  return {
    appliedScript,
    innerHex,
    scriptHash,
    address: Address.toBech32(addr),
    validator,
  };
}

/** Compile {@code jar.jar.spend} with admin_pkh. */
export async function applyJarScript(
  network: Network,
  adminPkhHex: string,
): Promise<AppliedScript> {
  if (!/^[0-9a-fA-F]{56}$/.test(adminPkhHex)) {
    throw new Error("adminPkh must be 56 hex chars (28 bytes)");
  }
  const blueprint = await loadBlueprint();
  const v = getValidator(blueprint, "jar.jar.spend");
  const appliedScript = UPLC.applyParamsToScript(v.compiledCode, [
    Data.bytearray(adminPkhHex.toLowerCase()),
  ]);
  return buildApplied(appliedScript, network);
}

/** Compile {@code marketplace.marketplace.spend} with jar_script_hash. */
export async function applyMarketplaceScript(
  network: Network,
  jarScriptHashHex: string,
): Promise<AppliedScript> {
  if (!/^[0-9a-fA-F]{56}$/.test(jarScriptHashHex)) {
    throw new Error("jarScriptHash must be 56 hex chars (28 bytes)");
  }
  const blueprint = await loadBlueprint();
  const v = getValidator(blueprint, "marketplace.marketplace.spend");
  const appliedScript = UPLC.applyParamsToScript(v.compiledCode, [
    Data.bytearray(jarScriptHashHex.toLowerCase()),
  ]);
  return buildApplied(appliedScript, network);
}
