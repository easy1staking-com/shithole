package com.easy1staking.shithole.model;

import lombok.Builder;

import java.util.List;

/**
 * Membership proof for a single asset_name against a known merkle root.
 * Shape mirrors {@code aiken_merkle_tree/mt.Proof}: each item is a Left or
 * Right step in the verification chain. The FE forwards these unchanged
 * into a {@code Fulfill} redeemer's {@code merkle_proof} field.
 */
@Builder
public record ProofDto(
        String merkleRootHex,
        String assetNameHex,
        List<ProofStep> proof) {

    /**
     * One step in the proof. {@code side} is "left" or "right"; {@code hashHex}
     * is the 32-byte sibling hash at that level (lowercase hex). The FE just
     * routes this through; the on-chain validator does the actual verify.
     */
    @Builder
    public record ProofStep(
            String side,
            String hashHex) {
    }
}
