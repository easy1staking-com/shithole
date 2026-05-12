package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Materialized on-chain {@code ConfigDatum} (SPEC §3.1).
 * Matches FE fixture {@code collections/hosky.json#config}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConfigDatumDto {

    private Integer m;

    @JsonProperty("protocol_fee")
    private Long protocolFee;

    @JsonProperty("lister_fee")
    private Long listerFee;

    @JsonProperty("treasury_addr")
    private AddressDto treasuryAddr;

    @JsonProperty("admin_pkh")
    private String adminPkh;
}
