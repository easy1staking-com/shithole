/**
 * Build + submit a v3 P2P Reclaim tx — the buyer pulls their offered
 * NFT + locked ADA back out of a wanted-listing UTxO. Authorized on-
 * chain by `signed_by(buyer_pkh)`.
 *
 * <p>Mirror of v2's cancel.ts in shape: attach the applied validator,
 * collectFrom the listing UTxO with the Reclaim redeemer, add the buyer
 * as a required signer, let the wallet balance the inputs back to the
 * connected address.
 *
 * <p>No outputs to script (the listing dissolves). No ref input needed
 * either — the Reclaim branch doesn't look at the cfg.
 */

import { applyWantedListingScript } from "./createP2pListing";
import type { EvolutionClient } from "./evolutionClient";
import { buildReclaimRedeemer } from "./p2p";
import type { Network } from "./swap";
import { toKeyHash, txHashHex } from "./txAdapters";
import type { UTxO } from "./utxo";

export type ReclaimP2pInput = {
  network: Network;
  configNftPolicyHex: string;
  /** Wanted-listing UTxO being consumed. */
  listingUtxo: UTxO;
  /** Buyer's 28-byte pkh; on-chain validator does `signed_by(buyer_pkh)`. */
  buyerPkhHex: string;
};

export type ReclaimP2pResult = {
  txHash: string;
};

export async function submitReclaimP2p(
  client: EvolutionClient,
  input: ReclaimP2pInput,
): Promise<ReclaimP2pResult> {
  const applied = await applyWantedListingScript(
    input.network,
    input.configNftPolicyHex,
  );

  const redeemer = buildReclaimRedeemer();

  const built = await client
    .newTx()
    .collectFrom({
      inputs: [input.listingUtxo._evolution],
      redeemer,
    })
    .addSigner({ keyHash: toKeyHash(input.buyerPkhHex) })
    .attachScript({ script: applied.validator })
    .build();

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return { txHash };
}
