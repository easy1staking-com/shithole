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
 * Well-formed listing UTxO row.
 * Only UTxOs that pass the §10.2 well-formedness filter are stored here.
 */
@Entity
@Table(name = "listings")
@IdClass(ListingId.class)
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListingEntity {

    @Id
    @Column(name = "config_nft_policy")
    private String configNftPolicy;

    @Id
    @Column(name = "utxo_tx_id")
    private String utxoTxId;

    @Id
    @Column(name = "utxo_output_index")
    private Integer utxoOutputIndex;

    @Column(name = "lister_pkh")
    private String listerPkh;

    @Column(name = "current_nft_unit")
    private String currentNftUnit;

    @Column(name = "lovelace")
    private Long lovelace;

    @Column(name = "accrued_lovelace")
    private Long accruedLovelace;

    @Column(name = "update_ref_tx_id")
    private String updateRefTxId;

    @Column(name = "update_ref_output_index")
    private Integer updateRefOutputIndex;

    @Column(name = "created_slot")
    private Long createdSlot;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}
