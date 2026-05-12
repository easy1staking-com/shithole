package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Structured Cardano address. Matches FE fixture
 * {@code collections/hosky.json#config.treasury_addr}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class AddressDto {

    @JsonProperty("payment_credential")
    private CredentialDto paymentCredential;

    @JsonProperty("stake_credential")
    private CredentialDto stakeCredential;
}
