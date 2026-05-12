package com.easy1staking.shithole.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Composite primary key for {@link ListingEntity}.
 * Matches the on-chain (config, outRef) tuple uniquely identifying a listing UTxO.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListingId implements Serializable {
    private String configNftPolicy;
    private String utxoTxId;
    private Integer utxoOutputIndex;
}
