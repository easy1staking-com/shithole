package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Full per-collection state. Shape matches FE fixture {@code collections/hosky.json}.
 *
 * <p>Backed by {@link com.easy1staking.shithole.entity.CuratedCollectionEntity} +
 * {@link com.easy1staking.shithole.entity.ConfigEntity} + indexed listings.
 * For bootstrap this round it's served straight from a fixture file.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CollectionStateDto {

    private String slug;

    @JsonProperty("config_nft_policy")
    private String configNftPolicy;

    @JsonProperty("collection_policy_id")
    private String collectionPolicyId;

    @JsonProperty("display_name")
    private String displayName;

    private ThemeDto theme;

    private ConfigDatumDto config;

    @JsonProperty("listing_script_address")
    private String listingScriptAddress;

    private CollectionStatsDto stats;

    @JsonProperty("m_staleness")
    private MStalenessDto mStaleness;
}
