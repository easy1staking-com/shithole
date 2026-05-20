package com.easy1staking.shithole.entity;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A single {category, value} pair in a {@link PoolCurationEntity}'s
 * {@code accepted_traits} JSONB array. An NFT qualifies for inclusion in
 * a pool if its {@link NftTraitsEntity#getTraits()} contains AT LEAST ONE
 * matching (category, value) pair.
 *
 * <p>Field names match the on-disk JSONB shape:
 * {@code {"category": "Background", "value": "Cyan"}}.
 *
 * <p>A record (not a Lombok {@code @Data} class) so it composes cleanly with
 * Jackson's automatic deserialization of JSONB array contents into Java types.
 */
public record TraitFilter(
        @JsonProperty("category") String category,
        @JsonProperty("value") String value) {

    @JsonCreator
    public TraitFilter {
    }
}
