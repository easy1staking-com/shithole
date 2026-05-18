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
 * One row per stake pool the v3 wanted-listing curation knows about.
 * Joined with {@link NftTraitsEntity#getTraits()} to produce each pool's
 * trait-matching asset_name set.
 *
 * <p>{@code ticker} (HOSKY, A3C, ...) is the stable identifier across re-
 * curations of the same pool. {@code poolId} is the 28-byte bech32-decoded
 * stake pool hash, nullable because the curation tracks some community pools
 * before their operators publish a pool ID.
 *
 * <p>{@code acceptedTraits} is a JSONB array of {@link TraitFilter} objects;
 * an NFT qualifies for the pool if at least one of its (category, value)
 * pairs matches.
 *
 * <p>{@code sourceVersion} parallels {@link NftTraitsEntity#getSourceVersion()}
 * and together they form the (nft_version, curation_version) tuple recorded
 * on every {@link PoolMerkleRootEntity} so a root's exact inputs are
 * reconstructible.
 */
@Entity
@Table(name = "pool_curation")
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PoolCurationEntity {

    @Id
    @Column(name = "ticker", length = 64)
    private String ticker;

    /** 28-byte bech32-decoded stake pool hash, or null when unknown. */
    @Column(name = "pool_id")
    private byte[] poolId;

    /** JSONB array of {@code {category, value}} filter pairs. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "accepted_traits", nullable = false, columnDefinition = "jsonb")
    private List<TraitFilter> acceptedTraits;

    @Column(name = "source_version", nullable = false, length = 64)
    private String sourceVersion;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
