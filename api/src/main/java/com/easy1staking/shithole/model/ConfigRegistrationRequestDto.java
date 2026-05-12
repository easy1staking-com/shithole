package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Inbound payload for {@code POST /api/configs}. Submitted by the FE after the
 * admin's config-deployment tx is confirmed on-chain.
 *
 * <p>Admin-authenticated via a CIP-8 ({@link SignatureDto}) signature over a
 * canonical newline-delimited payload of the submitted fields. The BE
 * recovers the Ed25519 public key from the COSE_Key, hashes it
 * (blake2b-224), and requires the resulting key hash to match the
 * {@code admin_pkh} field of the on-chain config datum (see
 * {@code ConfigRegistrationService}).
 *
 * <p>The text-field validators below intentionally reject newlines + ASCII
 * control characters so the canonical payload is unambiguous (one logical
 * field per line, no field-internal newlines).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConfigRegistrationRequestDto {

    /** Hex script hash of the config validator, also the policy id of the config NFT. 28 bytes = 56 hex chars. */
    @NotBlank
    @Pattern(regexp = "^[0-9a-fA-F]{56}$", message = "must be 56 hex characters (28-byte script hash)")
    @JsonProperty("config_nft_policy")
    private String configNftPolicy;

    /**
     * FE-chosen URL slug. Must be unique. No leading/trailing dash, no double
     * dashes (defends against slug-spoofing visual lookalikes).
     */
    @NotBlank
    @Size(min = 2, max = 32)
    @Pattern(
            regexp = "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            message = "must be [a-z0-9-], no leading/trailing/consecutive dashes")
    private String slug;

    /** 1..64 chars, no ASCII control characters / newlines (so canonical payload is unambiguous). */
    @NotBlank
    @Pattern(regexp = "^[^\\p{Cntrl}]{1,64}$",
            message = "must be 1..64 chars, no ASCII control characters")
    @JsonProperty("display_name")
    private String displayName;

    /** Optional visual theme overrides. */
    @Valid
    private ThemeDto theme;

    /** Optional display ordering (lower = earlier). Defaults to 0 server-side. */
    @Min(0)
    @JsonProperty("display_order")
    private Integer displayOrder;

    /** Required CIP-8 admin signature over the canonical payload. */
    @NotNull
    @Valid
    private SignatureDto signature;
}
