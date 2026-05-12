package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Curated collection list entry. Shape matches FE fixture {@code curated.json[*]}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CuratedCollectionDto {

    private String slug;

    @JsonProperty("config_nft_policy")
    private String configNftPolicy;

    @JsonProperty("collection_policy_id")
    private String collectionPolicyId;

    @JsonProperty("display_name")
    private String displayName;

    private ThemeDto theme;

    @JsonProperty("display_order")
    private Integer displayOrder;
}
