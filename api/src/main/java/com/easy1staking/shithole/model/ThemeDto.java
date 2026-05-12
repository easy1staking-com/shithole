package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Per-collection visual theme overrides. All fields nullable.
 * Shape matches the FE fixture {@code curated.json#theme} / {@code collections/hosky.json#theme}.
 *
 * <p>URL fields require {@code https://} prefix and a restricted character
 * set (defends against XSS-via-URL and homograph attacks).
 * Hex color is the canonical CSS {@code #rrggbb} short or long form.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class ThemeDto {

    @Size(max = 512)
    @Pattern(regexp = "^https://[\\w.\\-/?=&%~+,#:]+$",
            message = "must be an https:// URL using a restricted character set")
    @JsonProperty("background_url")
    private String backgroundUrl;

    @Pattern(regexp = "^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$",
            message = "must be a CSS hex color like #abc or #aabbcc")
    @JsonProperty("accent_color")
    private String accentColor;

    @Size(max = 512)
    @Pattern(regexp = "^https://[\\w.\\-/?=&%~+,#:]+$",
            message = "must be an https:// URL using a restricted character set")
    @JsonProperty("mascot_image_url")
    private String mascotImageUrl;
}
