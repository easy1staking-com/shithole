package com.easy1staking.shithole.service;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.exception.ApiException;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.api.UtxoService;
import com.bloxbean.cardano.client.common.model.Network;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.PaymentCredential;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.StakeCredential;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.Script;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.VerificationKey;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.stakecredential.Inline;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ConfigDatum;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ConfigDatumConverter;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.indexer.ConfigRegisteredEvent;
import com.easy1staking.shithole.model.ConfigRegistrationRequestDto;
import com.easy1staking.shithole.model.ConfigRegistrationResponseDto;
import com.easy1staking.shithole.model.ThemeDto;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.service.exception.ConfigRegistrationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Trustless config registration. The flow:
 * <ol>
 *   <li>validate FE input shape (DTO bean-validation + service-level mirrors)</li>
 *   <li>resolve the config validator's enterprise address from the
 *       script hash (== {@code config_nft_policy} per SPEC §3.1)</li>
 *   <li>page-iterate the address's UTxOs on Blockfrost; filter for the one
 *       holding the config NFT (unit prefix = policy id, asset name 28 B,
 *       quantity == 1, no co-tenant assets under the same policy)</li>
 *   <li>decode the inline datum as {@link ConfigDatum}, enforce invariants</li>
 *   <li>verify the FE-supplied CIP-8 admin signature against the canonical
 *       payload and the on-chain {@code admin_pkh}</li>
 *   <li>persist both rows in a short, separate transaction</li>
 * </ol>
 *
 * <p>The {@code validate → persist} split keeps the @Transactional scope
 * minimal: all Blockfrost / CBOR / crypto work happens outside the DB
 * transaction so a slow backend can't pin a DB connection.
 */
@Service
@Slf4j
public class ConfigRegistrationService {

    /** SPEC §6 hardcoded floor (>= 1 ADA). Mirrored from the on-chain validator. */
    public static final long MIN_LISTER_FEE_LOVELACE = 1_000_000L;
    /** Defensive application cap on the on-chain bucket count. A million buckets is already absurd. */
    public static final int MAX_M = 1_000_000;
    /** Defensive application cap on lister/protocol fee (1000 ADA). */
    public static final long MAX_FEE_LOVELACE = 1_000_000_000L;

    private static final int UTXO_PAGE_SIZE = 100;
    /** Defensive cap on page iteration. >10k UTxOs at one config address is pathological. */
    private static final int MAX_UTXO_PAGES = 100;
    /** Hex length of a 28-byte Cardano policy id / script hash. */
    private static final int POLICY_HEX_LEN = 56;
    /** Hex length of a {@code policy + asset_name} where asset_name is exactly 28 B (collection policy id). */
    private static final int UNIT_HEX_LEN = POLICY_HEX_LEN + 56;

    private final ConfigRepository configRepository;
    private final CuratedCollectionRepository curatedCollectionRepository;
    private final BackendService backendService;
    private final Network appNetwork;
    private final Cip8SignatureVerifier signatureVerifier;
    private final ListingScriptAddressDeriver listingScriptAddressDeriver;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * Lowercase-hex pkhs that are auto-promoted into {@code curated_collections}
     * on registration. Anything outside this list lands in {@code configs} only
     * — the indexer still watches the listing-script address, but the public
     * FE doesn't surface the collection. Empty list = no submissions are
     * auto-curated (closed v1; useful for staging where you only want the
     * indexer to track).
     */
    private final Set<String> operatorPkhs;

    public ConfigRegistrationService(
            ConfigRepository configRepository,
            CuratedCollectionRepository curatedCollectionRepository,
            BackendService backendService,
            Network appNetwork,
            Cip8SignatureVerifier signatureVerifier,
            ListingScriptAddressDeriver listingScriptAddressDeriver,
            ApplicationEventPublisher eventPublisher,
            @Value("${shithole.curation.operator-pkhs:}") List<String> operatorPkhs) {
        this.configRepository = configRepository;
        this.curatedCollectionRepository = curatedCollectionRepository;
        this.backendService = backendService;
        this.appNetwork = appNetwork;
        this.signatureVerifier = signatureVerifier;
        this.listingScriptAddressDeriver = listingScriptAddressDeriver;
        this.eventPublisher = eventPublisher;
        // Normalise once at construction so the per-request check is a cheap
        // hash lookup. Tolerates whitespace + mixed case from env vars.
        Set<String> normalised = new LinkedHashSet<>();
        if (operatorPkhs != null) {
            for (String p : operatorPkhs) {
                if (p == null) continue;
                String trimmed = p.trim().toLowerCase(Locale.ROOT);
                if (!trimmed.isEmpty()) {
                    normalised.add(trimmed);
                }
            }
        }
        this.operatorPkhs = Collections.unmodifiableSet(normalised);
        log.info("ConfigRegistrationService: operator-pkhs configured count={}", this.operatorPkhs.size());
    }

