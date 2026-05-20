import { describe, expect, it } from "vitest";

import {
  mergeChronological,
  synthesizeP2pEvents,
  synthesizePitEvents,
  type WalletHistoryEvent,
} from "@/lib/me/historyEvents";
import type { ListingEvent, P2pListing } from "@/types/api";

const MY = "a".repeat(56);
const OTHER = "b".repeat(56);
const POLICY = "c".repeat(56);
const COLL = "d".repeat(56);

function pitRow(over: Partial<ListingEvent>): ListingEvent {
  return {
    tx_hash: "1".repeat(64),
    output_index: 0,
    initial_tx_hash: "1".repeat(64),
    initial_output_index: 0,
    swap_index: 0,
    config_nft_policy: POLICY,
    lister_pkh: MY,
    nft_unit: COLL + "61".repeat(28),
    lovelace: 2_000_000,
    created_at_slot: 100,
    created_at: "2026-05-19T00:00:00Z",
    ...over,
  };
}

function p2pRow(over: Partial<P2pListing>): P2pListing {
  return {
    tx_hash: "2".repeat(64),
    output_index: 0,
    config_nft_policy: POLICY,
    buyer_pkh: MY,
    buyer_address_bech32: "addr_test1qbuyer",
    accepted_merkle_root: "e".repeat(64),
    offered_nft_unit: COLL + "62".repeat(28),
    lovelace: 5_000_000,
    created_at_slot: 200,
    created_at: "2026-05-19T01:00:00Z",
    ...over,
  };
}

describe("synthesizePitEvents", () => {
  it("emits one 'listed' for an active listing the viewer created", () => {
    const events = synthesizePitEvents([pitRow({})], MY);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "listed", role: "lister" });
  });

  it("emits no events when the viewer is unrelated to the row", () => {
    const events = synthesizePitEvents([pitRow({ lister_pkh: OTHER })], MY);
    expect(events).toEqual([]);
  });

  it("emits 'listed' + 'swapped' (lister role) on a spent swap", () => {
    const events = synthesizePitEvents(
      [
        pitRow({
          spent_action: "swap",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 300,
          spent_by_tx_hash: "9".repeat(64),
        }),
      ],
      MY,
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toContain("listed");
    expect(events.map((e) => e.kind)).toContain("swapped");
  });

  it("emits only 'swapped' (swapper role) when the viewer is the swapper", () => {
    const events = synthesizePitEvents(
      [
        pitRow({
          lister_pkh: OTHER,
          swapper_pkh: MY,
          spent_action: "swap",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 300,
        }),
      ],
      MY,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "swapped", role: "swapper" });
  });

  it("emits 'cancelled' (lister role) on a cancel spend", () => {
    const events = synthesizePitEvents(
      [
        pitRow({
          spent_action: "cancel",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 300,
        }),
      ],
      MY,
    );
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.kind === "cancelled")).toBeTruthy();
  });
});

describe("synthesizeP2pEvents", () => {
  it("emits 'posted' for an active listing the viewer created", () => {
    const events = synthesizeP2pEvents([p2pRow({})], MY);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "posted", role: "buyer" });
  });

  it("emits 'fulfilled' (fulfiller role) when the viewer is the fulfiller", () => {
    const events = synthesizeP2pEvents(
      [
        p2pRow({
          buyer_pkh: OTHER,
          fulfiller_pkh: MY,
          spent_action: "fulfill",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 350,
        }),
      ],
      MY,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "fulfilled", role: "fulfiller" });
  });

  it("emits 'reclaimed' only for the buyer when spent_action is reclaim", () => {
    const events = synthesizeP2pEvents(
      [
        p2pRow({
          spent_action: "reclaim",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 350,
        }),
      ],
      MY,
    );
    expect(events.find((e) => e.kind === "reclaimed")).toBeTruthy();
  });

  it("does not duplicate fulfilled event when viewer is both buyer and fulfiller", () => {
    const events = synthesizeP2pEvents(
      [
        p2pRow({
          fulfiller_pkh: MY, // viewer fulfilled their own listing (edge case)
          spent_action: "fulfill",
          spent_at: "2026-05-19T02:00:00Z",
          spent_at_slot: 350,
        }),
      ],
      MY,
    );
    // posted + fulfilled (one of them, buyer-side wins).
    const fulfilledEvents = events.filter((e) => e.kind === "fulfilled");
    expect(fulfilledEvents).toHaveLength(1);
    expect(fulfilledEvents[0].role).toBe("buyer");
  });
});

describe("mergeChronological", () => {
  it("sorts by atSlot DESC across streams", () => {
    const a: WalletHistoryEvent = {
      id: "a",
      kind: "listed",
      source: "pit",
      role: "lister",
      at: "2026-05-19T00:00:00Z",
      atSlot: 100,
      txHash: "1".repeat(64),
      nftUnit: "x",
      lovelace: 0,
    };
    const b: WalletHistoryEvent = { ...a, id: "b", atSlot: 300 };
    const c: WalletHistoryEvent = { ...a, id: "c", atSlot: 200 };
    const merged = mergeChronological([a, c], [b]);
    expect(merged.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
});
