package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A single trait entry on an NFT, optionally annotated with collection-wide
 * rarity. {@code count} is the number of NFTs in the collection that share
 * this {@code (category, value)} pair; {@code pct} is the same expressed as
 * a percentage, rounded to four decimals.
 *
 * <p>Both rarity fields are nullable — when the BE has no rarity table for
 * the NFT's collection (most collections, in v1) the response carries
 * {@code category}/{@code value} only and the FE renders without the
 * rarity chip. Resolution lives in
 * {@link com.easy1staking.shithole.service.RarityService}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class TraitWithRarity {

    private String category;

    private String value;

    /** Number of NFTs in the collection sharing this (category, value). Null if rarity unknown. */
    private Long count;

    /** Same as {@code count} expressed as a percentage (0-100), four-decimal precision. Null if rarity unknown. */
    private Double pct;
}
