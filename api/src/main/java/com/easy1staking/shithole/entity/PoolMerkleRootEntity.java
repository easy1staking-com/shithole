package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * One row per merkle root ever produced for a curated pool. Append-only:
 * historical roots from superseded curation snapshots stay queryable so any
 * in-flight {@code wanted_listing} that committed an older root remains
 * fulfillable.
 *
 * <p>{@code merkleRoot} is the 32-byte sha2_256-derived root from the
 * aiken_merkle_tree library (Java port: merkle-tree-java:0.0.7), THE PK.
 * Multiple historical roots may share a {@code ticker}.
 *
 * <p>{@code assetNamesHex} is the canonical-ordered (lexicographic ascending)
 * list of 28-byte asset names that produced this root, stored as a JSONB
 * array of lowercase hex strings. Order is LOAD-BEARING: changing it produces
 * a different root via the library's left-leaning split-by-half construction.
 *
 * <p>{@code isActive} flips true iff this row is the current curation's root
 * for its ticker. Superseded rows stay; they just have {@code isActive = false}.
 * The {@code pool_merkle_roots_active_ticker} partial index targets the
 * isActive=true hot path.
 *
 * <p>{@code sourceNftVersion} / {@code sourceCurationVersion} record which
 * snapshot of {@link NftTraitsEntity} + {@link PoolCurationEntity} produced
 * this root, for "what changed?" provenance after a fix-and-rebuild.
 */
@Entity
@Table(name = "pool_merkle_roots")
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PoolMerkleRootEntity {

    /** 32-byte sha2_256 root. */
    @Id
    @Column(name = "merkle_root")
    private byte[] merkleRoot;

    @Column(name = "ticker", nullable = false, length = 64)
    private String ticker;

    /** Mirror of {@link PoolCurationEntity#getPoolId()} at compute time. */
    @Column(name = "pool_id")
    private byte[] poolId;

    /** JSONB array of lowercase asset_name hex strings, canonical-ordered. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "asset_names_hex", nullable = false, columnDefinition = "jsonb")
    private List<String> assetNamesHex;

    @Column(name = "total_assets", nullable = false)
    private Integer totalAssets;

    @Column(name = "is_active", nullable = false)
    private Boolean isActive;

    @Column(name = "source_nft_version", nullable = false, length = 64)
    private String sourceNftVersion;

    @Column(name = "source_curation_version", nullable = false, length = 64)
    private String sourceCurationVersion;

    @Column(name = "computed_at", nullable = false)
    private OffsetDateTime computedAt;
}
