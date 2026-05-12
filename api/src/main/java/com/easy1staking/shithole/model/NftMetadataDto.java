package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * NFT metadata response. Shape matches FE fixture {@code nft/<unit>.json}.
 *
 * <p>{@code traits} is a list of single-entry maps mirroring the on-chain CIP-25
 * convention {@code [{"Background": "Cyan"}, {"Fur": "Original"}]}.
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

    private List<Map<String, String>> traits;

    private String description;
}
