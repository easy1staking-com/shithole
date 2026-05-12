package com.easy1staking.shithole.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

/**
 * Append-only swap log. Source of {@code swap_count_24h} and historical analytics.
 */
@Entity
@Table(name = "swap_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SwapEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "config_nft_policy")
    private String configNftPolicy;

    @Column(name = "tx_hash")
    private String txHash;

    @Column(name = "slot")
    private Long slot;

    @Column(name = "consumed_utxo_tx_id")
    private String consumedUtxoTxId;

    @Column(name = "consumed_utxo_output_index")
    private Integer consumedUtxoOutputIndex;

    @Column(name = "na_unit")
    private String naUnit;

    @Column(name = "nb_unit")
    private String nbUnit;

    @Column(name = "swapper_pkh")
    private String swapperPkh;

    @Column(name = "protocol_fee_paid")
    private Long protocolFeePaid;

    @Column(name = "lister_fee_paid")
    private Long listerFeePaid;

    @Column(name = "occurred_at")
    private OffsetDateTime occurredAt;
}
