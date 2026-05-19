/**
 * Build + submit a v3 P2P (wanted-listing) creation tx — a buyer locks one
 * "offered" NFT plus a bounty of ADA at the parameterized wanted_listing
 * script address, with an inline {@code WantedDatum} carrying their pkh,
 * full bech32 delivery address, and the committed merkle root of the pool
 * they're targeting.
 *
 * <p>Mirrors v2's {@code list.ts} shape: pay-to-script with an inline
 * datum, no validator attached (we're paying TO the script, not spending
 * FROM it; the actual validator execution happens at Fulfill / Reclaim /
 * Rescue time).
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
import { buildWantedDatum } from "./p2p";
import { getValidator, loadBlueprint } from "./plutusBlueprint";
import { stripOneCborByteStringWrapper } from "./scriptBytes";
import type { Network } from "./swap";
import { inlineDatum, toAddress, toAssets, txHashHex } from "./txAdapters";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * On-chain protocol floor enforced by the wanted_listing validator's W2
 * invariant: own_input.lovelace >= cfg.protocol_fee + 2_000_000. Anything
 * above the floor is the buyer's tip to attract a fulfiller.
 *
 * <p>Source of truth lives in {@code contracts/lib/shithole/types.ak}
 * as {@code min_seller_compensation = 2_000_000}. Provisional value
 * (Codex flagged as tight in the review at 2026-05-18 — refine after
 * preprod measurement).
 */
export const MIN_SELLER_COMPENSATION_LOVELACE = 2_000_000n;

/* -------------------------------------------------------------------------- */
/* Wanted-listing script application                                          */
/* -------------------------------------------------------------------------- */

export type AppliedWantedListing = {
  /** Double-CBOR-encoded applied script hex. */
  appliedScript: string;
  scriptHash: string;
  /** Bech32 enterprise (no stake) address at the applied script hash. */
  address: string;
  /** PlutusV3 wrapper around the SINGLE-CBOR form, for attachScript. */
  validator: PlutusV3.PlutusV3;
};

/**
 * Apply {@code config_nft_policy} as the wanted_listing validator's only
 * parameter, returning the compiled script + its enterprise address.
 *
 * <p>Identical machinery to v2's {@link applyListingScript}: UPLC apply,
 * strip one CBOR wrapper (Aiken emits double-CBOR, Evolution wants
 * single), wrap as PlutusV3, derive enterprise address.
 */
export async function applyWantedListingScript(
  network: Network,
  configNftPolicyHex: string,
): Promise<AppliedWantedListing> {
  if (!/^[0-9a-fA-F]{56}$/.test(configNftPolicyHex)) {
    throw new Error("config_nft_policy must be 56 hex chars (28 bytes)");
  }
  const blueprint = await loadBlueprint();
  const v = getValidator(blueprint, "wanted_listing.wanted_listing.spend");
  const appliedScript = UPLC.applyParamsToScript(v.compiledCode, [
    Data.bytearray(configNftPolicyHex.toLowerCase()),
  ]);

  const innerHex = stripOneCborByteStringWrapper(appliedScript);
  const validator = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(innerHex) });

  const sh = ScriptHash.fromScript(validator);
  const scriptHash = ScriptHash.toHex(sh);
  const networkId = network === "Mainnet" ? 1 : 0;
  const cred = Credential.makeScriptHash(ScriptHash.toBytes(sh));
  const addr = new Address.Address({ networkId, paymentCredential: cred });
  const address = Address.toBech32(addr);

  return { appliedScript, scriptHash, address, validator };
}

/* -------------------------------------------------------------------------- */
/* Tx builder                                                                 */
/* -------------------------------------------------------------------------- */

export type CreateP2pListingInput = {
  network: Network;
  /** 28-byte hex policy id of the per-collection config NFT. */
  configNftPolicyHex: string;
  /** 28-byte hex buyer pkh — the Reclaim authority. */
  buyerPkhHex: string;
  /**
   * EXACT bech32 delivery address — the validator does full-Address
   * equality, so the buyer's stake credential routes the deposit into
   * the wallet that's actually delegating to the target pool. Usually
   * the same as the buyer's connected wallet address.
   */
  buyerBech32Address: string;
  /** 32-byte sha2_256 merkle root committed to by this listing. */
  acceptedMerkleRootHex: string;
  /**
   * One offered NFT per listing UTxO — pass an array to batch-create N
   * listings in a single tx (each becomes its own output at the script
   * address, with the same WantedDatum but a different offered NFT).
   * Order is irrelevant; the result returns outputs in submission order.
   */
  offeredNftUnits: string[];
  /**
   * Lovelace PER LISTING. Each output gets exactly this amount + 1 NFT.
   * Must be at least cfg.protocol_fee + MIN_SELLER_COMPENSATION_LOVELACE,
   * validated on-chain at Fulfill time. Total ADA committed by the buyer
   * = bountyLovelace × offeredNftUnits.length.
   */
  bountyLovelace: bigint;
};

export type CreateP2pListingResult = {
  txHash: string;
  /** Bech32 wanted_listing script address the offers were locked at. */
  wantedScriptAddress: string;
  /**
   * One entry per offered NFT — same length as input.offeredNftUnits.
   * `outputIndex` is the listing UTxO's index within the submitted tx.
   */
  outputs: Array<{ unit: string; outputIndex: number }>;
};

/**
 * Static check: bounty meets the on-chain seller-compensation floor given
 * a known protocol fee. Throw early so the UI doesn't waste a wallet
 * popup on a doomed tx.
 *
 * <p>Pure function — no SDK dependencies. The {@link submitCreateP2pListing}
 * builder enforces the same check defensively.
 */