    /**
     * Validate the on-chain config UTxO, persist the {@code configs} +
     * {@code curated_collections} rows, return the materialised response.
     *
     * <p>The public entrypoint composes the validate-and-prepare phase
     * (non-transactional, may run for several seconds against Blockfrost) with
     * the persist phase (REQUIRES_NEW transaction; small and fast).
     */
    public ConfigRegistrationResponseDto register(ConfigRegistrationRequestDto request) {
        RegistrationDecision decision = validateAndPrepare(request);
        return persist(decision);
    }

    // ---- phase 1: validate + Blockfrost lookup + CIP-8 ---------------------

    /**
     * Pure (read-only, no JPA writes) computation: validates the request shape,
     * looks up the config UTxO via Blockfrost, decodes the datum, enforces all
     * invariants, runs the CIP-8 verification. Returns the entities to persist.
     */
    RegistrationDecision validateAndPrepare(ConfigRegistrationRequestDto request) {
        // 1. Service-level shape mirrors (defence in depth vs bean validation).
        validateShape(request);

        String policyLower = request.getConfigNftPolicy().toLowerCase(Locale.ROOT);

        // 2. Cheap duplicate pre-check. The unique indexes still guard the
        //    race, but failing fast here saves a Blockfrost round-trip.
        if (curatedCollectionRepository.existsById(request.getSlug())) {
            throw ConfigRegistrationException.duplicateSlug(request.getSlug());
        }
        if (configRepository.existsById(policyLower)
                || curatedCollectionRepository.existsByConfigNftPolicy(policyLower)) {
            throw ConfigRegistrationException.duplicateConfig(policyLower);
        }

        // 2b. Parse signature + check payload echo. Local-only, no backend.
        //     This catches malformed signatures (401) before the Blockfrost call,
        //     so a missing/wrong project-id doesn't mask the real failure mode.
        ThemeDto theme = request.getTheme();
        byte[] canonicalPayload = Cip8SignatureVerifier.buildCanonicalPayload(
                policyLower,
                request.getSlug(),
                request.getDisplayName(),
                request.getDisplayOrder(),
                theme != null ? theme.getBackgroundUrl() : null,
                theme != null ? theme.getAccentColor() : null,
                theme != null ? theme.getMascotImageUrl() : null);
        Cip8SignatureVerifier.ParsedSignature parsedSig =
                signatureVerifier.parseAndCheckPayload(request.getSignature(), canonicalPayload);

        // 3+4. Resolve the config validator address and fetch its UTxOs.
        String configAddress = deriveConfigAddress(policyLower);
        log.info("registering config policy={} derived address={}", policyLower, configAddress);

        List<Utxo> matchingUtxos = fetchUtxosHoldingPolicy(configAddress, policyLower);

        if (matchingUtxos.isEmpty()) {
            throw ConfigRegistrationException.notFound(policyLower);
        }
        if (matchingUtxos.size() > 1) {
            throw ConfigRegistrationException.ambiguous(policyLower, matchingUtxos.size());
        }

        Utxo configUtxo = matchingUtxos.get(0);

        // 5. Decode inline datum.
        String inlineDatumHex = configUtxo.getInlineDatum();
        if (inlineDatumHex == null || inlineDatumHex.isBlank()) {
            throw ConfigRegistrationException.invalidDatum("no inline datum on UTxO", null);
        }
        ConfigDatum datum;
        try {
            datum = new ConfigDatumConverter().deserialize(inlineDatumHex);
        } catch (RuntimeException e) {
            throw ConfigRegistrationException.invalidDatum(e.getMessage(), e);
        }
        if (datum == null
                || datum.getM() == null
                || datum.getProtocolFee() == null
                || datum.getListerFee() == null
                || datum.getAdminPkh() == null
                || datum.getTreasuryAddr() == null) {
            throw ConfigRegistrationException.invalidDatum("datum has null required fields", null);
        }

        // 6. Enforce datum invariants (SPEC §6 / §3.1) plus app-level upper bounds.
        BigInteger m = datum.getM();
        BigInteger protocolFee = datum.getProtocolFee();
        BigInteger listerFee = datum.getListerFee();
        if (m.compareTo(BigInteger.ONE) < 0) {
            throw ConfigRegistrationException.invariant("M must be >= 1, found " + m);
        }
        if (m.compareTo(BigInteger.valueOf(MAX_M)) > 0) {
            throw ConfigRegistrationException.invariant("M too large (max " + MAX_M + "), found " + m);
        }
        if (protocolFee.signum() < 0) {
            throw ConfigRegistrationException.invariant("protocol_fee must be >= 0, found " + protocolFee);
        }
        if (protocolFee.compareTo(BigInteger.valueOf(MAX_FEE_LOVELACE)) > 0) {
            throw ConfigRegistrationException.invariant(
                    "protocol_fee too large (max " + MAX_FEE_LOVELACE + "), found " + protocolFee);
        }
        if (listerFee.compareTo(BigInteger.valueOf(MIN_LISTER_FEE_LOVELACE)) < 0) {
            throw ConfigRegistrationException.invariant(
                    "lister_fee must be >= " + MIN_LISTER_FEE_LOVELACE + " lovelace (MIN_LISTER_FEE), found "
                            + listerFee);
        }
        if (listerFee.compareTo(BigInteger.valueOf(MAX_FEE_LOVELACE)) > 0) {
            throw ConfigRegistrationException.invariant(
                    "lister_fee too large (max " + MAX_FEE_LOVELACE + "), found " + listerFee);
        }

        // 7. Extract collection_policy_id from the asset name we matched on.
        String collectionPolicyId = extractAssetName(configUtxo, policyLower);

        // 8. Bech32-encode the treasury address.
        TreasuryAddressFields treasuryFields = decodeTreasuryAddress(datum);

        String adminPkhHex = hex(datum.getAdminPkh().bytes());

        // 9. Verify the parsed CIP-8 signature against the on-chain admin_pkh.
        //    (After datum decode, so we can pull the expected pkh out of the
        //    datum — preserves the "trustless" property: payload was checked
        //    earlier in 2b, but the signer-is-admin check requires the datum.)
        signatureVerifier.verifyAgainstAdmin(parsedSig, adminPkhHex);

        // 10. Build the entities (not yet persisted).
        OffsetDateTime now = OffsetDateTime.now();
        ConfigEntity configEntity = ConfigEntity.builder()
                .configNftPolicy(policyLower)
                .utxoTxId(configUtxo.getTxHash())
                .utxoOutputIndex(configUtxo.getOutputIndex())
                .m(m.intValueExact())
                .protocolFee(protocolFee.longValueExact())
                .listerFee(listerFee.longValueExact())
                .treasuryAddrBech32(treasuryFields.bech32())
                .treasuryAddrPaymentCredType(treasuryFields.paymentCredType())
                .treasuryAddrPaymentCredHash(treasuryFields.paymentCredHash())
                .treasuryAddrStakeCredType(treasuryFields.stakeCredType())
                .treasuryAddrStakeCredHash(treasuryFields.stakeCredHash())
                .adminPkh(adminPkhHex)
                .updatedAt(now)
                .build();

        // Derive the listing-script address for this config (applies the
        // config_nft_policy as a UPLC parameter to the unapplied listing
        // validator; result is what the indexer subscribes to per collection).
        String listingScriptAddress = listingScriptAddressDeriver.deriveAddress(policyLower);

        Integer displayOrder = request.getDisplayOrder() != null ? request.getDisplayOrder() : 0;
        CuratedCollectionEntity curatedEntity = CuratedCollectionEntity.builder()
                .slug(request.getSlug())
                .configNftPolicy(policyLower)
                .collectionPolicyId(collectionPolicyId)
                .displayName(request.getDisplayName())
                .backgroundUrl(theme != null ? theme.getBackgroundUrl() : null)
                .accentColor(theme != null ? theme.getAccentColor() : null)
                .mascotImageUrl(theme != null ? theme.getMascotImageUrl() : null)
                .displayOrder(displayOrder)
                .promotedAt(now)
                .listingScriptAddress(listingScriptAddress)
                .build();

        return new RegistrationDecision(configEntity, curatedEntity, theme);
    }

