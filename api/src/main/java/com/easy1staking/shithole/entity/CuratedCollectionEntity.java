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
 * Curated (promoted) collections surfaced by {@code GET /api/curated}.
 * Promoted from {@link CandidateConfigEntity} via the admin-private API.
 */
@Entity
@Table(name = "curated_collections")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CuratedCollectionEntity {

    @Id
    @Column(name = "slug")
    private String slug;

    @Column(name = "config_nft_policy")
    private String configNftPolicy;

    @Column(name = "collection_policy_id")
    private String collectionPolicyId;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "background_url")
    private String backgroundUrl;

    @Column(name = "accent_color")
    private String accentColor;

    @Column(name = "mascot_image_url")
    private String mascotImageUrl;

    @Column(name = "display_order")
    private Integer displayOrder;

    @Column(name = "promoted_at")
    private OffsetDateTime promotedAt;

    @Column(name = "listing_script_address")
    private String listingScriptAddress;
}
