package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response payload for a successful {@code POST /api/configs}. Echoes the
 * fields the FE submitted plus everything we extracted/derived from the
 * on-chain config UTxO.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConfigRegistrationResponseDto {

    @JsonProperty("config_nft_policy")
    private String configNftPolicy;

    private String slug;

    /** 28-byte asset name of the config NFT = collection policy id (per SPEC §3.1). */
    @JsonProperty("collection_policy_id")
    private String collectionPolicyId;

    private Integer m;

    @JsonProperty("protocol_fee")
    private Long protocolFee;

    @JsonProperty("lister_fee")
    private Long listerFee;

    @JsonProperty("admin_pkh")
    private String adminPkh;

    @JsonProperty("treasury_addr_bech32")
    private String treasuryAddrBech32;

    @JsonProperty("utxo_tx_id")
    private String utxoTxId;

    @JsonProperty("utxo_output_index")
    private Integer utxoOutputIndex;

    @JsonProperty("display_name")
    private String displayName;

    private ThemeDto theme;

    /**
     * True if the submission's {@code admin_pkh} matches one of the configured
     * operator pkhs and was therefore promoted into {@code curated_collections}
     * (visible on {@code GET /api/curated} + the FE pit page). False means
     * the config was registered (indexer watches its listings) but is not
     * surfaced to the public FE — re-submit later from an operator-controlled
     * wallet to promote, or expose via a future admin endpoint.
     */
    private boolean curated;
}
