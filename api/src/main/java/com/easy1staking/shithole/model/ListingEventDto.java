package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

/**
 * Full-fat row view of a {@code listing_events} entry, used by the
 * wallet-history endpoint {@code GET /api/listings/by-pkh/{pkh}}.
 *
 * <p>Different shape from {@link ListingDto} (which is the "live listing"
 * view used by browse pages — no spent fields, no lineage) and from
 * {@link ListingHistoryEventDto} (which is the per-row timeline event in
 * the lineage endpoint). This DTO carries everything the FE needs to
 * synthesise both a {@code listed} and a {@code swapped|cancelled|recovered}
 * event for a single chain row.
 *
 * <p>Snake-case wire to match the rest of the API. Null fields are
 * stripped — active rows simply omit {@code spent_action} etc.
 */
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ListingEventDto(
        @JsonProperty("tx_hash") String txHash,
        @JsonProperty("output_index") Integer outputIndex,
        @JsonProperty("initial_tx_hash") String initialTxHash,
        @JsonProperty("initial_output_index") Integer initialOutputIndex,
        @JsonProperty("swap_index") Integer swapIndex,
        @JsonProperty("config_nft_policy") String configNftPolicy,
        @JsonProperty("lister_pkh") String listerPkh,
        @JsonProperty("nft_unit") String nftUnit,
        @JsonProperty("lovelace") Long lovelace,
        @JsonProperty("created_at_slot") Long createdAtSlot,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("spent_at_slot") Long spentAtSlot,
        @JsonProperty("spent_at") String spentAt,
        @JsonProperty("spent_by_tx_hash") String spentByTxHash,
        @JsonProperty("spent_action") String spentAction,
        @JsonProperty("swapper_pkh") String swapperPkh) {
}
