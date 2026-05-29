package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.math.BigInteger;
import java.time.OffsetDateTime;

/**
 * One row per marketplace listing UTxO ever observed at the singleton
 * marketplace script address. Created on output observation, flipped
 * to "spent" when its outref is consumed.
 *
 * <p>Marketplace listings DISSOLVE on either {@code Buy} (NFT → buyer,
 * ADA → seller) or {@code Cancel} (everything → seller). So this table
 * is flat, not a lineage. "Active" rows = {@code spent_action IS NULL}.
 *
 * <p>{@code spent_action} is one of {@code sold | cancelled | spent_unknown}.
 * The indexer classifies via the Spend redeemer constructor (Buy → sold,
 * Cancel → cancelled) and falls back to {@code spent_unknown} only when
 * the redeemer can't be pulled.
 *
 * <p>Not {@code @Data} for the same reason as {@link ListingEventEntity}
 * and {@link WantedListingEventEntity} — byte[] equals/hashCode quirks.
 */
@Entity
@Table(name = "marketplace_events")
@IdClass(MarketplaceEventId.class)
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MarketplaceEventEntity {

    @Id
    @Column(name = "tx_hash")
    private byte[] txHash;

    @Id
    @Column(name = "output_index")
    private Integer outputIndex;

    @Column(name = "seller_pkh", nullable = false)
    private byte[] sellerPkh;

    /** Full bech32 — validator does Address equality on Buy payout. */
    @Column(name = "seller_address_bech32", nullable = false, length = 160)
    private String sellerAddressBech32;

    /** Empty bytes for ADA-priced listings (lovelace policy + name). */
    @Column(name = "price_policy", nullable = false)
    private byte[] pricePolicy;

    @Column(name = "price_name", nullable = false)
    private byte[] priceName;

    /** Asking price in smallest units. NUMERIC(38) → BigInteger. */
    @Column(name = "price_qty", nullable = false, precision = 38, scale = 0)
    private BigInteger priceQty;

    @Column(name = "accompanying_lovelace", nullable = false)
    private Long accompanyingLovelace;

    /** policy_id (28) + asset_name (0..32). */
    @Column(name = "listed_nft_unit", nullable = false)
    private byte[] listedNftUnit;

    @Column(name = "lovelace", nullable = false)
    private Long lovelace;

    @Column(name = "created_at_slot", nullable = false)
    private Long createdAtSlot;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "spent_at_slot")
    private Long spentAtSlot;

    @Column(name = "spent_at")
    private OffsetDateTime spentAt;

    @Column(name = "spent_by_tx_hash")
    private byte[] spentByTxHash;

    /** {@code sold | cancelled | spent_unknown}; null = active. */
    @Column(name = "spent_action", length = 16)
    private String spentAction;

    /** Buyer pkh stamped on Buy; null on cancel / active / unknown. */
    @Column(name = "buyer_pkh")
    private byte[] buyerPkh;
}
