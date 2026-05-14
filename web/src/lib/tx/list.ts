/**
 * Build + submit a batch listing tx (SPEC §5.2). TypeScript port of
 * {@code api/.../tools/preprod/ListNftTool.java}, generalized to
 * multi-NFT batching.
 *
 * <p>For each selected NFT, the tx produces one pay-to-script output at
 * the listing-script address carrying:
 * <ul>
 *   <li>the NFT itself (qty 1),</li>
 *   <li>min-ADA lovelace (computed by Lucid's auto-min-ada balancer; we
 *       pass a conservative {@code DEFAULT_LISTING_LOVELACE} that the
 *       balancer will bump up if necessary),</li>
 *   <li>inline {@code ListingDatum} = {@code Constr 0 [bytes(lister_pkh), Constr 1 []]}
 *       — {@code update_ref = None} for genesis listings (S6 only bumps
 *       it post-swap).</li>
 * </ul>
 *
 * <p>The tx is unsigned-script (no attached validator, no redeemer): we
 * are PAYING TO the script, not spending FROM it. Lucid handles input
 * selection + change.
 */

import {
  CML,
  Constr,
  Data,
  type Assets,
  type LucidEvolution,
} from "@lucid-evolution/lucid";

/**
 * Lovelace floor for a fresh listing UTxO. Single-NFT + small inline
 * datum on a Babbage-era output bottoms out around 1.3 ADA; we send 2
 * ADA to leave headroom (Lucid's balancer bumps if needed, never trims).
 *
 * <p>Exported so the cancel-and-relist builder can reuse the same floor
 * — keeps the relisted UTxO indistinguishable from a fresh listing.
 */
export const DEFAULT_LISTING_LOVELACE = 2_000_000n;

export type ListingNftRef = {
  /** Full unit hex (policy + asset_name). */
  unit: string;
};

export type BuildListInput = {
  /** Bech32 listing-script address (from the collection's config). */
  listingScriptAddress: string;
  /** 28-byte hex pkh of the connected wallet — written into every datum. */
  listerPkhHex: string;
  /** One or more NFTs to list. Each → one listing UTxO. */
  nfts: ListingNftRef[];
};

export type ListResult = {
  txHash: string;
  /** Listings created: outRef per NFT, in the order they appear in inputs. */
  createdOutRefs: { txHash: string; outputIndex: number; unit: string }[];
};

/* -------------------------------------------------------------------------- */
/* Datum builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Genesis listing datum: {@code Constr 0 [bytes(lister_pkh), Constr 1 []]}
 * — i.e. {@code ListingDatum { lister_pkh, update_ref: None }}. Aiken's
 * {@code Option<ByteArray>} encodes as a Constr where {@code None} is
 * alt 1 with no fields.
 */
export function buildGenesisListingDatum(listerPkhHex: string): string {
  if (!/^[0-9a-fA-F]{56}$/.test(listerPkhHex)) {
    throw new Error("listerPkh must be 56 hex chars (28 bytes)");
  }
  const updateRefNone = new Constr(1, []);
  return Data.to(new Constr(0, [listerPkhHex.toLowerCase(), updateRefNone]));
}

/* -------------------------------------------------------------------------- */
/* Main builder                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build, sign, and submit the batch listing tx. Returns the tx hash and
 * the outRef of each created listing. Output indices are 0..N-1
 * (declaration order), so {@code createdOutRefs[i].outputIndex == i}.
 *
 * <p>Throws on builder / sign / submit failure. The caller surfaces a
 * toast or sticky error to the UI.
 */
export async function submitList(
  lucid: LucidEvolution,
  input: BuildListInput,
): Promise<ListResult> {
  if (input.nfts.length === 0) {
    throw new Error("at least one NFT must be selected");
  }
  // Dedup defensively — listing the same unit twice would mean two
  // copies of an NFT which can never be true under Cardano's 1-per-policy
  // semantics, but a UI bug could try.
  const seen = new Set<string>();
  for (const n of input.nfts) {
    const u = n.unit.toLowerCase();
    if (seen.has(u)) {
      throw new Error(`duplicate unit in selection: ${u}`);
    }
    seen.add(u);
  }

  const datumHex = buildGenesisListingDatum(input.listerPkhHex);

  let tx = lucid.newTx();
  for (const nft of input.nfts) {
    const unit = nft.unit.toLowerCase();
    const assets: Assets = {
      lovelace: DEFAULT_LISTING_LOVELACE,
      [unit]: 1n,
    };
    tx = tx.pay.ToAddressWithData(
      input.listingScriptAddress,
      { kind: "inline", value: datumHex },
      assets,
    );
  }

  const complete = await tx.complete();

  // Derive the created outrefs from the completed tx body rather than
  // assuming Lucid preserved our declaration order. We match each
  // selected unit to the first output that (a) is at the listing-script
  // address AND (b) carries the unit with quantity 1. This is robust to
  // any future SDK change that reorders outputs (e.g. inserts change
  // before pay calls) — flagged by Codex as a defensive concern.
  const cmlTx = complete.toTransaction();
  const outputs = cmlTx.body().outputs();
  const createdOutRefs: ListResult["createdOutRefs"] = [];
  const claimed = new Set<number>();
  for (const nft of input.nfts) {
    const unit = nft.unit.toLowerCase();
    let foundIdx = -1;
    for (let i = 0; i < outputs.len(); i++) {
      if (claimed.has(i)) continue;
      const o = outputs.get(i);
      if (o.address().to_bech32() !== input.listingScriptAddress) continue;
      if (!outputCarriesUnit(o, unit)) continue;
      foundIdx = i;
      break;
    }
    if (foundIdx < 0) {
      throw new Error(
        `assembled tx does not include a listing output for ${unit}`,
      );
    }
    claimed.add(foundIdx);
    createdOutRefs.push({
      txHash: "", // backfilled after submit
      outputIndex: foundIdx,
      unit,
    });
  }

  const signed = await complete.sign.withWallet().complete();
  const txHash = await signed.submit();
  for (const r of createdOutRefs) r.txHash = txHash;

  return { txHash, createdOutRefs };
}

/**
 * Iterate a CML {@code TransactionOutput}'s multi-asset value and check
 * whether {@code unit} (policy_id_hex + asset_name_hex) is present with
 * quantity 1.
 */
function outputCarriesUnit(o: CML.TransactionOutput, unit: string): boolean {
  const value = o.amount();
  const ma = value.multi_asset();
  if (!ma) return false;
  if (unit.length < 56) return false;
  const policyHex = unit.slice(0, 56);
  const assetNameHex = unit.slice(56);
  const policies = ma.keys();
  for (let p = 0; p < policies.len(); p++) {
    const policy = policies.get(p);
    if (policy.to_hex() !== policyHex) continue;
    const assets = ma.get_assets(policy);
    if (!assets) continue;
    const names = assets.keys();
    const target = assetNameHex.toLowerCase();
    for (let n = 0; n < names.len(); n++) {
      const name = names.get(n);
      // to_hex() returns the raw bytes as hex (no CBOR structure).
      if (name.to_hex() === target) {
        const qty = assets.get(name);
        if (qty === 1n) return true;
      }
    }
  }
  return false;
}
