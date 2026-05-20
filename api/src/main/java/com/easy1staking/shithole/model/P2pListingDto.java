package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

/**
 * Public view of a v3 wanted-listing row. Drives the FE's /p2p browse
 * page + /me/p2p "your listings" view. Snake-case wire to match the
 * rest of the API.
 *
 * <p>{@code spent_action} is null for active listings. The FE filters
 * active vs historical client-side based on this field (in addition to
 * the BE endpoint's own filters).
 */
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public record P2pListingDto(
        @JsonProperty("tx_hash") String txHash,
        @JsonProperty("output_index") Integer outputIndex,
        @JsonProperty("config_nft_policy") String configNftPolicy,
        @JsonProperty("buyer_pkh") String buyerPkh,
        @JsonProperty("buyer_address_bech32") String buyerAddressBech32,
        @JsonProperty("accepted_merkle_root") String acceptedMerkleRoot,
        @JsonProperty("offered_nft_unit") String offeredNftUnit,
        @JsonProperty("lovelace") Long lovelace,
        @JsonProperty("created_at_slot") Long createdAtSlot,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("spent_action") String spentAction,
        @JsonProperty("spent_at_slot") Long spentAtSlot,
        @JsonProperty("spent_at") String spentAt,
        @JsonProperty("spent_by_tx_hash") String spentByTxHash,
        @JsonProperty("fulfiller_pkh") String fulfillerPkh) {
}