    // ---- phase 2: persist --------------------------------------------------

    /**
     * Short, focused transaction: re-checks duplicate against the live DB
     * inside the tx (cheap row-existence checks), saves both rows, flushes
     * so a unique-index violation surfaces as
     * {@link DataIntegrityViolationException} here rather than at commit.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public ConfigRegistrationResponseDto persist(RegistrationDecision decision) {
        ConfigEntity configEntity = decision.config();
        CuratedCollectionEntity curatedEntity = decision.curated();
        boolean curated = isOperatorPkh(configEntity.getAdminPkh());

        // Inside the tx: a final pre-check + save. The unique constraints on
        // configs.config_nft_policy and curated_collections.slug guarantee
        // a concurrent insert won't sneak through; we surface that as a
        // DataIntegrityViolationException (handled in the controller as 409).
        if (configRepository.existsById(configEntity.getConfigNftPolicy())) {
            throw ConfigRegistrationException.duplicateConfig(configEntity.getConfigNftPolicy());
        }
        if (curated) {
            // Only check slug uniqueness if we're actually going to write the
            // curated row. Non-curated submissions don't claim a slug.
            if (curatedCollectionRepository.existsById(curatedEntity.getSlug())) {
                throw ConfigRegistrationException.duplicateSlug(curatedEntity.getSlug());
            }
            if (curatedCollectionRepository.existsByConfigNftPolicy(configEntity.getConfigNftPolicy())) {
                throw ConfigRegistrationException.duplicateConfig(configEntity.getConfigNftPolicy());
            }
        }

        configRepository.saveAndFlush(configEntity);
        if (curated) {
            curatedCollectionRepository.saveAndFlush(curatedEntity);
            log.info("config registered + auto-curated policy={} slug={} (admin_pkh matches operator allowlist)",
                    configEntity.getConfigNftPolicy(), curatedEntity.getSlug());
        } else {
            log.info("config registered (not curated) policy={} admin_pkh={} (not in operator allowlist, size={})",
                    configEntity.getConfigNftPolicy(), configEntity.getAdminPkh(), operatorPkhs.size());
        }

        // Notify the indexer's watch-set REGARDLESS of curation status — the
        // indexer tracks every registered config's listings; curation is just
        // about FE visibility. The event publisher is no-op-safe if no
        // listener is registered (e.g. shithole.indexer.enabled=false).
        eventPublisher.publishEvent(new ConfigRegisteredEvent(
                this,
                curatedEntity.getSlug(),
                curatedEntity.getConfigNftPolicy(),
                curatedEntity.getCollectionPolicyId(),
                curatedEntity.getListingScriptAddress()));

        return ConfigRegistrationResponseDto.builder()
                .configNftPolicy(configEntity.getConfigNftPolicy())
                .slug(curated ? curatedEntity.getSlug() : null)
                .collectionPolicyId(curatedEntity.getCollectionPolicyId())
                .m(configEntity.getM())
                .protocolFee(configEntity.getProtocolFee())
                .listerFee(configEntity.getListerFee())
                .adminPkh(configEntity.getAdminPkh())
                .treasuryAddrBech32(configEntity.getTreasuryAddrBech32())
                .utxoTxId(configEntity.getUtxoTxId())
                .utxoOutputIndex(configEntity.getUtxoOutputIndex())
                .displayName(curated ? curatedEntity.getDisplayName() : null)
                .theme(curated ? decision.theme() : null)
                .curated(curated)
                .build();
    }

    /** Case-insensitive operator pkh match. */
    private boolean isOperatorPkh(String adminPkh) {
        if (adminPkh == null || operatorPkhs.isEmpty()) return false;
        return operatorPkhs.contains(adminPkh.toLowerCase(Locale.ROOT));
    }

