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

    /** Where this collection appears: {@code pit}, {@code marketplace}, or {@code both}. */
    @Column(name = "surface")
    private String surface;

    /** Default pricing token for the list form — hex policy id ({@code null}/empty = ADA). */
    @Column(name = "default_price_policy")
    private String defaultPricePolicy;

    /** Default pricing token — hex asset name. */
    @Column(name = "default_price_name")
    private String defaultPriceName;

    /** Default pricing token — smallest-unit exponent (ADA=6, HOSKY/SNEK=0). */
    @Column(name = "default_price_decimals")
    private Integer defaultPriceDecimals;

    /** Default pricing token — display label (e.g. {@code HOSKY}, {@code SNEK}, {@code ADA}). */
    @Column(name = "price_token_label")
    private String priceTokenLabel;
}
