/**
 * Build + submit a Cancel tx (SPEC §5.5). Spends a listing UTxO with the
 * {@code Cancel} redeemer; the NFT + lovelace flow back to the lister's
 * wallet via the standard change path.
 *
 * <p>Cancel handler (listing.ak:61-72) requires only a signature from
 * the {@code lister_pkh} in the consumed datum. No config ref input,
 * no successor, no bucket math. Simplest path through the validator.
 *
 * <p>Cancel redeemer = ListingRedeemer's second variant → {@code Constr 1 []}.
 *
 * <p>Migrated from @lucid-evolution/lucid to @evolution-sdk/evolution.
 */

import { Address, Data } from "@evolution-sdk/evolution";

import type { EvolutionClient } from "./evolutionClient";
import { DEFAULT_LISTING_LOVELACE, buildGenesisListingDatum } from "./list";
import {
  applyListingScript,
  decodeConsumedListerPkh,
  type Network,
} from "./swap";
import {
  inlineDatum,
  toAddress,
  toAssets,
  toKeyHash,
  txHashHex,
} from "./txAdapters";
import type { UTxO } from "./utxo";

export type BuildCancelInput = {
  network: Network;
  /** 28-byte hex policy id of the config NFT (parameterizes the listing validator). */
  configNftPolicyHex: string;
  /**
   * Optional bech32 listing-script address. If supplied, cross-checked
   * against the derived applied-script address. If omitted, we trust the
   * derivation.
   */
  listingScriptAddress?: string;
  /** The listing UTxO to cancel. Must carry an inline {@code ListingDatum}. */
  consumed: UTxO;
};

export type CancelResult = {
  txHash: string;
  /** Hex pkh of the lister we required a signature from. */
  listerPkhHex: string;
};

export type CancelAndRelistResult = CancelResult & {
  relistedOutRef: { txHash: string; outputIndex: number };
};

/**
 * Build, sign, and submit the cancel tx. Throws on builder / sign /
 * submit failure (including "wallet refused to sign because the user
 * isn't the lister").
 */
export async function submitCancel(
  client: EvolutionClient,
  input: BuildCancelInput,
): Promise<CancelResult> {
  const applied = await applyListingScript(
    input.network,
    input.configNftPolicyHex,
  );
  if (
    input.listingScriptAddress &&
    applied.address !== input.listingScriptAddress
  ) {
    throw new Error(
      `listing script address mismatch — derived=${applied.address}, BE=${input.listingScriptAddress}`,
    );
  }

  // Decode the consumed datum so we can require the right signature.
  const listerPkhHex = decodeConsumedListerPkh(input.consumed);

  // Cancel = Constr 1 [].
  const cancelRedeemer: Data.Data = Data.constr(1n, []);

  const built = await client
    .newTx()
    .collectFrom({
      inputs: [input.consumed._evolution],
      redeemer: cancelRedeemer,
    })
    .attachScript({ script: applied.validator })
    // The wallet must sign as the lister.
    .addSigner({ keyHash: toKeyHash(listerPkhHex) })
    .build();

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return { txHash, listerPkhHex };
}

/* -------------------------------------------------------------------------- */
/* Atomic cancel + relist                                                     */
/* -------------------------------------------------------------------------- */

/**
 * SINGLE atomic tx: cancel + replant. Accrued lovelace flows back to
 * the lister via change; the replanted UTxO carries only min-UTxO ada.
 * Output[0] is the replanted listing.
 */
export async function submitCancelAndRelist(
  client: EvolutionClient,
  input: BuildCancelInput,
): Promise<CancelAndRelistResult> {
  const applied = await applyListingScript(
    input.network,
    input.configNftPolicyHex,
  );
  if (
    input.listingScriptAddress &&
    applied.address !== input.listingScriptAddress
  ) {
    throw new Error(
      `listing script address mismatch — derived=${applied.address}, BE=${input.listingScriptAddress}`,
    );
  }

  const listerPkhHex = decodeConsumedListerPkh(input.consumed);

  // Find the NFT unit the consumed listing carries.
  const nftUnit = Object.keys(input.consumed.assets).find(
    (u) => u !== "lovelace",
  );
  if (!nftUnit) {
    throw new Error(
      `consumed UTxO ${input.consumed.txHash}#${input.consumed.outputIndex} carries no NFT`,
    );
  }

  const cancelRedeemer: Data.Data = Data.constr(1n, []);
  const datum = buildGenesisListingDatum(listerPkhHex);

  const built = await client
    .newTx()
    .collectFrom({
      inputs: [input.consumed._evolution],
      redeemer: cancelRedeemer,
    })
    .attachScript({ script: applied.validator })
    .addSigner({ keyHash: toKeyHash(listerPkhHex) })
    // Replant at the same listing-script address, fresh genesis datum.
    .payToAddress({
      address: toAddress(applied.address),
      assets: toAssets({ lovelace: DEFAULT_LISTING_LOVELACE, [nftUnit]: 1n }),
      datum: inlineDatum(datum),
    })
    .build();

  // Resolve the relisted listing's index from the assembled tx body
  // rather than assuming it's 0. Codex flagged that Evolution may move
  // change outputs around in future point releases; pinning the actual
  // index keeps the BE indexer's lineage stitching correct.
  const txBody = (await built.toTransaction()).body;
  let relistedIdx = -1;
  for (let i = 0; i < txBody.outputs.length; i++) {
    const o = txBody.outputs[i];
    if (Address.toBech32(o.address) === applied.address) {
      relistedIdx = i;
      break;
    }
  }
  if (relistedIdx < 0) {
    throw new Error(
      "assembled cancel-and-relist tx is missing the replanted listing output",
    );
  }

  const signed = await built.sign();
  const txHash = txHashHex(await signed.submit());

  return {
    txHash,
    listerPkhHex,
    relistedOutRef: { txHash, outputIndex: relistedIdx },
  };
}