    /** Value object carrying the prepared (but not yet persisted) entities between phases. */
    record RegistrationDecision(
            ConfigEntity config,
            CuratedCollectionEntity curated,
            ThemeDto theme) {}

    // ---- helpers ----------------------------------------------------------

    private void validateShape(ConfigRegistrationRequestDto request) {
        if (request == null) {
            throw new IllegalArgumentException("request body required");
        }
        if (request.getConfigNftPolicy() == null
                || !request.getConfigNftPolicy().matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalArgumentException(
                    "config_nft_policy must be 56 hex characters (28-byte script hash)");
        }
        if (request.getSlug() == null
                || !request.getSlug().matches("^[a-z0-9]+(?:-[a-z0-9]+)*$")
                || request.getSlug().length() < 2
                || request.getSlug().length() > 32) {
            throw new IllegalArgumentException(
                    "slug must be 2..32 chars of [a-z0-9-], no leading/trailing/consecutive dashes");
        }
        if (request.getDisplayName() == null
                || !request.getDisplayName().matches("^[^\\p{Cntrl}]{1,64}$")) {
            throw new IllegalArgumentException("display_name must be 1..64 chars, no control chars");
        }
    }

    private String deriveConfigAddress(String scriptHashHex) {
        Credential credential = Credential.fromScript(scriptHashHex);
        Address address = AddressProvider.getEntAddress(credential, appNetwork);
        return address.toBech32();
    }

