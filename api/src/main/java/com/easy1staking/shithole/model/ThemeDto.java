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
 * <p>URL fields accept either an {@code https://} URL or a same-origin
 * absolute path ({@code /...}) — the latter is how curated pits point
 * at assets bundled in the web app's {@code public/} directory (e.g.
 * {@code /pit/hosky-bg.webp}). Both forms use a restricted character
 * set (defends against XSS-via-URL and homograph attacks); same-origin
 * paths are extra-safe because they can't reach off-origin destinations
 * regardless of input. Hex color is the canonical CSS {@code #rrggbb}
 * short or long form.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.ALWAYS)
public class ThemeDto {

    /**
     * Either {@code https://…} or a same-origin path starting with {@code /}.
     * The leading {@code /} form requires the next character to be a
     * letter/digit so {@code //evil.com/...} (protocol-relative) is rejected.
     */
    private static final String URL_OR_PATH_REGEX =
            "^(https://|/[\\w.\\-])[\\w.\\-/?=&%~+,#:]*$";

    @Size(max = 512)
    @Pattern(regexp = URL_OR_PATH_REGEX,
            message = "must be an https:// URL or a same-origin /path, using a restricted character set")
    @JsonProperty("background_url")
    private String backgroundUrl;

    @Pattern(regexp = "^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$",
            message = "must be a CSS hex color like #abc or #aabbcc")
    @JsonProperty("accent_color")
    private String accentColor;

    @Size(max = 512)
    @Pattern(regexp = URL_OR_PATH_REGEX,
            message = "must be an https:// URL or a same-origin /path, using a restricted character set")
    @JsonProperty("mascot_image_url")
    private String mascotImageUrl;
}
