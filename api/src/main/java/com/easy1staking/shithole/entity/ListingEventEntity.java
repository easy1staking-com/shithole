package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

/**
 * Append-only lineage row for a listing UTxO at a curated spend-script address.
 *
 * <p>One row is inserted for every listing UTxO ever observed. The set of
 * <em>live</em> listings is exactly the rows with {@code spentAction == null};
 * the history of any listing is the chain of rows sharing the same
 * {@code (initialTxHash, initialOutputIndex)} tuple ordered by {@code swapIndex}.
 *
 * <p>Schema, indexes, and lifecycle (genesis / swap / cancel / recover) are
 * documented in {@code docs/BACKEND.md} §"Swap-history lineage tracking".
 * Bytes columns use {@code BYTEA} on Postgres; Java side these are
 * {@code byte[]} (raw tx-hash / policy / pkh / unit bytes, never hex).
 */
@Entity
@Table(name = "listing_events")
@IdClass(ListingEventId.class)
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListingEventEntity {

    /** Output reference of THIS listing UTxO. Composite PK with {@link #outputIndex}. */
    @Id
    @Column(name = "tx_hash")
    private byte[] txHash;

    @Id
    @Column(name = "output_index")
    private Integer outputIndex;

    /**
     * Output reference of the GENESIS UTxO that started this lineage. For a
     * genesis row, {@code (initialTxHash, initialOutputIndex) == (txHash, outputIndex)}.
     * Self-referential FK at the DB layer.
     */
    @Column(name = "initial_tx_hash", nullable = false)
    private byte[] initialTxHash;

    @Column(name = "initial_output_index", nullable = false)
    private Integer initialOutputIndex;

    /** 0 = genesis; 1+ = result of the Nth swap on this lineage. */
    @Column(name = "swap_index", nullable = false)
    private Integer swapIndex;

    @Column(name = "config_nft_policy", nullable = false)
    private byte[] configNftPolicy;

    @Column(name = "lister_pkh", nullable = false)
    private byte[] listerPkh;

    /** {@code policy_id || asset_name} bytes for the NFT currently in this UTxO. */
    @Column(name = "nft_unit", nullable = false)
    private byte[] nftUnit;

    @Column(name = "lovelace", nullable = false)
    private Long lovelace;

    /**
     * {@code compute_output_tag(prev_outref)} for swap rows; {@code null} for
     * genesis rows. Reverse-resolved to a structured outref via
     * {@code listing_events_by_update_ref} when shaping {@code Listing.update_ref}.
     */
    @Column(name = "update_ref_hash")
    private byte[] updateRefHash;

    @Column(name = "created_at_slot", nullable = false)
    private Long createdAtSlot;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    /** {@code null} = still active. */
    @Column(name = "spent_at_slot")
    private Long spentAtSlot;

    @Column(name = "spent_at")
    private OffsetDateTime spentAt;

    @Column(name = "spent_by_tx_hash")
    private byte[] spentByTxHash;

    /** {@code 'swap' | 'cancel' | 'recover'} when consumed; {@code null} while active. */
    @Column(name = "spent_action", length = 16)
    private String spentAction;
}
