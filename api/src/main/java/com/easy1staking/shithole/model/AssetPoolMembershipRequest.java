package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Body for {@code POST /api/p2p/asset-pool-membership} — batch lookup of
 * which active pools accept each asset_name. The FE's wallet NFT picker
 * sends one of these per page-load to render pool ribbons + drive the
 * "select unmatched" affordance.
 */
public record AssetPoolMembershipRequest(
        @JsonProperty("asset_names_hex") List<String> assetNamesHex) {
}
