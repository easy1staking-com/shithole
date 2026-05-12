package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Well-formed listing UTxO as surfaced to the FE.
 * Shape matches FE fixture {@code collections/hosky-listings.json#data[*]}.
 *
 * <p>{@code update_ref} is shaped here as an {@link OutRefDto} for FE convenience, even though
 * on-chain the {@code ListingDatum.update_ref} field is a {@code ByteArray} hash
 * (output tag) per SPEC §3.2. The BE is responsible for resolving the hash back to the
 * prior outRef during indexing if the FE needs the structured form; alternative is to
 * surface the raw tag bytes. See backend-FE coordination note in the report.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class ListingDto {

    @JsonProperty("utxo_ref")
    private OutRefDto utxoRef;

    @JsonProperty("config_nft_policy")
    private String configNftPolicy;

    @JsonProperty("lister_pkh")
    private String listerPkh;

    @JsonProperty("current_nft_unit")
    private String currentNftUnit;

    private Long lovelace;

    @JsonProperty("accrued_lovelace")
    private Long accruedLovelace;

    @JsonProperty("update_ref")
    private OutRefDto updateRef;

    @JsonProperty("created_at")
    private String createdAt;
}
