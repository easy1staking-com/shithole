package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Builder;

/**
 * Public view of one row in {@code pool_merkle_roots}. Fields are hex-encoded
 * for FE consumption.
 */
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PoolDto(
        String ticker,
        String poolIdHex,
        String merkleRootHex,
        Integer totalAssets,
        Boolean isActive) {
}
