package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Cardano credential discriminator (verification_key | script).
 * Matches FE fixture {@code collections/hosky.json#config.treasury_addr.payment_credential}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class CredentialDto {

    private String type;    // "verification_key" | "script"
    private String hash;
}
