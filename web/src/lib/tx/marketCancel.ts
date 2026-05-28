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

export type MarketBulkCancelInput = {
  network: Network;
  /** Marketplace's compiled jar_script_hash parameter (from the manifest). */
  jarScriptHashHex: string;
  /**
   * Listing UTxOs the seller wants to cancel in a single tx. All UTxOs
   * MUST be at the same marketplace script address (the validator runs
   * once per input via the same applied-script reference) and MUST have
   * the same seller pkh in their datums (the seller signs once for the
   * whole tx).
   */
  consumed: UTxO[];
  /** 28-byte hex pkh of the seller — same value across every consumed datum. */
  sellerPkhHex: string;
};

/**
 * Cancel an arbitrary number of marketplace listings in a single tx.
 * Spends every {@code consumed} UTxO with the Cancel redeemer; the
 * validator's Cancel handler is per-input (signed_by(seller_pkh)) so
 * one seller signature satisfies all of them.
 *
 * <p>One wallet popup, one fee, one chain round-trip — strictly better
 * than looping {@link submitMarketCancel} when the seller is sweeping
 * multiple listings at once.
 */
export async function submitMarketBulkCancel(
  client: EvolutionClient,
  input: MarketBulkCancelInput,
): Promise<{ txHash: string }> {
  if (input.consumed.length === 0) {
    throw new Error("bulk cancel requires at least one listing UTxO");
  }
  const applied = await applyMarketplaceScript(
    input.network,
    input.jarScriptHashHex,
  );
  const cancelRedeemer: Data.Data = Data.constr(1n, []);
  const built = await client
    .newTx()
    .collectFrom({
      inputs: input.consumed.map((u) => u._evolution),
      redeemer: cancelRedeemer,
    })
    .attachScript({ script: applied.validator })
    .addSigner({ keyHash: toKeyHash(input.sellerPkhHex) })
    .build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
