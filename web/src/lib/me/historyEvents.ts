/**
 * Wallet-history event synthesis.
 *
 * Two BE endpoints return *rows* — one for the pit lineage table, one for
 * the p2p wanted_listing_events table. A row describes a UTxO at a point
 * in time, not a discrete event. The FE expands each row into 0..2
 * timeline events based on the row's role:
 *
 *   - "listed" / "posted" — emitted at created_at when the wallet is the
 *     row's creator (lister / buyer).
 *   - "swapped" / "cancelled" / "recovered" — emitted at spent_at when the
 *     row was terminal. Role flips between lister and swapper depending
 *     on which pkh matches the viewer's wallet.
 *   - "fulfilled" / "reclaimed" / "rescued" — same idea on the p2p side.
 *
 * A single row can produce two events with different ids — one at the
 * created slot, one at the spent slot. {@link mergeChronological} sorts
 * both streams by atSlot DESC for a unified feed.
 */

import type { ListingEvent, P2pListing } from "@/types/api";

export type EventKind =
  | "listed"
  | "swapped"
  | "cancelled"
  | "recovered"
  | "spent_unknown_pit"
  | "posted"
  | "fulfilled"
  | "reclaimed"
  | "rescued"
  | "spent_unknown_p2p";

export type EventSource = "pit" | "p2p";

export type EventRole = "lister" | "swapper" | "buyer" | "fulfiller";

export type WalletHistoryEvent = {
  /** `${kind}:${txHash}#${outputIndex}:${atSlot}` — stable + unique even when a row emits two events. */
  id: string;
  kind: EventKind;
  source: EventSource;
  role: EventRole;
  /** ISO timestamp of the event. */
  at: string;
  /** Slot of the event. Primary sort key. */
  atSlot: number;
  /** Tx that PRODUCED the event (created the listing OR spent it). */
  txHash: string;
  outputIndex?: number;
  /** policy_id + asset_name concatenated lowercase hex. */
  nftUnit: string;
  /** Total lovelace in the UTxO at the time of the event. */
  lovelace: number;
  /** Pit only — collection identifier. */
  configNftPolicy?: string;
  /** P2p only — the buyer's accepted_merkle_root at listing time. */
  acceptedMerkleRoot?: string;
  /** P2p only — bech32 of the buyer's delivery address. */
  buyerAddressBech32?: string;
};

/**
 * Expand a pit listing-events row into 0..2 events from the viewer's
 * perspective. The viewer is identified by their payment-key hash (hex,
 * lowercase). A row contributes:
 *
 *   - "listed" if {@code lister_pkh === myPkh}.
 *   - if spent: a follow-up event at spent_at, with role chosen by which
 *     pkh on the row matches the viewer (lister for cancel/recover,
 *     lister or swapper for swap).
 */
