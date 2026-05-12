package com.easy1staking.shithole.service;

import co.nstant.in.cbor.model.ByteString;
import co.nstant.in.cbor.model.NegativeInteger;
import co.nstant.in.cbor.model.SimpleValue;
import co.nstant.in.cbor.model.UnsignedInteger;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.exception.ApiException;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.api.UtxoService;
import com.bloxbean.cardano.client.cip.cip8.COSEKey;
import com.bloxbean.cardano.client.cip.cip8.COSESign1;
import com.bloxbean.cardano.client.cip.cip8.HeaderMap;
import com.bloxbean.cardano.client.cip.cip8.Headers;
import com.bloxbean.cardano.client.cip.cip8.ProtectedHeaderMap;
import com.bloxbean.cardano.client.cip.cip8.SigStructure;
import com.bloxbean.cardano.client.cip.cip8.SigContext;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.crypto.KeyGenUtil;
import com.bloxbean.cardano.client.crypto.Keys;
import com.bloxbean.cardano.client.crypto.api.impl.EdDSASigningProvider;
import com.bloxbean.cardano.client.plutus.aiken.blueprint.std.VerificationKeyHash;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.impl.AddressData;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.impl.VerificationKeyData;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ConfigDatum;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ConfigDatumConverter;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.impl.ConfigDatumData;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.model.ConfigRegistrationRequestDto;
import com.easy1staking.shithole.model.ConfigRegistrationResponseDto;
import com.easy1staking.shithole.model.SignatureDto;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.service.exception.ConfigRegistrationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ConfigRegistrationService}. BackendService / UtxoService
 * and both repositories are mocked; nothing in this test class touches Spring,
 * the DB, or Blockfrost.
 *
 * <p>To build a realistic on-chain datum we use the generated {@code *Data}
 * impl classes and the {@code ConfigDatumConverter}, then feed the resulting
 * hex back through the converter under test — that's the same path the
 * service takes via {@code utxo.getInlineDatum()}.
 *
 * <p>The CIP-8 admin signature is generated in-test by signing the canonical
 * payload with an Ed25519 keypair whose public-key hash is wired into the
 * datum as {@code admin_pkh} — the same flow the FE will use with
 * {@code wallet.signData}.
 */
@ExtendWith(MockitoExtension.class)
class ConfigRegistrationServiceTest {

    private static final String POLICY = "abababababababababababababababababababababababababababab"; // 56 hex chars
    private static final String COLLECTION_ASSET_NAME = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"; // 28 bytes
    private static final byte[] TREASURY_KH = bytes28((byte) 0xb2);

    /** Generated per-test in {@link #setUp()}. publicKey is 32 B; pkh is blake2b-224(publicKey). */
    private TestKeyPair adminKeyPair;
    private byte[] adminPkh;

    @Mock private ConfigRepository configRepository;
    @Mock private CuratedCollectionRepository curatedCollectionRepository;
    @Mock private BackendService backendService;
    @Mock private UtxoService utxoService;

    private ConfigRegistrationService service;

    @BeforeEach
    void setUp() {
        adminKeyPair = TestKeyPair.generate();
        adminPkh = Blake2bUtil.blake2bHash224(adminKeyPair.publicKey);
        lenient().when(backendService.getUtxoService()).thenReturn(utxoService);
        service = new ConfigRegistrationService(
                configRepository, curatedCollectionRepository, backendService,
                Networks.mainnet(), new Cip8SignatureVerifier());
    }

    @Test
    void happyPath_writesBothRowsAndReturnsResponse() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.valueOf(10), BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        ConfigRegistrationResponseDto resp = service.register(validRequest("hosky"));

