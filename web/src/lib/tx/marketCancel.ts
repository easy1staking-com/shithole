/**
 * Build + submit a marketplace `Cancel` tx. Seller spends one of their
 * marketplace UTxOs and sweeps the locked assets + bond lovelace back
 * through change to the connected wallet.
 *
 * <p>Redeemer = {@code Constr 1 []}. Validator's Cancel handler
 * (marketplace.ak:101-105) requires only the seller's signature
 * (extracted from the datum's first field) — no output routing checks.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { applyMarketplaceScript } from "./marketScripts";
import type { Network } from "./swap";
import { toKeyHash, txHashHex } from "./txAdapters";
import type { UTxO } from "./utxo";

export type MarketCancelInput = {
  network: Network;
  /** Marketplace's compiled jar_script_hash parameter (from the manifest). */
  jarScriptHashHex: string;
  /** Listing UTxO the seller wants to cancel. */
  consumed: UTxO;
  /** 28-byte hex pkh of the seller (datum's first field). */
  sellerPkhHex: string;
};

export async function submitMarketCancel(
  client: EvolutionClient,
  input: MarketCancelInput,
): Promise<{ txHash: string }> {
  const applied = await applyMarketplaceScript(
    input.network,
    input.jarScriptHashHex,
  );
  const cancelRedeemer: Data.Data = Data.constr(1n, []);
  const built = await client
    .newTx()
    .collectFrom({
      inputs: [input.consumed._evolution],
      redeemer: cancelRedeemer,
    })
    .attachScript({ script: applied.validator })
    .addSigner({ keyHash: toKeyHash(input.sellerPkhHex) })
    .build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
