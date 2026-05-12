package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response envelope for {@code GET /api/listings/{initial_tx_hash}_{initial_output_index}/history}.
 *
 * <p>Wraps the genesis outref (echoing the path param for FE convenience) and
 * the full lineage chain in {@code events} order — first event is the genesis
 * pay-to-script ({@code action == "create"}), last event is either the live
 * listing or the terminal {@code "cancel"}/{@code "recover"} marker.
 *
 * <p>Full shape in {@code docs/BACKEND.md} §"History endpoint".
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ListingHistoryDto {

    @JsonProperty("initial_outref")
    private OutRefDto initialOutref;

    private List<ListingHistoryEventDto> events;
}
