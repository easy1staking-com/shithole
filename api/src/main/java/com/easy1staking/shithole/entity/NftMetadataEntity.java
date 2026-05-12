package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

/**
 * Cached NFT metadata + image thumbnails per docs/BACKEND.md §NFT metadata pipeline.
 * Thumbnails (64/256/1024 px) live as Postgres BYTEA columns for v1; switch to
 * object storage only if BYTEA size budget overflows (~100 GB).
 */
@Entity
@Table(name = "nft_metadata")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NftMetadataEntity {

    @Id
    @Column(name = "unit")
    private String unit;

    @Column(name = "policy_id")
    private String policyId;

    @Column(name = "asset_name_hex")
    private String assetNameHex;

    @Column(name = "asset_name")
    private String assetName;

    @Column(name = "fingerprint")
    private String fingerprint;

    @Column(name = "quantity")
    private Long quantity;

    @Column(name = "onchain_metadata_standard")
    private String onchainMetadataStandard;

    @Column(name = "name")
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "image_ipfs_uri")
    private String imageIpfsUri;

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "traits_json", columnDefinition = "TEXT")
    private String traitsJson;

    @Column(name = "raw_onchain_metadata", columnDefinition = "TEXT")
    private String rawOnchainMetadata;

    @Column(name = "image_status")
    private String imageStatus;

    @Column(name = "image_fetch_attempts")
    private Integer imageFetchAttempts;

    @Column(name = "image_last_attempted_at")
    private OffsetDateTime imageLastAttemptedAt;

    @Lob
    @Column(name = "image_thumb_64")
    private byte[] imageThumb64;

    @Lob
    @Column(name = "image_thumb_256")
    private byte[] imageThumb256;

    @Lob
    @Column(name = "image_thumb_1024")
    private byte[] imageThumb1024;

    @Column(name = "fetched_at")
    private OffsetDateTime fetchedAt;
}
