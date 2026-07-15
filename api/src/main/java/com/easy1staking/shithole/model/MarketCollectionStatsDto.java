package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * Public per-collection marketplace stats. Volume/floor are normalized to ADA
 * (and USD) since listings span multiple pricing tokens; both are best-effort
 * estimates and rendered "≈ estimated" in the UI.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MarketCollectionStatsDto {

    @JsonProperty("active_listings")
    private Integer activeListings;

    @JsonProperty("sales_24h")
    private Integer sales24h;

    @JsonProperty("unique_traders_24h")
    private Integer uniqueTraders24h;

    /** 24h sold volume, normalized to ADA (sum of per-sale ADA estimates). */
    @JsonProperty("volume_24h_ada")
    private BigDecimal volume24hAda;

    @JsonProperty("volume_24h_usd")
    private BigDecimal volume24hUsd;

    /** Cheapest active listing, by ADA-equivalent. Null when there are none. */
    private Floor floor;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Floor {
        @JsonProperty("native_qty")
        private String nativeQty;
        @JsonProperty("token_label")
        private String tokenLabel;
        private Integer decimals;
        @JsonProperty("ada_estimate")
        private BigDecimal adaEstimate;
        @JsonProperty("usd_estimate")
        private BigDecimal usdEstimate;
    }
}
