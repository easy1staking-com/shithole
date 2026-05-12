package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Cardano {@code OutputReference} (transaction id + output index).
 * Used both for listing UTxO refs and for the {@code update_ref} field.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OutRefDto {

    @JsonProperty("tx_id")
    private String txId;

    @JsonProperty("output_index")
    private Integer outputIndex;
}