    /**
     * Page through Blockfrost UTxOs at {@code configAddress}, returning every
     * UTxO that holds exactly one asset whose unit is {@code policyHex + <28-byte asset name>}
     * with quantity 1. UTxOs holding 0 such assets are skipped; UTxOs holding 2+
     * fail as an invariant violation (a real config UTxO must hold the single
     * one-shot NFT and nothing else under the same policy).
     */
    private List<Utxo> fetchUtxosHoldingPolicy(String configAddress, String policyHex) {
        UtxoService utxoService = backendService.getUtxoService();
        List<Utxo> hits = new ArrayList<>();
        int page = 1; // Blockfrost paging is 1-based.
        while (page <= MAX_UTXO_PAGES) {
            Result<List<Utxo>> result;
            try {
                result = utxoService.getUtxos(configAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            } catch (ApiException e) {
                log.warn("Blockfrost getUtxos threw: {}", e.getMessage());
                throw ConfigRegistrationException.blockfrostUnavailable(
                        "backend call failed: " + e.getClass().getSimpleName());
            } catch (RuntimeException e) {
                log.warn("Blockfrost getUtxos runtime error: {}", e.getMessage());
                throw ConfigRegistrationException.blockfrostUnavailable(
                        "backend call failed: " + e.getClass().getSimpleName());
            }
            if (result == null) {
                throw ConfigRegistrationException.blockfrostUnavailable("backend returned null Result");
            }
            if (!result.isSuccessful()) {
                int code = result.code();
                if (code == 404) {
                    // Address never used → no UTxOs.
                    return List.of();
                }
                // Log the full response body but do not leak it to the client.
                log.warn("Blockfrost non-success status={} response={}", code, result.getResponse());
                throw ConfigRegistrationException.blockfrostUnavailable("backend status " + code);
            }
            List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) {
                break;
            }
            for (Utxo u : batch) {
                if (u.getAmount() == null) continue;
                // Two counts: every asset under the policy (anyUnderPolicy) vs assets
                // matching the strict shape (validMatches). A real config UTxO has
                // exactly one of each; any malformed co-tenant under the same policy
                // (wrong asset-name length, quantity != 1) means we treat the UTxO
                // as malformed and refuse to curate it.
                int anyUnderPolicy = 0;
                int validMatches = 0;
                for (Amount a : u.getAmount()) {
                    if (a.getUnit() == null) continue;
                    if (a.getUnit().length() < POLICY_HEX_LEN) continue;
                    if (!a.getUnit().regionMatches(true, 0, policyHex, 0, POLICY_HEX_LEN)) continue;
                    anyUnderPolicy++;
                    if (a.getUnit().length() == UNIT_HEX_LEN
                            && a.getQuantity() != null
                            && a.getQuantity().equals(BigInteger.ONE)) {
                        validMatches++;
                    }
                }
                if (anyUnderPolicy == 0) continue;
                if (anyUnderPolicy > 1 || validMatches != 1) {
                    throw ConfigRegistrationException.invariant(
                            "UTxO " + u.getTxHash() + "#" + u.getOutputIndex()
                                    + " has " + anyUnderPolicy + " assets under policy " + policyHex
                                    + " (expected exactly one with 28-byte asset name and quantity 1)");
                }
                hits.add(u);
            }
            if (batch.size() < UTXO_PAGE_SIZE) {
                break;
            }
            page++;
        }
        return hits;
    }

