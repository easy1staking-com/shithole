package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * M-staleness diagnostic (SPEC §10.2: BE continuously tracks {@code recommended_m = ceil(N/3)}).
 * Matches FE fixture {@code collections/hosky.json#m_staleness}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MStalenessDto {

    @JsonProperty("current_m")
    private Integer currentM;

    @JsonProperty("recommended_m")
    private Integer recommendedM;

    @JsonProperty("recommended_m_ratio")
    private Double recommendedMRatio;
}
