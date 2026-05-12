package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Aggregate stats per collection. Matches FE fixture
 * {@code collections/hosky.json#stats}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CollectionStatsDto {

    @JsonProperty("n_valid_listings")
    private Integer nValidListings;

    @JsonProperty("total_accrued_lovelace")
    private Long totalAccruedLovelace;

    @JsonProperty("swap_count_24h")
    private Long swapCount24h;
}
