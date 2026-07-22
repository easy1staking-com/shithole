package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * One row of the public per-collection marketplace activity feed. Native price
 * is always present; ADA/USD are best-effort estimates (null → omitted).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class MarketActivityDto {

    /** {@code listed | sold | cancelled | spent}. */
    private String event;

    /** Listed NFT unit (policy + asset name), hex. */
    @JsonProperty("nft_unit")
    private String nftUnit;

    private Price price;

    @JsonProperty("ada_estimate")
    private BigDecimal adaEstimate;

    @JsonProperty("usd_estimate")
    private BigDecimal usdEstimate;

    /** pkh (hex) of the wallet on this event's side — buyer for {@code sold}, else seller. */
    private String wallet;

    /** ISO-8601 timestamp of the event (spent time if terminal, else listed time). */
    private String ts;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Price {
        /** Smallest-unit amount as a string (avoids JS number-precision loss). */
        @JsonProperty("native_qty")
        private String nativeQty;
        @JsonProperty("token_label")
        private String tokenLabel;
        private Integer decimals;
    }
}
