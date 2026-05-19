/**
 * Build + submit a v3 P2P Fulfill tx — a seller spends a buyer's wanted-
 * listing UTxO, supplies a matching NFT + a BE-issued merkle proof, and
 * receives the offered NFT + bounty ADA.
 *
 * <p>On-chain validator invariants (see `wanted_listing.ak` W1-W7):
 * <ul>
 *   <li>W1 cfg ref input via config NFT policy</li>
 *   <li>W2 listing lovelace >= cfg.protocol_fee + 2 ADA floor</li>
 *   <li>W3 buyer_output: full Address equality + InlineDatum(own_tag)</li>
 *   <li>W4 merkle proof against accepted_merkle_root</li>
 *   <li>W5-W7: treasury leg if cfg.protocol_fee > 0</li>
 * </ul>
 *
 * <p>Mirrors v2 swap.ts's tx-builder shape: attach the applied validator,
 * read the config UTxO as a ref input, collectFrom the listing UTxO with
 * the Fulfill redeemer, pay the buyer's NFT-delivery output + treasury.
 */

import { Data } from "@evolution-sdk/evolution";
import { blake2b } from "@noble/hashes/blake2b";

import { applyWantedListingScript } from "./createP2pListing";
import type { EvolutionClient } from "./evolutionClient";
import { buildFulfillRedeemer } from "./p2p";
import type { Network } from "./swap";
import { inlineDatum, toAddress, toAssets, txHashHex } from "./txAdapters";
import type { UTxO } from "./utxo";

export type FulfillP2pInput = {
  network: Network;
  /**
   * Config UTxO carrying the config NFT — must already be on the chain
   * + indexed. Used as a reference input (W1 lookup).
   */
  configRefUtxo: UTxO;
  /** Treasury bech32 from cfg. Only used when protocol_fee > 0. */
  treasuryAddrBech32: string;
  protocolFeeLovelace: bigint;
  /** 28-byte hex; UPLC param for the wanted_listing script. */
  configNftPolicyHex: string;

  /** The wanted-listing UTxO being consumed (resolved via Evolution). */
  listingUtxo: UTxO;
  /** Buyer's full bech32 delivery address from the WantedDatum. */
  buyerBech32Address: string;
  /** Full unit hex of the NFT the seller deposits (must be in seller's wallet). */
  depositNftUnit: string;

  /** Merkle proof from `GET /api/p2p/pools/{root}/proofs/{asset_name}`. */
  merkleProof: Array<{ side: "left" | "right"; hashHex: string }>;
};

export type FulfillP2pResult = {
  txHash: string;
};

/**
 * Bytes-side min-utxo floor for the buyer_output. ~1.3 ADA is the actual
 * chain min for an NFT + small inline datum; 1.5 ADA gives headroom and
 * makes the seller's tx fee math simpler.
 */
const BUYER_OUTPUT_MIN_LOVELACE = 1_500_000n;

export async function submitFulfillP2p(
  client: EvolutionClient,
  input: FulfillP2pInput,
): Promise<FulfillP2pResult> {
  if (input.depositNftUnit.length < 56) {
    throw new Error(`depositNftUnit too short: ${input.depositNftUnit}`);
  }

  // 1. Apply config_nft_policy to the wanted_listing validator so we can
  // both spend from the script address AND attach the validator to the tx.
  const applied = await applyWantedListingScript(
    input.network,
    input.configNftPolicyHex,
  );

  // 2. Build redeemer. Buyer output goes at index 0; treasury (if any)
  // at index 1 — order is asserted before submit to defend against any
  // balancer reordering.
  const treasuryOutputIndex: number | null =
    input.protocolFeeLovelace > 0n ? 1 : null;

  const redeemer = buildFulfillRedeemer({
    merkleProof: input.merkleProof,
    treasuryOutputIndex,
  });

  // 3. Compute the buyer_output tag (blake2b_256 over cbor(oref)).
  const tagBytes = computeOutputTag(
    input.listingUtxo.txHash,
    input.listingUtxo.outputIndex,
  );
  const tagDatum = Data.bytearray(bytesToHex(tagBytes));

  // 4. Compose the tx.
  let builder = client
    .newTx()
    .readFrom({ referenceInputs: [input.configRefUtxo._evolution] })
    .collectFrom({
      inputs: [input.listingUtxo._evolution],
      redeemer,
    })
    // buyer_output (#0): deposit NFT → buyer's bech32 with tag inline datum.
    .payToAddress({
      address: toAddress(input.buyerBech32Address),
      assets: toAssets({
        lovelace: BUYER_OUTPUT_MIN_LOVELACE,
        [input.depositNftUnit.toLowerCase()]: 1n,
      }),
      datum: inlineDatum(tagDatum),
      autoMinUtxo: true,
    });

  // Optional treasury output (#1) when protocol_fee > 0.
  if (treasuryOutputIndex !== null) {
    builder = builder.payToAddress({
      address: toAddress(input.treasuryAddrBech32),
      assets: toAssets({ lovelace: input.protocolFeeLovelace }),
      datum: inlineDatum(tagDatum),
      autoMinUtxo: true,
    });
  }

  const built = await builder
    .attachScript({ script: applied.validator })
    .build();
  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return { txHash };
}

/* -------------------------------------------------------------------------- */
/* compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))               */
/* -------------------------------------------------------------------------- */

function computeOutputTag(txHashHexStr: string, outputIndex: number): Uint8Array {
  const tag = Data.constr(0n, [
    Data.bytearray(txHashHexStr.toLowerCase()),
    Data.int(BigInt(outputIndex)),
  ]);
  const cbor = Data.toCBORHex(tag);
  return blake2b(hexToBytes(cbor), { dkLen: 32 });
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
