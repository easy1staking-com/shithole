/**
 * Build + submit a single-listing marketplace `Buy` tx. The leader-pattern
 * bulk-buy is supported by the on-chain validator but not yet wired in the
 * FE — single-listing buy is by far the common path and is enough for the
 * dev-environment shakeout.
 *
 * <p>Tx shape (one listing, one jar leg):
 * <pre>
 *   inputs:                                  outputs:
 *     - listing UTxO (Buy)                     0: seller payout
 *     - jar UTxO (Deposit)                     1: jar continuing
 *     - buyer wallet UTxO(s)                   2: buyer's NFT
 *                                              3..: change (auto)
 * </pre>
 *
 * <p>Cardano sorts tx inputs canonically by (tx_hash, output_index). We
 * pre-sort our caller-supplied inputs the same way so we can compute
 * the on-chain index of the jar input and pass it to the validator via the
 * Buy redeemer's {@code jar_input_index} hint.
 */

import { Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { applyJarScript, applyMarketplaceScript } from "./marketScripts";
import type { DecodedMarketDatum } from "./marketDatum";
import type { Network } from "./swap";
import {
  inlineDatum,
  toAddress,
  toAssets,
  txHashHex,
} from "./txAdapters";
import type { UTxO } from "./utxo";
import { blake2b } from "@noble/hashes/blake2b";
import { serialiseOutputReference, hexToBytes } from "@/lib/pit/bucketMath";

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** {@code blake2b_256(cbor.serialise(out_ref))} — same recipe as `compute_output_tag`. */
function computeOutputTag(txHashHex: string, outputIndex: number): string {
  const cbor = serialiseOutputReference(hexToBytes(txHashHex), outputIndex);
  return bytesToHex(blake2b(cbor, { dkLen: 32 }));
}

export type MarketBuyInput = {
  network: Network;
  /** Bech32 jar address (manifest). */
  jarAddress: string;
  /** Hex script hash of jar (manifest). */
  jarScriptHashHex: string;
  /** Hex pkh of jar admin (manifest). Used to compile the jar validator. */
  adminPkhHex: string;
  /** Listing being bought. */
  listingUtxo: UTxO;
  /** Decoded MarketDatum of the listing — caller-side decode so we don't
   *  redo the work here. */
  listing: DecodedMarketDatum;
  /** Seller's bech32 address (caller decodes from `listing.sellerAddressRaw`). */
  sellerBech32Address: string;
  /** Jar UTxO the fee will be deposited to. */
  jarUtxo: UTxO;
  /** Buyer wallet UTxOs to consume (must collectively carry enough of the
   *  price token + tx fee + min-UTxO for the buyer-NFT output). */
  buyerInputs: UTxO[];
  /** Bech32 destination for the listed asset(s) — typically the connected wallet. */
  buyerBech32Address: string;
};

export type MarketBuyResult = { txHash: string };

export async function submitMarketBuy(
  client: EvolutionClient,
  input: MarketBuyInput,
): Promise<MarketBuyResult> {
  const mp = await applyMarketplaceScript(input.network, input.jarScriptHashHex);
  const jar = await applyJarScript(input.network, input.adminPkhHex);

  // Sanity: the jar UTxO must sit at the parameterised jar address.
  if (input.jarUtxo.address !== jar.address) {
    throw new Error(
      `jarUtxo address ${input.jarUtxo.address} != derived jar address ${jar.address}`,
    );
  }

  // ----- Fee math (mirrors validator) -----
  const priceQty = input.listing.priceQty;
  const expectedFee = (priceQty * 2n + 99n) / 100n;
  const sellerAmount = priceQty - expectedFee;

  // ----- Index resolution (canonical Cardano sort) -----
  const allInputs: UTxO[] = [input.listingUtxo, input.jarUtxo, ...input.buyerInputs];
  const sortedInputs = [...allInputs].sort(compareOutRefs);
  const jarInputIndex = sortedInputs.findIndex((u) =>
    sameRef(u, input.jarUtxo),
  );
  if (jarInputIndex < 0) {
    throw new Error("could not locate jar input after sort — bug");
  }

  // Outputs are emitted in the order we call payToAddress (Evolution
  // doesn't reorder authored outputs; change goes at the tail).
  //   0: seller payout
  //   1: jar continuing
  //   2: buyer NFT
  const sellerOutputIndex = 0;
  const jarOutputIndex = 1;

  // ----- Anti-double-sat tag for the seller output -----
  const ownTagHex = computeOutputTag(
    input.listingUtxo.txHash,
    input.listingUtxo.outputIndex,
  );
  const sellerTagDatum: Data.Data = Data.bytearray(ownTagHex);

  // ----- Seller output value: price-token (less fee) + bond -----
  const priceUnit = (input.listing.pricePolicyHex + input.listing.priceNameHex).toLowerCase();
  const sellerAssets: Record<string, bigint> = {
    lovelace: input.listing.accompanyingLovelace,
  };
  if (priceUnit === "" || priceUnit === "0000000000000000000000000000000000000000000000000000000000000000") {
    // No-op — ADA-priced listings have empty policy + name; the price IS
    // lovelace. Already accounted for in `accompanyingLovelace` below.
  }
  if (input.listing.pricePolicyHex.length === 0 && input.listing.priceNameHex.length === 0) {
    // ADA-priced: roll seller_amount into lovelace, leave non-ADA side empty.
    sellerAssets.lovelace = (sellerAssets.lovelace ?? 0n) + sellerAmount;
  } else {
    if (sellerAmount > 0n) {
      sellerAssets[priceUnit] = sellerAmount;
    }
  }

  // ----- Jar continuing output value: jar_in + Σfee -----
  // For a single-listing buy, the per-token sum is just `expectedFee` on
  // the (price_policy, price_name) pair.
  const jarInAssets = { ...input.jarUtxo.assets };
  const jarOutAssets: Record<string, bigint> = { ...jarInAssets };
  if (input.listing.pricePolicyHex.length === 0 && input.listing.priceNameHex.length === 0) {
    jarOutAssets.lovelace = (jarOutAssets.lovelace ?? 0n) + expectedFee;
  } else {
    jarOutAssets[priceUnit] = (jarOutAssets[priceUnit] ?? 0n) + expectedFee;
  }

  // ----- Jar continuing datum: JarDatum { update_ref = compute_output_tag(jar.outRef) } -----
  const jarTagHex = computeOutputTag(
    input.jarUtxo.txHash,
    input.jarUtxo.outputIndex,
  );
  const jarOutDatum: Data.Data = Data.constr(0n, [Data.bytearray(jarTagHex)]);

  // ----- Redeemers -----
  const buyRedeemer: Data.Data = Data.constr(0n, [
    Data.int(BigInt(jarInputIndex)),
    Data.int(BigInt(jarOutputIndex)),
    Data.int(BigInt(sellerOutputIndex)),
  ]);

  // Jar Deposit redeemer: {fee_token_policy, fee_token_name, qty, output_index}.
  const depositRedeemer: Data.Data = Data.constr(0n, [
    Data.bytearray(input.listing.pricePolicyHex.toLowerCase()),
    Data.bytearray(input.listing.priceNameHex.toLowerCase()),
    Data.int(expectedFee),
    Data.int(BigInt(jarOutputIndex)),
  ]);

  // ----- Identify the listed asset (the value the listing carries
  // minus the bond lovelace). -----
  const listedAssets: Record<string, bigint> = {};
  for (const [unit, qty] of Object.entries(input.listingUtxo.assets)) {
    if (unit === "lovelace") continue;
    if (qty > 0n) listedAssets[unit] = qty;
  }
  if (Object.keys(listedAssets).length === 0) {
    throw new Error("listing has no non-ADA assets to deliver");
  }

  // ----- Build -----
  let txBuilder = client
    .newTx()
    .collectFrom({
      inputs: [input.listingUtxo._evolution],
      redeemer: buyRedeemer,
    })
    .attachScript({ script: mp.validator })
    .collectFrom({
      inputs: [input.jarUtxo._evolution],
      redeemer: depositRedeemer,
    })
    .attachScript({ script: jar.validator });

  for (const u of input.buyerInputs) {
    txBuilder = txBuilder.collectFrom({ inputs: [u._evolution] });
  }

  txBuilder = txBuilder
    // Output 0: seller payout (tagged datum).
    .payToAddress({
      address: toAddress(input.sellerBech32Address),
      assets: toAssets(sellerAssets),
      datum: inlineDatum(sellerTagDatum),
    })
    // Output 1: jar continuing.
    .payToAddress({
      address: toAddress(input.jarAddress),
      assets: toAssets(jarOutAssets),
      datum: inlineDatum(jarOutDatum),
    })
    // Output 2: buyer receives the listed asset(s). Bond lovelace stayed
    // with the seller — buyer covers their own min-UTxO via autoMinUtxo.
    .payToAddress({
      address: toAddress(input.buyerBech32Address),
      assets: toAssets({ lovelace: 0n, ...listedAssets }),
      autoMinUtxo: true,
    });

  const built = await txBuilder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}

function compareOutRefs(a: UTxO, b: UTxO): number {
  if (a.txHash < b.txHash) return -1;
  if (a.txHash > b.txHash) return 1;
  return a.outputIndex - b.outputIndex;
}

function sameRef(a: UTxO, b: UTxO): boolean {
  return a.txHash === b.txHash && a.outputIndex === b.outputIndex;
}
