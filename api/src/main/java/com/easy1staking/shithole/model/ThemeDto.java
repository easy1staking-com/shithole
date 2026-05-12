package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Per-collection visual theme overrides. All fields nullable.
 * Shape matches the FE fixture {@code curated.json#theme} / {@code collections/hosky.json#theme}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class ThemeDto {

    @JsonProperty("background_url")
    private String backgroundUrl;

    @JsonProperty("accent_color")
    private String accentColor;

    @JsonProperty("mascot_image_url")
    private String mascotImageUrl;
}
