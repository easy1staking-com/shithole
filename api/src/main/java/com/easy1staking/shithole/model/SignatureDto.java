package com.easy1staking.shithole.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * CIP-8 (COSE_Sign1) admin signature block submitted alongside the
 * registration request. Carries the wallet-side output of CIP-30
 * {@code wallet.signData(adminAddress, payloadHex)} — both the
 * {@code COSE_Sign1} signature object and the {@code COSE_Key} object
 * (the latter exposes the Ed25519 public key under negative int header
 * {@code -2}, the OKP "x" coordinate).
 *
 * <p>See {@code ConfigRegistrationService} for the verification flow.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SignatureDto {

    /** Hex-encoded {@code COSE_Key} CBOR object as returned by CIP-30 signData. */
    @NotBlank
    @Pattern(regexp = "^[0-9a-fA-F]+$", message = "must be hex-encoded")
    @Size(max = 4096)
    @JsonProperty("key")
    private String key;

    /** Hex-encoded {@code COSE_Sign1} CBOR object as returned by CIP-30 signData. */
    @NotBlank
    @Pattern(regexp = "^[0-9a-fA-F]+$", message = "must be hex-encoded")
    @Size(max = 8192)
    @JsonProperty("signature")
    private String signature;
}
