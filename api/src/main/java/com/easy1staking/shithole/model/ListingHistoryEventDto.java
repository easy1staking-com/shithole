package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One row of the listing-history timeline returned by
 * {@code GET /api/listings/{initial_outref}/history}.
 *
 * <p>The shape is action-dependent — only the fields meaningful for the given
 * action are populated; the rest are emitted as {@code null} and the
 * non-null inclusion strategy on this DTO drops them from the JSON.
 *
 * <ul>
 *   <li><b>create</b>: {@code swap_index = 0}, {@code nft_unit} set.</li>
 *   <li><b>swap</b>: {@code na_unit} (NFT that left), {@code nb_unit} (NFT
 *       that arrived). The validator's invariant S6 ties this row's
 *       lineage to the consumed row via {@code compute_output_tag} —
 *       see SPEC §6.3.</li>
 *   <li><b>cancel</b> / <b>recover</b>: terminal marker, no outref / nft
 *       fields needed; only the consuming tx's slot/timestamp.</li>
 * </ul>
 *
 * <p>Full envelope shape in {@code docs/BACKEND.md} §"History endpoint".
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ListingHistoryEventDto {

    @JsonProperty("swap_index")
    private Integer swapIndex;

    /** Hex tx-hash of THIS row's UTxO; null on terminal rows (cancel/recover have no successor UTxO). */
    @JsonProperty("tx_hash")
    private String txHash;

    @JsonProperty("output_index")
    private Integer outputIndex;

    /** Slot at which this event landed on chain. */
    private Long slot;

    /** ISO-8601 timestamp joined from yaci-store's {@code block} table. */
    private String timestamp;

    /** Genesis row: the NFT being listed. */
    @JsonProperty("nft_unit")
    private String nftUnit;

    /** Swap row: the NFT that LEFT this listing (was on the consumed UTxO). */
    @JsonProperty("na_unit")
    private String naUnit;

    /** Swap row: the NFT that ARRIVED in the produced UTxO. */
    @JsonProperty("nb_unit")
    private String nbUnit;

    /** Lovelace held in the produced UTxO at this point in the lineage. */
    private Long lovelace;

    /** {@code "create" | "swap" | "cancel" | "recover"}. */
    private String action;
}