        assertThat(resp.getSlug()).isEqualTo("hosky");
        assertThat(resp.getConfigNftPolicy()).isEqualTo(POLICY);
        assertThat(resp.getCollectionPolicyId()).isEqualTo(COLLECTION_ASSET_NAME);
        assertThat(resp.getM()).isEqualTo(10);
        assertThat(resp.getProtocolFee()).isEqualTo(0L);
        assertThat(resp.getListerFee()).isEqualTo(2_000_000L);
        assertThat(resp.getTreasuryAddrBech32()).startsWith("addr1");
        assertThat(resp.getUtxoTxId()).isNotBlank();

        ArgumentCaptor<ConfigEntity> configCap = ArgumentCaptor.forClass(ConfigEntity.class);
        verify(configRepository, times(1)).saveAndFlush(configCap.capture());
        assertThat(configCap.getValue().getConfigNftPolicy()).isEqualTo(POLICY);
        assertThat(configCap.getValue().getM()).isEqualTo(10);
        assertThat(configCap.getValue().getTreasuryAddrPaymentCredType()).isEqualTo("verification_key");

        ArgumentCaptor<CuratedCollectionEntity> curatedCap = ArgumentCaptor.forClass(CuratedCollectionEntity.class);
        verify(curatedCollectionRepository, times(1)).saveAndFlush(curatedCap.capture());
        assertThat(curatedCap.getValue().getSlug()).isEqualTo("hosky");
        assertThat(curatedCap.getValue().getConfigNftPolicy()).isEqualTo(POLICY);
        assertThat(curatedCap.getValue().getCollectionPolicyId()).isEqualTo(COLLECTION_ASSET_NAME);
        assertThat(curatedCap.getValue().getListingScriptAddress()).isNull();
    }

    @Test
    void zeroMatchingUtxos_throws404() throws ApiException {
        primeDuplicateChecks();
        when(utxoService.getUtxos(anyString(), anyInt(), anyInt(), any(OrderEnum.class)))
                .thenReturn(success(List.of()));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.CONFIG_UTXO_NOT_FOUND);
                });
        verify(configRepository, never()).saveAndFlush(any());
        verify(curatedCollectionRepository, never()).saveAndFlush(any());
    }

    @Test
    void blockfrost404_addressUnused_throws404NotFound() throws ApiException {
        primeDuplicateChecks();
        when(utxoService.getUtxos(anyString(), anyInt(), anyInt(), any(OrderEnum.class)))
                .thenReturn(notFoundResult());

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.CONFIG_UTXO_NOT_FOUND);
                });
    }

    @Test
    void blockfrost500_throws502BlockfrostUnavailable() throws ApiException {
        primeDuplicateChecks();
        when(utxoService.getUtxos(anyString(), anyInt(), anyInt(), any(OrderEnum.class)))
                .thenReturn(errorResult(500, "Upstream Blockfrost error body"));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.BLOCKFROST_UNAVAILABLE);
                    // Ensure we don't leak the raw upstream body.
                    assertThat(e.getMessage()).doesNotContain("Upstream Blockfrost error body");
                });
    }

    @Test
    void blockfrostThrowsApiException_throws502() throws ApiException {
        primeDuplicateChecks();
        when(utxoService.getUtxos(anyString(), anyInt(), anyInt(), any(OrderEnum.class)))
                .thenThrow(new ApiException("Network unreachable"));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.BLOCKFROST_UNAVAILABLE);
                });
    }

    @Test
    void multipleMatchingUtxos_throws409Ambiguous() throws ApiException {
        primeDuplicateChecks();
        ConfigDatum datum = makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000));
        primeUtxoLookup(matchingUtxo(datum), matchingUtxo(datum));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.AMBIGUOUS_CONFIG);
                });
        verify(configRepository, never()).saveAndFlush(any());
    }

    @Test
    void utxoWithTwoAssetsUnderPolicy_throws422Invariant() throws ApiException {
        primeDuplicateChecks();
        ConfigDatum datum = makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000));
        Utxo u = matchingUtxo(datum);
        // Add a second asset under the same policy → invariant violation.
        u.getAmount().add(Amount.builder().unit(POLICY + "ee".repeat(28)).quantity(BigInteger.ONE).build());
        primeUtxoLookup(u);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                    assertThat(e.getMessage()).contains("assets under policy");
                });
    }

    @Test
    void utxoWithQuantityNotOne_rejected_as_malformed() throws ApiException {
        primeDuplicateChecks();
        ConfigDatum datum = makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000));
        Utxo u = matchingUtxo(datum);
        // Same-policy asset with quantity != 1 means the UTxO is malformed.
        // Reject 422 rather than silently 404 — a 404 would let a malformed
        // deployment masquerade as "not found yet".
        u.getAmount().stream()
                .filter(a -> a.getUnit().equals(POLICY + COLLECTION_ASSET_NAME))
                .findFirst()
                .ifPresent(a -> a.setQuantity(BigInteger.valueOf(2)));
        primeUtxoLookup(u);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                });
    }

    @Test
    void utxoWithCoTenantMalformedAssetUnderSamePolicy_rejected() throws ApiException {
        primeDuplicateChecks();
        ConfigDatum datum = makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000));
        Utxo u = matchingUtxo(datum);
        // Add a same-policy asset with a non-28-byte (= 56 hex char) asset name.
        // The legitimate 28-byte NFT is still present qty=1, but the co-tenant
        // poisons the UTxO.
        u.getAmount().add(Amount.builder()
                .unit(POLICY + "deadbeef") // policy + 4-byte asset name
                .quantity(BigInteger.ONE)
                .build());
        primeUtxoLookup(u);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                });
    }

    @Test
    void datumDecodeFailure_throws422() throws ApiException {
        primeDuplicateChecks();
        Utxo u = baseUtxo();
        u.setInlineDatum("deadbeef"); // not a valid CBOR ConstrPlutusData encoding the ConfigDatum shape
        primeUtxoLookup(u);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.INVALID_CONFIG_DATUM);
                });
    }

    @Test
    void mIsZero_throws422Invariant() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.ZERO, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                    assertThat(e.getMessage()).contains("M must be >= 1");
                });
    }

    @Test
    void mTooLarge_throws422Invariant() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(
                BigInteger.valueOf(ConfigRegistrationService.MAX_M + 1L),
                BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                    assertThat(e.getMessage()).contains("M too large");
                });
    }

    @Test
    void feeTooLarge_throws422Invariant() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO,
                BigInteger.valueOf(ConfigRegistrationService.MAX_FEE_LOVELACE + 1L))));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                    assertThat(e.getMessage()).contains("lister_fee too large");
                });
    }

    @Test
    void listerFeeBelowFloor_throws422Invariant() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(999_999L))));

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DATUM_INVARIANT_VIOLATION);
                    assertThat(e.getMessage()).contains("lister_fee");
                });
    }

    @Test
    void duplicateSlug_throws409() {
        when(curatedCollectionRepository.existsById("hosky")).thenReturn(true);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DUPLICATE_SLUG);
                });
    }

    @Test
    void duplicateConfigPolicy_throws409() {
        when(curatedCollectionRepository.existsById("hosky")).thenReturn(false);
        when(configRepository.existsById(POLICY)).thenReturn(true);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DUPLICATE_CONFIG);
                });
    }

    @Test
    void duplicateConfigPolicy_inCuratedCollections_throws409() {
        when(curatedCollectionRepository.existsById("hosky")).thenReturn(false);
        when(configRepository.existsById(POLICY)).thenReturn(false);
        when(curatedCollectionRepository.existsByConfigNftPolicy(POLICY)).thenReturn(true);

        assertThatThrownBy(() -> service.register(validRequest("hosky")))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.DUPLICATE_CONFIG);
                });
    }

    @Test
    void malformedPolicyHex_throws400AtServiceMirror() {
        ConfigRegistrationRequestDto req = ConfigRegistrationRequestDto.builder()
                .configNftPolicy("not-hex-and-too-short")
                .slug("hosky")
                .displayName("Hosky")
                .signature(SignatureDto.builder().key("00").signature("00").build())
                .build();

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("config_nft_policy");
    }

    @Test
    void malformedSlug_throws400AtServiceMirror() {
        ConfigRegistrationRequestDto req = ConfigRegistrationRequestDto.builder()
                .configNftPolicy(POLICY)
                .slug("Bad Slug!!")
                .displayName("Hosky")
                .signature(SignatureDto.builder().key("00").signature("00").build())
                .build();

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("slug");
    }

    @Test
    void slugWithConsecutiveDashes_throws400AtServiceMirror() {
        ConfigRegistrationRequestDto req = ConfigRegistrationRequestDto.builder()
                .configNftPolicy(POLICY)
                .slug("foo--bar")
                .displayName("Hosky")
                .signature(SignatureDto.builder().key("00").signature("00").build())
                .build();

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("slug");
    }

    // ---- CIP-8 signature tests --------------------------------------------

    @Test
    void cip8_signatureFromWrongKey_throws403NotAdmin() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        // Sign canonical payload with a *different* keypair → blake2b-224 mismatch.
        TestKeyPair attacker = TestKeyPair.generate();
        ConfigRegistrationRequestDto req = validRequest("hosky");
        SignatureDto sig = signWith(attacker, canonicalFor(req));
        req.setSignature(sig);

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.SIGNATURE_NOT_ADMIN);
                });
        verify(configRepository, never()).saveAndFlush(any());
    }

    @Test
    void cip8_payloadMutatedAfterSigning_throws401PayloadMismatch() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        // Sign payload for slug "hosky", then submit with slug "rugged" → payload echo fails.
        ConfigRegistrationRequestDto signedReq = validRequest("hosky");
        SignatureDto sig = signWith(adminKeyPair, canonicalFor(signedReq));
        ConfigRegistrationRequestDto submitted = validRequest("rugged");
        submitted.setSignature(sig);

        assertThatThrownBy(() -> service.register(submitted))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.SIGNATURE_PAYLOAD_MISMATCH);
                });
    }

    @Test
    void cip8_tamperedSignatureBytes_throws401Invalid() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        ConfigRegistrationRequestDto req = validRequest("hosky");
        SignatureDto goodSig = signWith(adminKeyPair, canonicalFor(req));
        // Flip the last byte of the COSE_Sign1 hex (last hex pair is the last byte
        // of the Ed25519 signature inside the CBOR ByteString — flipping invalidates Ed25519).
        String sigHex = goodSig.getSignature();
        char last = sigHex.charAt(sigHex.length() - 1);
        char flipped = last == 'f' ? '0' : (char) (last + 1);
        String tampered = sigHex.substring(0, sigHex.length() - 1) + flipped;
        goodSig.setSignature(tampered);
        req.setSignature(goodSig);

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    // Could be either SIGNATURE_INVALID (parsed but verify failed)
                    // or SIGNATURE_KEY_MALFORMED if the flip happened to break CBOR.
                    assertThat(e.getReason()).isIn(
                            ConfigRegistrationException.Reason.SIGNATURE_INVALID,
                            ConfigRegistrationException.Reason.SIGNATURE_KEY_MALFORMED);
                });
    }

    @Test
    void cip8_hashedPayloadTrue_throws401PayloadMismatch() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        ConfigRegistrationRequestDto req = validRequest("hosky");
        byte[] payload = canonicalFor(req);
        // Build a COSE_Sign1 with unprotected.hashed=true. We still sign over the
        // un-hashed payload — the verifier should reject on the "hashed=true" flag
        // before bothering with anything else.
        SignatureDto sig = signWith(adminKeyPair, payload, /*setHashedFlag=*/true);
        req.setSignature(sig);

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.SIGNATURE_PAYLOAD_MISMATCH);
                });
    }

    @Test
    void cip8_garbageSignatureHex_throws401KeyMalformed() throws ApiException {
        primeDuplicateChecks();
        primeUtxoLookup(matchingUtxo(makeDatum(BigInteger.TEN, BigInteger.ZERO, BigInteger.valueOf(2_000_000))));

        ConfigRegistrationRequestDto req = validRequest("hosky");
        req.setSignature(SignatureDto.builder().key("00").signature("00").build());

        assertThatThrownBy(() -> service.register(req))
                .isInstanceOfSatisfying(ConfigRegistrationException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertThat(e.getReason()).isEqualTo(ConfigRegistrationException.Reason.SIGNATURE_KEY_MALFORMED);
                });
    }

    // ---- fixture helpers --------------------------------------------------

    private ConfigRegistrationRequestDto validRequest(String slug) {
        ConfigRegistrationRequestDto req = ConfigRegistrationRequestDto.builder()
                .configNftPolicy(POLICY)
                .slug(slug)
                .displayName("Hosky")
                .displayOrder(0)
                .build();
        req.setSignature(signWith(adminKeyPair, canonicalFor(req)));
        return req;
    }

    private byte[] canonicalFor(ConfigRegistrationRequestDto req) {
        return Cip8SignatureVerifier.buildCanonicalPayload(
                req.getConfigNftPolicy().toLowerCase(java.util.Locale.ROOT),
                req.getSlug(),
                req.getDisplayName(),
                req.getDisplayOrder(),
                req.getTheme() == null ? null : req.getTheme().getBackgroundUrl(),
                req.getTheme() == null ? null : req.getTheme().getAccentColor(),
                req.getTheme() == null ? null : req.getTheme().getMascotImageUrl());
    }

    private SignatureDto signWith(TestKeyPair kp, byte[] payload) {
        return signWith(kp, payload, false);
    }

    /**
     * Builds a CIP-30-shaped COSE_Sign1 + COSE_Key for {@code payload}.
     * If {@code hashedFlag} is true, sets the unprotected {@code "hashed": true}
     * header (we still sign the un-hashed payload — the verifier should reject
     * on the flag alone).
     */
    private SignatureDto signWith(TestKeyPair kp, byte[] payload, boolean hashedFlag) {
        // Protected headers: algorithm=EdDSA (-8). (CIP-30 also includes "address";
        // we omit it because our verifier doesn't inspect it.)
        HeaderMap protectedHm = new HeaderMap().algorithmId(-8L);
        ProtectedHeaderMap protectedHeader = new ProtectedHeaderMap(protectedHm);

        HeaderMap unprotected = new HeaderMap();
        unprotected.otherHeaders().put("hashed", hashedFlag ? SimpleValue.TRUE : SimpleValue.FALSE);

        Headers headers = new Headers()._protected(protectedHeader).unprotected(unprotected);

        // Compute SigStructure bytes and sign.
        SigStructure sigStruct = new SigStructure()
                .sigContext(SigContext.Signature1)
                .bodyProtected(protectedHeader)
                .externalAad(new byte[0])
                .payload(payload);
        byte[] toSign = sigStruct.serializeAsBytes();
        byte[] signatureBytes = new EdDSASigningProvider().sign(toSign, kp.privateSeed);

        COSESign1 coseSign1 = new COSESign1()
                .headers(headers)
                .payload(payload)
                .signature(signatureBytes);

        // COSE_Key: kty=1 (OKP), alg=-8 (EdDSA), crv=-1 → 6 (Ed25519), x=-2 → pubKey.
        COSEKey coseKey = new COSEKey()
                .keyType(1L)
                .algorithmId(-8L);
        // crv (-1) → Ed25519 (6)
        coseKey.otherHeaders().put(-1L, new UnsignedInteger(6));
        // x (-2) → 32B public key
        coseKey.otherHeaders().put(-2L, new ByteString(kp.publicKey));

        return SignatureDto.builder()
                .signature(HexUtil.encodeHexString(coseSign1.serializeAsBytes()))
                .key(HexUtil.encodeHexString(coseKey.serializeAsBytes()))
                .build();
    }

    private void primeDuplicateChecks() {
        lenient().when(curatedCollectionRepository.existsById(anyString())).thenReturn(false);
        lenient().when(configRepository.existsById(anyString())).thenReturn(false);
        lenient().when(curatedCollectionRepository.existsByConfigNftPolicy(anyString())).thenReturn(false);
    }

    private void primeUtxoLookup(Utxo... utxos) throws ApiException {
        lenient().when(utxoService.getUtxos(anyString(), anyInt(), eq(1), any(OrderEnum.class)))
                .thenReturn(success(List.of(utxos)));
    }

    @SuppressWarnings("unchecked")
    private static Result<List<Utxo>> success(List<Utxo> value) {
        Result<List<Utxo>> r = (Result<List<Utxo>>) Result.success("OK").code(200);
        r.withValue(value);
        return r;
    }

    @SuppressWarnings("unchecked")
    private static Result<List<Utxo>> notFoundResult() {
        return (Result<List<Utxo>>) Result.error("Not found").code(404);
    }

    @SuppressWarnings("unchecked")
    private static Result<List<Utxo>> errorResult(int code, String body) {
        return (Result<List<Utxo>>) Result.error(body).code(code);
    }

    private ConfigDatum makeDatum(BigInteger m, BigInteger protocolFee, BigInteger listerFee) {
        // payment credential: verification key with TREASURY_KH
        VerificationKeyData paymentVk = new VerificationKeyData();
        paymentVk.setVerificationKeyHash(new VerificationKeyHash(TREASURY_KH));

        AddressData addr = new AddressData();
        addr.setPaymentCredential(paymentVk);
        addr.setStakeCredential(Optional.empty());

        ConfigDatumData d = new ConfigDatumData();
        d.setM(m);
        d.setProtocolFee(protocolFee);
        d.setListerFee(listerFee);
        d.setTreasuryAddr(addr);
        d.setAdminPkh(new VerificationKeyHash(adminPkh));
        return d;
    }

    private Utxo matchingUtxo(ConfigDatum datum) {
        Utxo u = baseUtxo();
        u.setInlineDatum(new ConfigDatumConverter().serializeToHex(datum));
        return u;
    }

    private Utxo baseUtxo() {
        List<Amount> amounts = new ArrayList<>();
        amounts.add(Amount.builder().unit("lovelace").quantity(BigInteger.valueOf(2_000_000)).build());
        amounts.add(Amount.builder().unit(POLICY + COLLECTION_ASSET_NAME).quantity(BigInteger.ONE).build());

        Utxo u = new Utxo();
        u.setTxHash("0000000000000000000000000000000000000000000000000000000000000001");
        u.setOutputIndex(0);
        u.setAddress("addr_test1...");
        u.setAmount(amounts);
        return u;
    }

    private static byte[] bytes28(byte fill) {
        byte[] b = new byte[28];
        java.util.Arrays.fill(b, fill);
        return b;
    }

    /**
     * Generates a fresh Ed25519 keypair via CCL's {@link KeyGenUtil} (which
     * internally uses BouncyCastle's Ed25519 generator).
     */
    private static final class TestKeyPair {
        final byte[] privateSeed;
        final byte[] publicKey;

        private TestKeyPair(byte[] privateSeed, byte[] publicKey) {
            this.privateSeed = privateSeed;
            this.publicKey = publicKey;
        }

        static TestKeyPair generate() {
            try {
                Keys keys = KeyGenUtil.generateKey();
                return new TestKeyPair(keys.getSkey().getBytes(), keys.getVkey().getBytes());
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }
}
