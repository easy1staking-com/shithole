package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

import java.util.List;

/**
 * Membership proof for a single asset_name against a known merkle root.
 * Shape mirrors {@code aiken_merkle_tree/mt.Proof}: each item is a Left or
 * Right step in the verification chain. The FE forwards these unchanged
 * into a {@code Fulfill} redeemer's {@code merkle_proof} field. Snake-case
 * wire to match the rest of the API.
 */
@Builder
public record ProofDto(
        @JsonProperty("merkle_root_hex") String merkleRootHex,
        @JsonProperty("asset_name_hex") String assetNameHex,
        @JsonProperty("proof") List<ProofStep> proof) {

    /**
     * One step in the proof. {@code side} is "left" or "right"; {@code hashHex}
     * is the 32-byte sibling hash at that level (lowercase hex). The FE just
     * routes this through; the on-chain validator does the actual verify.
     */
    @Builder
    public record ProofStep(
            @JsonProperty("side") String side,
            @JsonProperty("hash_hex") String hashHex) {
    }
}
