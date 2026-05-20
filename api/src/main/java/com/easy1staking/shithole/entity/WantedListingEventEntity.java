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

import java.time.OffsetDateTime;

/**
 * One row per wanted-listing UTxO ever observed at a watched
 * wanted_listing script address. Created on output observation, flipped
 * to "spent" when its outref is consumed.
 *
 * <p>Unlike v2 listings (which replant via Swap), v3 wanted listings
 * DISSOLVE on fulfill — so this table is flat, not a lineage. "Active"
 * listings = rows with {@code spent_action IS NULL}.
 *
 * <p>{@code spent_action} is one of {@code fulfill | reclaim | rescue |
 * spent_unknown}. The v1 indexer marks every terminal spend as
 * {@code spent_unknown}; redeemer-driven classification is a follow-up.
 *
 * <p>Not {@code @Data} for the same reason as
 * {@link ListingEventEntity} — byte[] equals/hashCode quirks.
 */
@Entity
@Table(name = "wanted_listing_events")
@IdClass(WantedListingEventId.class)
@Getter
@Setter
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WantedListingEventEntity {

    @Id
    @Column(name = "tx_hash")
    private byte[] txHash;

    @Id
    @Column(name = "output_index")
    private Integer outputIndex;

    @Column(name = "config_nft_policy", nullable = false)
    private byte[] configNftPolicy;

    @Column(name = "buyer_pkh", nullable = false)
    private byte[] buyerPkh;

    /** Full bech32 — the on-chain validator does full-Address equality. */
    @Column(name = "buyer_address_bech32", nullable = false, length = 160)
    private String buyerAddressBech32;

    @Column(name = "accepted_merkle_root", nullable = false)
    private byte[] acceptedMerkleRoot;

    /** policy_id (28) + asset_name (0..32 bytes). */
    @Column(name = "offered_nft_unit", nullable = false)
    private byte[] offeredNftUnit;

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

    /** {@code fulfill | reclaim | rescue | spent_unknown}; null = active. */
    @Column(name = "spent_action", length = 16)
    private String spentAction;

    /**
     * Payment-key hash of the wallet that fulfilled this listing.
     * Stamped when a Fulfill spends the wanted-listing UTxO and the
     * indexer can pin a single non-buyer, non-script counterparty in
     * the spend tx's outputs. {@code null} on active rows, on
     * reclaim/rescue rows, and on rows the indexer couldn't classify.
     */
    @Column(name = "fulfiller_pkh")
    private byte[] fulfillerPkh;
}