export function synthesizePitEvents(
  rows: ListingEvent[],
  myPkhHex: string,
): WalletHistoryEvent[] {
  const me = myPkhHex.toLowerCase();
  const out: WalletHistoryEvent[] = [];
  for (const row of rows) {
    const isLister = row.lister_pkh?.toLowerCase() === me;
    const isSwapper = row.swapper_pkh?.toLowerCase() === me;

    if (isLister) {
      out.push({
        id: `listed:${row.tx_hash}#${row.output_index}:${row.created_at_slot}`,
        kind: "listed",
        source: "pit",
        role: "lister",
        at: row.created_at,
        atSlot: row.created_at_slot,
        txHash: row.tx_hash,
        outputIndex: row.output_index,
        nftUnit: row.nft_unit,
        lovelace: row.lovelace,
        configNftPolicy: row.config_nft_policy,
      });
    }

    // Terminal event (only if spent).
    if (row.spent_action && row.spent_at && row.spent_at_slot != null) {
      const action = row.spent_action;
      const spentTx = row.spent_by_tx_hash ?? row.tx_hash;
      const kind: EventKind | null = pitTerminalKind(action);
      if (!kind) continue;

      if (action === "swap") {
        // Swap fires for both sides — lister AND swapper. If the viewer is
        // both (rare but possible), de-dup by emitting only once (role=lister).
        if (isLister) {
          out.push({
            id: `swapped:lister:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
            kind: "swapped",
            source: "pit",
            role: "lister",
            at: row.spent_at,
            atSlot: row.spent_at_slot,
            txHash: spentTx,
            outputIndex: row.output_index,
            nftUnit: row.nft_unit,
            lovelace: row.lovelace,
            configNftPolicy: row.config_nft_policy,
          });
        } else if (isSwapper) {
          out.push({
            id: `swapped:swapper:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
            kind: "swapped",
            source: "pit",
            role: "swapper",
            at: row.spent_at,
            atSlot: row.spent_at_slot,
            txHash: spentTx,
            outputIndex: row.output_index,
            nftUnit: row.nft_unit,
            lovelace: row.lovelace,
            configNftPolicy: row.config_nft_policy,
          });
        }
      } else {
        // cancel | recover | spent_unknown — always lister-side.
        if (isLister) {
          out.push({
            id: `${kind}:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
            kind,
            source: "pit",
            role: "lister",
            at: row.spent_at,
            atSlot: row.spent_at_slot,
            txHash: spentTx,
            outputIndex: row.output_index,
            nftUnit: row.nft_unit,
            lovelace: row.lovelace,
            configNftPolicy: row.config_nft_policy,
          });
        }
      }
    }
  }
  return out;
}

function pitTerminalKind(action: string): EventKind | null {
  switch (action) {
    case "swap":
      return "swapped";
    case "cancel":
      return "cancelled";
    case "recover":
      return "recovered";
    case "spent_unknown":
      return "spent_unknown_pit";
    default:
      return null;
  }
}

/**
 * Same idea for p2p wanted-listings. A row contributes:
 *
 *   - "posted" if {@code buyer_pkh === myPkh}.
 *   - if spent: "fulfilled" / "reclaimed" / "rescued" with the right role.
 */
export function synthesizeP2pEvents(
  rows: P2pListing[],
  myPkhHex: string,
): WalletHistoryEvent[] {
  const me = myPkhHex.toLowerCase();
  const out: WalletHistoryEvent[] = [];
  for (const row of rows) {
    const isBuyer = row.buyer_pkh?.toLowerCase() === me;
    const isFulfiller = row.fulfiller_pkh?.toLowerCase() === me;

    if (isBuyer) {
      out.push({
        id: `posted:${row.tx_hash}#${row.output_index}:${row.created_at_slot}`,
        kind: "posted",
        source: "p2p",
        role: "buyer",
        at: row.created_at,
        atSlot: row.created_at_slot,
        txHash: row.tx_hash,
        outputIndex: row.output_index,
        nftUnit: row.offered_nft_unit,
        lovelace: row.lovelace,
        configNftPolicy: row.config_nft_policy,
        acceptedMerkleRoot: row.accepted_merkle_root,
        buyerAddressBech32: row.buyer_address_bech32,
      });
    }

    if (row.spent_action && row.spent_at && row.spent_at_slot != null) {
      const action = row.spent_action;
      const spentTx = row.spent_by_tx_hash ?? row.tx_hash;
      const kind = p2pTerminalKind(action);
      if (!kind) continue;

      if (action === "fulfill") {
        // Fulfill fires for buyer AND fulfiller. De-dup if both.
        if (isBuyer) {
          out.push({
            id: `fulfilled:buyer:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
            kind: "fulfilled",
            source: "p2p",
            role: "buyer",
            at: row.spent_at,
            atSlot: row.spent_at_slot,
            txHash: spentTx,
            outputIndex: row.output_index,
            nftUnit: row.offered_nft_unit,
            lovelace: row.lovelace,
            configNftPolicy: row.config_nft_policy,
            acceptedMerkleRoot: row.accepted_merkle_root,
            buyerAddressBech32: row.buyer_address_bech32,
          });
        } else if (isFulfiller) {
          out.push({
            id: `fulfilled:fulfiller:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
            kind: "fulfilled",
            source: "p2p",
            role: "fulfiller",
            at: row.spent_at,
            atSlot: row.spent_at_slot,
            txHash: spentTx,
            outputIndex: row.output_index,
            nftUnit: row.offered_nft_unit,
            lovelace: row.lovelace,
            configNftPolicy: row.config_nft_policy,
            acceptedMerkleRoot: row.accepted_merkle_root,
            buyerAddressBech32: row.buyer_address_bech32,
          });
        }
      } else if (isBuyer) {
        // reclaim | rescue | spent_unknown — buyer-side only.
        out.push({
          id: `${kind}:${row.tx_hash}#${row.output_index}:${row.spent_at_slot}`,
          kind,
          source: "p2p",
          role: "buyer",
          at: row.spent_at,
          atSlot: row.spent_at_slot,
          txHash: spentTx,
          outputIndex: row.output_index,
          nftUnit: row.offered_nft_unit,
          lovelace: row.lovelace,
          configNftPolicy: row.config_nft_policy,
          acceptedMerkleRoot: row.accepted_merkle_root,
          buyerAddressBech32: row.buyer_address_bech32,
        });
      }
    }
  }
  return out;
}

function p2pTerminalKind(action: string): EventKind | null {
  switch (action) {
    case "fulfill":
      return "fulfilled";
    case "reclaim":
      return "reclaimed";
    case "rescue":
      return "rescued";
    case "spent_unknown":
      return "spent_unknown_p2p";
    default:
      return null;
  }
}

/**
 * Merge two event streams into one sorted by atSlot DESC. Stable for ties
 * — earlier entries (from the first stream) win when slots match, which
 * matters for the rare same-slot pit-and-p2p activity from one wallet.
 */
export function mergeChronological(
  ...streams: WalletHistoryEvent[][]
): WalletHistoryEvent[] {
  const out: WalletHistoryEvent[] = [];
  for (const s of streams) out.push(...s);
  out.sort((a, b) => b.atSlot - a.atSlot);
  return out;
}
