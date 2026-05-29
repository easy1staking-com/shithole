package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

import java.math.BigInteger;

/**
 * Full-fat row view of a {@code marketplace_events} entry, used by
 * {@code GET /api/market/listings/by-pkh/{pkh}} for the /me/history feed.
 *
 * <p>Carries everything the FE needs to synthesise both a {@code listed}
 * event (at create time) and a follow-up {@code sold|cancelled|spent_unknown}
 * event (at spend time), with role assignment by matching the viewer's
 * pkh against {@code seller_pkh} or {@code buyer_pkh}.
 *
 * <p>Snake-case wire to match the rest of the API.
 */
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MarketplaceListingEventDto(
        @JsonProperty("tx_hash") String txHash,
        @JsonProperty("output_index") Integer outputIndex,
        @JsonProperty("seller_pkh") String sellerPkh,
        @JsonProperty("seller_address_bech32") String sellerAddressBech32,
        @JsonProperty("price_policy") String pricePolicy,
        @JsonProperty("price_name") String priceName,
        @JsonProperty("price_qty") BigInteger priceQty,
        @JsonProperty("accompanying_lovelace") Long accompanyingLovelace,
        @JsonProperty("listed_nft_unit") String listedNftUnit,
        @JsonProperty("lovelace") Long lovelace,
        @JsonProperty("created_at_slot") Long createdAtSlot,
        @JsonProperty("created_at") String createdAt,
        @JsonProperty("spent_at_slot") Long spentAtSlot,
        @JsonProperty("spent_at") String spentAt,
        @JsonProperty("spent_by_tx_hash") String spentByTxHash,
        /** {@code sold | cancelled | spent_unknown}; null = active. */
        @JsonProperty("spent_action") String spentAction,
        /** Buyer pkh on {@code sold} rows; null otherwise. */
        @JsonProperty("buyer_pkh") String buyerPkh) {
}
