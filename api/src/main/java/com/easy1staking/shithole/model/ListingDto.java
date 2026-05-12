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
 * <p>{@code update_ref} is shaped here as an {@link OutRefDto} for FE convenience even
 * though on-chain the {@code ListingDatum.update_ref} field is a {@code ByteArray}
 * hash ({@code compute_output_tag(prev_outref)}) per SPEC §3.2.
 *
 * <p>The BE resolves this on-chain hash back to the structured previous outref at
 * response-shaping time by looking it up in the {@code listing_events_by_update_ref}
 * partial index (see {@code docs/BACKEND.md} §"Swap-history lineage tracking" → "Data
 * model"). This keeps the FE free of any hash-reversal logic — it just renders
 * "swapped on slot X" with a link to the history endpoint.
 *
 * <p>During the bootstrap phase the {@code update_ref} value is whatever the packaged
 * fixture says — there is no real lineage table populated yet. The
 * resolve-hash-to-outref step lands together with the indexer phase that writes
 * {@code listing_events} rows.
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