    private String extractAssetName(Utxo utxo, String policyHex) {
        return utxo.getAmount().stream()
                .filter(a -> a.getUnit() != null
                        && a.getUnit().length() == UNIT_HEX_LEN
                        && a.getUnit().regionMatches(true, 0, policyHex, 0, POLICY_HEX_LEN)
                        && a.getQuantity() != null
                        && a.getQuantity().equals(BigInteger.ONE))
                .map(a -> a.getUnit().substring(POLICY_HEX_LEN).toLowerCase(Locale.ROOT))
                .findFirst()
                .orElseThrow(() -> ConfigRegistrationException.invalidDatum(
                        "asset name missing for policy " + policyHex, null));
    }

    private record TreasuryAddressFields(
            String bech32,
            String paymentCredType,
            String paymentCredHash,
            String stakeCredType,
            String stakeCredHash) {}

    private TreasuryAddressFields decodeTreasuryAddress(ConfigDatum datum) {
        PaymentCredential pc = datum.getTreasuryAddr().getPaymentCredential();
        Optional<StakeCredential> sc = datum.getTreasuryAddr().getStakeCredential();

        Credential paymentCcl;
        String paymentType;
        String paymentHash;
        if (pc instanceof VerificationKey vk) {
            byte[] h = vk.getVerificationKeyHash().bytes();
            paymentCcl = Credential.fromKey(h);
            paymentType = "verification_key";
            paymentHash = hex(h);
        } else if (pc instanceof Script sc1) {
            byte[] h = sc1.getScriptHash().bytes();
            paymentCcl = Credential.fromScript(h);
            paymentType = "script";
            paymentHash = hex(h);
        } else {
            throw ConfigRegistrationException.invalidDatum(
                    "unsupported PaymentCredential variant: "
                            + (pc == null ? "null" : pc.getClass().getName()), null);
        }

        Credential stakeCcl = null;
        String stakeType = null;
        String stakeHash = null;
        if (sc != null && sc.isPresent()) {
            StakeCredential stake = sc.get();
            if (stake instanceof Inline inline) {
                com.easy1staking.shithole.blueprint.generated.cardano.address.model.Credential inner =
                        inline.getCredential();
                if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.VerificationKey vk) {
                    byte[] h = vk.getVerificationKeyHash().bytes();
                    stakeCcl = Credential.fromKey(h);
                    stakeType = "verification_key";
                    stakeHash = hex(h);
                } else if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.Script s) {
                    byte[] h = s.getScriptHash().bytes();
                    stakeCcl = Credential.fromScript(h);
                    stakeType = "script";
                    stakeHash = hex(h);
                } else {
                    throw ConfigRegistrationException.invalidDatum(
                            "unsupported stake inner Credential variant: "
                                    + (inner == null ? "null" : inner.getClass().getName()), null);
                }
            } else {
                // Pointer addresses are valid on-chain but we don't model them
                // in our DB columns and they're not expected for a treasury wallet.
                throw ConfigRegistrationException.invalidDatum(
                        "pointer / non-inline stake credentials are not supported for treasury_addr", null);
            }
        }

        Address bech32Address = stakeCcl == null
                ? AddressProvider.getEntAddress(paymentCcl, appNetwork)
                : AddressProvider.getBaseAddress(paymentCcl, stakeCcl, appNetwork);

        return new TreasuryAddressFields(
                bech32Address.toBech32(),
                paymentType, paymentHash, stakeType, stakeHash);
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }
}
