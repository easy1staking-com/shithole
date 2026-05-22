package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * NFT metadata response. Shape matches FE fixture {@code nft/<unit>.json}.
 *
 * <p>{@code traits} is a list of {@link TraitWithRarity} entries — each carries
 * the trait's {@code category} and {@code value} (always populated), plus a
 * collection-wide {@code count} + {@code pct} when the BE has a rarity table
 * loaded for the NFT's policy. For collections without rarity data, the
 * rarity fields are null and the FE renders without the rarity chip.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class NftMetadataDto {

    private String unit;

    @JsonProperty("policy_id")
    private String policyId;

    @JsonProperty("asset_name_hex")
    private String assetNameHex;

    @JsonProperty("asset_name")
    private String assetName;

    private String fingerprint;

    private Long quantity;

    @JsonProperty("onchain_metadata_standard")
    private String onchainMetadataStandard;

    private String name;

    @JsonProperty("image_ipfs_uri")
    private String imageIpfsUri;

    @JsonProperty("image_url")
    private String imageUrl;

    private List<TraitWithRarity> traits;

    private String description;
}
