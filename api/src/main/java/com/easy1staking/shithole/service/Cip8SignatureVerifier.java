package com.easy1staking.shithole.service;

import co.nstant.in.cbor.model.DataItem;
import co.nstant.in.cbor.model.MajorType;
import co.nstant.in.cbor.model.SimpleValue;
import com.bloxbean.cardano.client.cip.cip8.COSEKey;
import com.bloxbean.cardano.client.cip.cip8.COSESign1;
import com.bloxbean.cardano.client.cip.cip8.HeaderMap;
import com.bloxbean.cardano.client.cip.cip8.SigStructure;
import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.crypto.api.impl.EdDSASigningProvider;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.model.SignatureDto;
import com.easy1staking.shithole.service.exception.ConfigRegistrationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Verifies a CIP-8 (COSE_Sign1) admin signature produced by a CIP-30
 * {@code wallet.signData(addr, payloadHex)} call.
 *
 * <p>The verification walks the CCL {@code cip8} primitives:
 * <ol>
 *   <li>Parse the hex-encoded {@link COSESign1} and {@link COSEKey} CBOR objects.</li>
 *   <li>Reject if the COSE_Sign1's unprotected headers carry {@code hashed=true} —
 *       we only accept inlined (un-hashed) payloads, which is the default for
 *       {@code wallet.signData(addr, hex, false)}.</li>
 *   <li>Assert {@code coseSign1.payload()} equals the canonical payload bytes
 *       built from the request fields. Mismatch → 401 {@code signature_payload_mismatch}.</li>
 *   <li>Recover the Ed25519 public key (32 B) from {@code COSEKey.otherHeaders[-2L]}
 *       (the OKP "x" coordinate). Malformed → 401 {@code signature_key_malformed}.</li>
 *   <li>Compute {@code blake2b_224(pubKey)} and compare hex-lower against
 *       {@code expectedAdminPkhHex}. Mismatch → 403 {@code signature_not_admin}.</li>
 *   <li>Re-derive the {@code SigStructure} bytes via {@link COSESign1#signedData()}
 *       and verify with {@link EdDSASigningProvider#verify}. Mismatch → 401
 *       {@code signature_invalid}.</li>
 * </ol>
 *
 * <p>We deliberately do NOT inspect the {@code address} header
 * (CIP-30's protected-header convention): an attacker could put any address
 * there. The only authority that matters is whether the recovered public key
 * hashes to {@code admin_pkh}.
 */
@Component
@Slf4j
public class Cip8SignatureVerifier {

    /** COSE_Key OKP "x" coordinate label (negative int -2). CCL decodes this as a {@code long}. */
    private static final long COSE_KEY_X_LABEL = -2L;
    /** Unprotected header key used by COSE_Sign1Builder to indicate payload was hashed. */
    private static final String HASHED_HEADER_KEY = "hashed";
    /** Ed25519 public-key length. */
    private static final int ED25519_PK_LEN = 32;

    private final EdDSASigningProvider signingProvider = new EdDSASigningProvider();

    /**
     * Verify a CIP-8 signature against the canonical payload and the admin
     * public-key hash recorded in the on-chain config datum.
     *
     * <p>Composes {@link #parseAndCheckPayload} (cheap, no backend) with
     * {@link #verifyAgainstAdmin} (compares pkh + verifies Ed25519). Callers
     * that want to do work between the two phases (e.g. fetch the on-chain
     * admin_pkh from Blockfrost) can call them separately.
     *
     * @param signatureDto the FE-supplied signature block (hex-encoded COSE_Sign1 + COSE_Key)
     * @param canonicalPayload the canonical UTF-8 payload bytes the FE was supposed to sign
     * @param expectedAdminPkhHex 56-char lowercase hex (blake2b-224 of the admin Ed25519 pubkey)
     * @throws ConfigRegistrationException on any verification failure (401, 403)
     */
    public void verify(SignatureDto signatureDto,
                       byte[] canonicalPayload,
                       String expectedAdminPkhHex) {
        ParsedSignature parsed = parseAndCheckPayload(signatureDto, canonicalPayload);
        verifyAgainstAdmin(parsed, expectedAdminPkhHex);
    }

    /**
     * Step 1: parse COSE_Sign1 + COSE_Key, reject hashed=true, payload-echo check.
     * No backend or admin-pkh dependency. Throws 401 on any failure.
     */
    public ParsedSignature parseAndCheckPayload(SignatureDto signatureDto, byte[] canonicalPayload) {
        if (signatureDto == null) {
            throw ConfigRegistrationException.signatureKeyMalformed("signature block missing");
        }
        byte[] sigBytes;
        byte[] keyBytes;
        try {
            sigBytes = HexUtil.decodeHexString(signatureDto.getSignature());
            keyBytes = HexUtil.decodeHexString(signatureDto.getKey());
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.signatureKeyMalformed("hex decode failed: " + e.getMessage());
        }

        COSESign1 coseSign1;
        COSEKey coseKey;
        try {
            coseSign1 = COSESign1.deserialize(sigBytes);
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.signatureKeyMalformed("COSE_Sign1 parse: " + e.getMessage());
        }
        try {
            coseKey = COSEKey.deserialize(keyBytes);
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.signatureKeyMalformed("COSE_Key parse: " + e.getMessage());
        }

        // Reject hashed=true. CIP-30 wallets default to hashed=false; we don't
        // support the hashed variant because we want byte-exact payload echo.
        if (isHashedPayload(coseSign1)) {
            throw ConfigRegistrationException.signaturePayloadMismatch();
        }

        // Payload echo check.
        byte[] payload = coseSign1.payload();
        if (payload == null || !Arrays.equals(payload, canonicalPayload)) {
            if (log.isDebugEnabled()) {
                log.debug("CIP-8 payload mismatch: signed={} expected={}",
                        payload == null ? "<null>" : new String(payload, StandardCharsets.UTF_8),
                        new String(canonicalPayload, StandardCharsets.UTF_8));
            }
            throw ConfigRegistrationException.signaturePayloadMismatch();
        }

        // Recover Ed25519 public key from COSE_Key otherHeaders[-2].
        byte[] publicKey = extractEd25519PublicKey(coseKey);
        return new ParsedSignature(coseSign1, publicKey);
    }

    /**
     * Step 2: compare blake2b-224(pubKey) to {@code expectedAdminPkhHex} and
     * verify the Ed25519 signature.
     */
    public void verifyAgainstAdmin(ParsedSignature parsed, String expectedAdminPkhHex) {
        // Compare blake2b-224(pubKey) to expected admin PKH.
        byte[] derivedPkh = Blake2bUtil.blake2bHash224(parsed.publicKey());
        String derivedPkhHex = HexUtil.encodeHexString(derivedPkh).toLowerCase(Locale.ROOT);
        String expectedLower = expectedAdminPkhHex == null ? "" : expectedAdminPkhHex.toLowerCase(Locale.ROOT);
        if (!derivedPkhHex.equals(expectedLower)) {
            log.warn("CIP-8 signer pkh={} but expected admin pkh={}", derivedPkhHex, expectedLower);
            throw ConfigRegistrationException.signatureNotAdmin();
        }

        // Re-derive SigStructure bytes and verify Ed25519.
        SigStructure sigStructure = parsed.coseSign1().signedData();
        byte[] sigStructureBytes;
        try {
            sigStructureBytes = sigStructure.serializeAsBytes();
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.signatureKeyMalformed("SigStructure serialize: " + e.getMessage());
        }
        boolean ok;
        try {
            ok = signingProvider.verify(parsed.coseSign1().signature(), sigStructureBytes, parsed.publicKey());
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.signatureInvalid();
        }
        if (!ok) {
            throw ConfigRegistrationException.signatureInvalid();
        }
    }

    /** Result of {@link #parseAndCheckPayload}: the parsed COSE_Sign1 and the recovered 32-byte pubkey. */
    public record ParsedSignature(COSESign1 coseSign1, byte[] publicKey) {}

    /**
     * The CCL COSE_Sign1Builder sets a {@code "hashed"} key on the unprotected
     * header map with a CBOR SimpleValue.TRUE / .FALSE. We reject TRUE.
     */
    private boolean isHashedPayload(COSESign1 coseSign1) {
        if (coseSign1.headers() == null || coseSign1.headers().unprotected() == null) {
            return false;
        }
        HeaderMap unprotected = coseSign1.headers().unprotected();
        DataItem hashedDi = unprotected.otherHeaders().get(HASHED_HEADER_KEY);
        if (hashedDi == null) {
            return false;
        }
        // CBOR SimpleValue.TRUE encodes as MajorType.SPECIAL with value true.
        // Compare against the constant directly first; fall back to string check.
        if (hashedDi.equals(SimpleValue.TRUE)) {
            return true;
        }
        return MajorType.SPECIAL.equals(hashedDi.getMajorType())
                && hashedDi instanceof SimpleValue
                && ((SimpleValue) hashedDi).getValue() == SimpleValue.TRUE.getValue();
    }

    /**
     * Pull the Ed25519 OKP "x" coordinate (the 32-byte public key) out of the
     * COSE_Key's otherHeaders map. CCL stores the negative-int CBOR label as a
     * boxed {@code long} (see {@code COSEUtil.decodeNumberOrTextOrBytesTypeFromDataItem}).
     */
    private byte[] extractEd25519PublicKey(COSEKey coseKey) {
        if (coseKey.otherHeaders() == null) {
            throw ConfigRegistrationException.signatureKeyMalformed("no otherHeaders on COSE_Key");
        }
        DataItem xDi = coseKey.otherHeaders().get(COSE_KEY_X_LABEL);
        if (xDi == null) {
            // Some encoders may use BigInteger for negative labels; try a few alternates.
            xDi = coseKey.otherHeaders().get(java.math.BigInteger.valueOf(-2L));
        }
        if (xDi == null) {
            throw ConfigRegistrationException.signatureKeyMalformed("missing 'x' (label -2) on COSE_Key");
        }
        if (!MajorType.BYTE_STRING.equals(xDi.getMajorType())) {
            throw ConfigRegistrationException.signatureKeyMalformed("'x' on COSE_Key is not a byte string");
        }
        byte[] pk = ((co.nstant.in.cbor.model.ByteString) xDi).getBytes();
        if (pk == null || pk.length != ED25519_PK_LEN) {
            throw ConfigRegistrationException.signatureKeyMalformed(
                    "Ed25519 public key must be " + ED25519_PK_LEN + " bytes, found "
                            + (pk == null ? 0 : pk.length));
        }
        return pk;
    }

    /**
     * Build the canonical newline-delimited payload the FE must sign. Mirrored
     * 1:1 in the FE signing code. See {@code docs/BACKEND.md §config-registration}.
     */
    public static byte[] buildCanonicalPayload(
            String configNftPolicy,
            String slug,
            String displayName,
            Integer displayOrder,
            String themeBackgroundUrl,
            String themeAccentColor,
            String themeMascotImageUrl) {
        int order = displayOrder != null ? displayOrder : 0;
        StringBuilder sb = new StringBuilder(256);
        sb.append("shithole/register-config\n");
        sb.append(configNftPolicy == null ? "" : configNftPolicy.toLowerCase(Locale.ROOT)).append('\n');
        sb.append(slug == null ? "" : slug).append('\n');
        sb.append(displayName == null ? "" : displayName).append('\n');
        sb.append(order).append('\n');
        sb.append(themeBackgroundUrl == null ? "" : themeBackgroundUrl).append('\n');
        sb.append(themeAccentColor == null ? "" : themeAccentColor).append('\n');
        sb.append(themeMascotImageUrl == null ? "" : themeMascotImageUrl);
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }
}
