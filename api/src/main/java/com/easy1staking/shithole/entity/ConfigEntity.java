package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

/**
 * Live config-UTxO state per `config_nft_policy`.
 * Mirrors the on-chain {@code ConfigDatum} (SPEC §3.1) plus tracking metadata.
 */
@Entity
@Table(name = "configs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConfigEntity {

    @Id
    @Column(name = "config_nft_policy")
    private String configNftPolicy;

    @Column(name = "utxo_tx_id")
    private String utxoTxId;

    @Column(name = "utxo_output_index")
    private Integer utxoOutputIndex;

    @Column(name = "m")
    private Integer m;

    @Column(name = "protocol_fee")
    private Long protocolFee;

    @Column(name = "lister_fee")
    private Long listerFee;

    @Column(name = "treasury_addr_bech32")
    private String treasuryAddrBech32;

    @Column(name = "treasury_addr_payment_cred_type")
    private String treasuryAddrPaymentCredType;

    @Column(name = "treasury_addr_payment_cred_hash")
    private String treasuryAddrPaymentCredHash;

    @Column(name = "treasury_addr_stake_cred_type")
    private String treasuryAddrStakeCredType;

    @Column(name = "treasury_addr_stake_cred_hash")
    private String treasuryAddrStakeCredHash;

    @Column(name = "admin_pkh")
    private String adminPkh;

    @Column(name = "updated_at_slot")
    private Long updatedAtSlot;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
