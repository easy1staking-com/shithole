package com.easy1staking.shithole.service.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * Single exception type for all `POST /api/configs` failure modes, with the
 * outbound HTTP status carried as a field. We picked one exception class
 * (vs. one-per-failure) because the controller-advice mapping would otherwise
 * be six near-identical handlers — same shape, different status. The textual
 * {@code reason} discriminator keeps the wire-level error legible.
 */
@Getter
public class ConfigRegistrationException extends RuntimeException {

    /** Stable machine-readable reason tag; surfaced in the error body. */
    public enum Reason {
        DUPLICATE_SLUG,
        DUPLICATE_CONFIG,
        DUPLICATE_REGISTRATION,
        CONFIG_UTXO_NOT_FOUND,
        AMBIGUOUS_CONFIG,
        INVALID_CONFIG_DATUM,
        DATUM_INVARIANT_VIOLATION,
        BLOCKFROST_UNAVAILABLE,
        SIGNATURE_PAYLOAD_MISMATCH,
        SIGNATURE_KEY_MALFORMED,
        SIGNATURE_INVALID,
        SIGNATURE_NOT_ADMIN
    }

    private final HttpStatus status;
    private final Reason reason;

    public ConfigRegistrationException(HttpStatus status, Reason reason, String message) {
        super(message);
        this.status = status;
        this.reason = reason;
    }

    public ConfigRegistrationException(HttpStatus status, Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.reason = reason;
    }

    public static ConfigRegistrationException duplicateSlug(String slug) {
        return new ConfigRegistrationException(HttpStatus.CONFLICT, Reason.DUPLICATE_SLUG,
                "slug already registered: " + slug);
    }

    public static ConfigRegistrationException duplicateConfig(String policy) {
        return new ConfigRegistrationException(HttpStatus.CONFLICT, Reason.DUPLICATE_CONFIG,
                "config_nft_policy already registered: " + policy);
    }

    /** Surfaces the rare-but-real race when two concurrent submits both pass preflight then trip the unique index. */
    public static ConfigRegistrationException duplicateRegistration() {
        return new ConfigRegistrationException(HttpStatus.CONFLICT, Reason.DUPLICATE_REGISTRATION,
                "concurrent registration won the race; resubmit will return the duplicate-config error");
    }

    public static ConfigRegistrationException notFound(String policy) {
        return new ConfigRegistrationException(HttpStatus.NOT_FOUND, Reason.CONFIG_UTXO_NOT_FOUND,
                "config UTxO not on-chain (yet?) for policy " + policy);
    }

    public static ConfigRegistrationException ambiguous(String policy, int count) {
        return new ConfigRegistrationException(HttpStatus.CONFLICT, Reason.AMBIGUOUS_CONFIG,
                "ambiguous config — " + count + " UTxOs hold the NFT for policy " + policy);
    }

    public static ConfigRegistrationException invalidDatum(String message, Throwable cause) {
        return new ConfigRegistrationException(HttpStatus.UNPROCESSABLE_ENTITY,
                Reason.INVALID_CONFIG_DATUM,
                "config UTxO does not carry a valid ConfigDatum: " + message, cause);
    }

    public static ConfigRegistrationException invariant(String message) {
        return new ConfigRegistrationException(HttpStatus.UNPROCESSABLE_ENTITY,
                Reason.DATUM_INVARIANT_VIOLATION, message);
    }

    public static ConfigRegistrationException blockfrostUnavailable(String message) {
        return new ConfigRegistrationException(HttpStatus.BAD_GATEWAY,
                Reason.BLOCKFROST_UNAVAILABLE, message);
    }

    public static ConfigRegistrationException signaturePayloadMismatch() {
        return new ConfigRegistrationException(HttpStatus.UNAUTHORIZED,
                Reason.SIGNATURE_PAYLOAD_MISMATCH,
                "COSE_Sign1 payload does not match the canonical payload derived from the request fields");
    }

    public static ConfigRegistrationException signatureKeyMalformed(String detail) {
        return new ConfigRegistrationException(HttpStatus.UNAUTHORIZED,
                Reason.SIGNATURE_KEY_MALFORMED,
                "COSE_Key is not a usable Ed25519 OKP key: " + detail);
    }

    public static ConfigRegistrationException signatureInvalid() {
        return new ConfigRegistrationException(HttpStatus.UNAUTHORIZED,
                Reason.SIGNATURE_INVALID, "COSE_Sign1 signature failed Ed25519 verification");
    }

    public static ConfigRegistrationException signatureNotAdmin() {
        return new ConfigRegistrationException(HttpStatus.FORBIDDEN,
                Reason.SIGNATURE_NOT_ADMIN,
                "signer is not the admin recorded in the on-chain config datum");
    }
}
