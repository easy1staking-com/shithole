/**
 * Build + submit a Cancel tx (SPEC §5.5). Spends a listing UTxO with the
 * {@code Cancel} redeemer; the NFT + lovelace flow back to the lister's
 * wallet via the standard change path.
 *
 * <p>The on-chain Cancel handler (listing.ak) requires only one thing:
 * a signature from the {@code lister_pkh} in the consumed datum. No
 * config reference input, no successor output, no bucket math. The
 * simplest of the three listing-validator paths.
 *
 * <p>The Cancel redeemer is the second variant of {@code ListingRedeemer}
 * — {@code Constr 1 []}.
 */

import {
  Constr,
  Data,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";

import { DEFAULT_LISTING_LOVELACE, buildGenesisListingDatum } from "./list";
import { applyListingScript, decodeConsumedListerPkh } from "./swap";

export type BuildCancelInput = {
  network: import("@lucid-evolution/lucid").Network;
  /** 28-byte hex policy id of the config NFT (parameterizes the listing validator). */
  configNftPolicyHex: string;
  /**
   * Optional bech32 listing-script address. If supplied, cross-checked
   * against the derived applied-script address (defensive — same pattern
   * as swap). If omitted, we trust the derivation.
   */
  listingScriptAddress?: string;
  /** The listing UTxO to cancel. Must carry an inline {@code ListingDatum}. */
  consumed: UTxO;
};

export type CancelResult = {
  txHash: string;
  /** Hex pkh of the lister we required a signature from (decoded from the consumed datum). */
  listerPkhHex: string;
};

export type CancelAndRelistResult = CancelResult & {
  /** OutRef of the freshly-replanted listing (always output index 0). */
  relistedOutRef: { txHash: string; outputIndex: number };
};

/**
 * Build, sign, and submit the cancel tx. Throws on builder / sign /
 * submit failure (including "wallet refused to sign because the user
 * isn't the lister" — the wallet rejects the sign request when it can't
 * produce the required pkh signature).
 *
 * <p>The caller is responsible for verifying the connected wallet IS
 * the lister before calling — the /me page filters listings by the
 * connected pkh, so this is implicit. If a non-lister tries to cancel,
 * the tx would build but the validator would reject it on-chain.
 */
export async function submitCancel(
  lucid: LucidEvolution,
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

  // Decode the consumed datum so we can require the right signature —
  // and surface "you are not the lister" sooner than the on-chain reject.
  const listerPkhHex = decodeConsumedListerPkh(input.consumed);

  // Cancel = ListingRedeemer's second variant → Constr 1 [].
  const cancelRedeemer = Data.to(new Constr(1, []));

  const tx = await lucid
    .newTx()
    .collectFrom([input.consumed], cancelRedeemer)
    .attach.SpendingValidator(applied.validator)
    // The wallet must sign as the lister; tell the builder so the
    // required_signers field is set even if the change output goes
    // to the same key. (CIP-30 wallets typically auto-sign with the
    // payment key, so this is belt-and-braces.)
    .addSignerKey(listerPkhHex)
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  return { txHash, listerPkhHex };
}

/* -------------------------------------------------------------------------- */
/* Atomic cancel + relist (the "claim accrued ADA" UX)                        */
/* -------------------------------------------------------------------------- */

/**
 * Build a SINGLE tx that cancels the listing AND immediately replants
 * the same NFT at the listing-script address with a fresh genesis
 * datum. Accrued lovelace returns to the lister via change; the
 * replanted UTxO carries only min-UTxO ada.
 *
 * <p>Atomic by design — addresses the Codex-flagged failure mode where
 * a two-tx flow (cancel → wait → relist) leaves the NFT in the wallet
 * if the user closes the tab or the relist submit throws. The
 * validator's Cancel handler only requires
 * {@code signed_by(lister_pkh)} (listing.ak:61-72), so nothing on-chain
 * prevents combining the cancel with a same-tx relist.
 *
 * <p>Output[0] is the replanted listing. Other outputs (change carrying
 * the accrued ADA) come after. We don't post-assert output ordering
 * here because the lister is the only one signing — they have no
 * incentive to corrupt their own tx.
 */
export async function submitCancelAndRelist(
  lucid: LucidEvolution,
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

  // Find the NFT unit the consumed listing carries. The strict listing
  // shape (SPEC §10.2) guarantees exactly one non-lovelace asset.
  const nftUnit = Object.keys(input.consumed.assets).find(
    (u) => u !== "lovelace",
  );
  if (!nftUnit) {
    throw new Error(
      `consumed UTxO ${input.consumed.txHash}#${input.consumed.outputIndex} carries no NFT`,
    );
  }

  const cancelRedeemer = Data.to(new Constr(1, []));
  const datumHex = buildGenesisListingDatum(listerPkhHex);

  const tx = await lucid
    .newTx()
    .collectFrom([input.consumed], cancelRedeemer)
    .attach.SpendingValidator(applied.validator)
    .addSignerKey(listerPkhHex)
    // Replant: same NFT, fresh genesis datum, min-UTxO ada. Lucid's
    // balancer routes the remaining lovelace (accrued + the original
    // min-UTxO) to the wallet as change.
    .pay.ToAddressWithData(
      applied.address,
      { kind: "inline", value: datumHex },
      { lovelace: DEFAULT_LISTING_LOVELACE, [nftUnit]: 1n },
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  return {
    txHash,
    listerPkhHex,
    relistedOutRef: { txHash, outputIndex: 0 },
  };
}