export function assertBountyFloor(
  bountyLovelace: bigint,
  protocolFeeLovelace: bigint,
): void {
  const floor = protocolFeeLovelace + MIN_SELLER_COMPENSATION_LOVELACE;
  if (bountyLovelace < floor) {
    throw new Error(
      `bounty ${bountyLovelace} below floor ${floor} (protocol_fee ${protocolFeeLovelace} + ${MIN_SELLER_COMPENSATION_LOVELACE} seller compensation)`,
    );
  }
}

/**
 * Build, sign, and submit the listing-creation tx.
 *
 * <p>One output: bountyLovelace + offered NFT @ wanted_listing script
 * address, with the inline WantedDatum. No validator attached (paying
 * TO the script, not spending FROM it). The wallet builder auto-balances
 * change + tx fee from the buyer's other UTxOs.
 */
export async function submitCreateP2pListing(
  client: EvolutionClient,
  input: CreateP2pListingInput,
): Promise<CreateP2pListingResult> {
  if (input.offeredNftUnits.length === 0) {
    throw new Error("at least one NFT must be offered");
  }
  // Defensive: enforce the protocol floor independent of caller.
  if (input.bountyLovelace < MIN_SELLER_COMPENSATION_LOVELACE) {
    throw new Error(
      `bountyLovelace ${input.bountyLovelace} is below the protocol-level seller-compensation floor of ${MIN_SELLER_COMPENSATION_LOVELACE}`,
    );
  }
  // Defensive: dedup. The Cardano ledger forbids the same NFT appearing
  // twice in a tx anyway (1-per-policy enforced by minting / utxo locks),
  // but a buggy UI could try.
  const seen = new Set<string>();
  for (const u of input.offeredNftUnits) {
    if (u.length < 56) {
      throw new Error(`offered unit ${u} is shorter than a policy id`);
    }
    const lc = u.toLowerCase();
    if (seen.has(lc)) {
      throw new Error(`duplicate unit in offeredNftUnits: ${lc}`);
    }
    seen.add(lc);
  }

  const applied = await applyWantedListingScript(
    input.network,
    input.configNftPolicyHex,
  );

  const datum = buildWantedDatum({
    buyerPkhHex: input.buyerPkhHex,
    buyerBech32Address: input.buyerBech32Address,
    acceptedMerkleRootHex: input.acceptedMerkleRootHex,
  });

  let txBuilder = client.newTx();
  for (const rawUnit of input.offeredNftUnits) {
    const unit = rawUnit.toLowerCase();
    txBuilder = txBuilder.payToAddress({
      address: toAddress(applied.address),
      assets: toAssets({ lovelace: input.bountyLovelace, [unit]: 1n }),
      datum: inlineDatum(datum),
    });
  }

  const built = await txBuilder.build();

  // Resolve each NFT's actual output index from the built tx body — the
  // balancer can reorder. Each unit gets exactly one matching output at
  // the script address; we claim them in order to avoid the same output
  // serving two units.
  const txBody = (await built.toTransaction()).body;
  const claimed = new Set<number>();
  const outputs: Array<{ unit: string; outputIndex: number }> = [];
  for (const rawUnit of input.offeredNftUnits) {
    const unit = rawUnit.toLowerCase();
    let foundIdx = -1;
    for (let i = 0; i < txBody.outputs.length; i++) {
      if (claimed.has(i)) continue;
      const o = txBody.outputs[i];
      if (Address.toBech32(o.address) !== applied.address) continue;
      if (!outputCarriesUnit(o, unit)) continue;
      foundIdx = i;
      break;
    }
    if (foundIdx < 0) {
      throw new Error(
        `assembled tx does not include the listing output for ${unit}`,
      );
    }
    claimed.add(foundIdx);
    outputs.push({ unit, outputIndex: foundIdx });
  }

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return {
    txHash,
    wantedScriptAddress: applied.address,
    outputs,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mirror of {@code list.ts}'s outputCarriesUnit — checks an Evolution
 * {@code TransactionOutput} for a specific policy + asset_name pair with
 * quantity 1. Defensive against MultiAsset map keys being typed
 * PolicyId / AssetName runtime values rather than raw strings.
 */
function outputCarriesUnit(output: unknown, unit: string): boolean {
  const o = output as {
    assets?: { multiAsset?: { map: Map<unknown, Map<unknown, bigint>> } };
  };
  const ma = o.assets?.multiAsset;
  if (!ma || !ma.map) return false;
  if (unit.length < 56) return false;
  const policyHex = unit.slice(0, 56).toLowerCase();
  const assetNameHex = unit.slice(56).toLowerCase();
  for (const [policy, byAsset] of ma.map.entries()) {
    if (toHex(policy) !== policyHex) continue;
    for (const [asset, qty] of byAsset.entries()) {
      if (toHex(asset) === assetNameHex && qty === 1n) return true;
    }
  }
  return false;
}

function toHex(v: unknown): string {
  if (typeof v === "string") return v.toLowerCase();
  const x = v as {
    bytes?: Uint8Array;
    hash?: Uint8Array | string;
    toHex?: () => string;
  };
  if (x.bytes instanceof Uint8Array) return bytesToHexLocal(x.bytes);
  if (x.hash instanceof Uint8Array) return bytesToHexLocal(x.hash);
  if (typeof x.hash === "string") return x.hash.toLowerCase();
  if (typeof x.toHex === "function") return x.toHex().toLowerCase();
  return "";
}

function bytesToHexLocal(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
