package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

/**
 * Public view of one row in {@code pool_merkle_roots}. Fields are hex-encoded
 * for FE consumption. Wire format is snake_case to match the rest of the
 * API (see {@code CuratedCollectionDto} etc).
 */
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PoolDto(
        @JsonProperty("ticker") String ticker,
        @JsonProperty("pool_id_hex") String poolIdHex,
        @JsonProperty("merkle_root_hex") String merkleRootHex,
        @JsonProperty("total_assets") Integer totalAssets,
        @JsonProperty("is_active") Boolean isActive) {
}
