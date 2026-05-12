package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

/**
 * CIP-171 auto-discovered candidate config (see docs/BACKEND.md §CIP-171).
 */
@Entity
@Table(name = "candidate_configs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CandidateConfigEntity {

    @Id
    @Column(name = "config_nft_policy")
    private String configNftPolicy;

    @Column(name = "source_url")
    private String sourceUrl;

    @Column(name = "commit_hash")
    private String commitHash;

    @Column(name = "compiler_version")
    private String compilerVersion;

    @Column(name = "source_path")
    private String sourcePath;

    @Column(name = "discovered_slot")
    private Long discoveredSlot;

    @Column(name = "discovered_tx_hash")
    private String discoveredTxHash;

    @Column(name = "discovered_at")
    private OffsetDateTime discoveredAt;

    @Column(name = "status")
    private String status;

    @Column(name = "notes")
    private String notes;
}
