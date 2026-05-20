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
import java.util.Map;

/**
 * One row per Hosky CashGrab NFT, holding raw CIP-25 trait data. Joined with
 * {@link PoolCurationEntity#getAcceptedTraits()} to derive each pool's
 * trait-matching asset_name set, which then feeds the per-pool merkle tree.
 *
 * <p>{@code asset_name} is the raw 28-byte CIP-14 asset_name (PK). {@code
 * traits} is a JSONB {@code category → value} map (Background → "Cyan",
 * Fur → "Original", ...) mirrored 1:1 from the source jsonl.
 *
 * <p>{@code sourceVersion} is the sha2_256 of the source jsonl file. Same
 * convention as {@link PoolCurationEntity}: a {@link PoolMerkleRootEntity}
 * row records WHICH version of nft_traits its root was computed from, so we
 * can prove provenance + detect mid-flight source drift.
 *
 * <p>Not {@code @Data}: {@code byte[]} fields don't compose with Lombok's
 * generated {@code equals}/{@code hashCode}. Mirrors
 * {@link ListingEventEntity}'s {@code @Getter @Setter} pattern.
 */
@Entity
@Table(name = "nft_traits")
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NftTraitsEntity {

    @Id
    @Column(name = "asset_name")
    private byte[] assetName;

    /** {@code {category: value}} map; e.g. {"Background": "Cyan", "Fur": "Original"}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "traits", nullable = false, columnDefinition = "jsonb")
    private Map<String, String> traits;

    @Column(name = "source_version", nullable = false, length = 64)
    private String sourceVersion;

    @Column(name = "ingested_at", nullable = false)
    private OffsetDateTime ingestedAt;
}
