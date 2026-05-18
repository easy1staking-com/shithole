package com.easy1staking.shithole.p2p;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/**
 * Two-phase boot seeder for v3 pool merkle roots. Runs once on
 * {@link ApplicationReadyEvent} (NOT {@code @PostConstruct} — we want JPA +
 * Flyway fully ready before reading the resource).
 *
 * <p><b>Phase 1 (validate + recompute, no DB):</b> read {@code pools.json},
 * for each pool decode {@code asset_names_hex} to {@code byte[]}s, recompute
 * the root via {@link PoolMerkleService#computeRoot(List)}, compare against
 * the resource's claimed root. ANY mismatch throws — the BE refuses to boot.
 * This catches three failure classes in one place:
 * <ul>
 *   <li>resource tampering (someone edited pools.json but didn't rebuild),</li>
 *   <li>library drift (a merkle-tree-java version bump changed the byte
 *   construction — would silently break every in-flight on-chain listing),</li>
 *   <li>generation-time bugs in {@code PoolMerkleBuilder}.</li>
 * </ul>
 *
 * <p><b>Phase 2 (persist):</b> delegates to {@link PoolMerklePersister}, a
 * separately-injected {@code @Service} so Spring's transaction proxy actually
 * wraps the {@code @Transactional} boundary (self-invoked transactional
 * methods on the same bean are silently inert).
 *
 * <p>Failures in Phase 1 abort boot (loud, on purpose). Failures in Phase 2
 * also abort — partial seeding is worse than no seeding, since a half-active
 * curation could produce proofs for some pools and 404s for others.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class PoolMerkleSeeder {

    private static final HexFormat HEX = HexFormat.of();

    private final PoolMerkleSeederProperties properties;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper objectMapper;
    private final PoolMerkleService poolMerkleService;
    private final PoolMerklePersister poolMerklePersister;

    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        if (!properties.enabled()) {
            log.info("v3 pool-merkle seeder disabled (shithole.p2p.enabled=false) — skipping");
            return;
        }

        PoolsManifest manifest = loadAndValidate();
        // Persist even when manifest is empty: an empty curation MUST
        // deactivate everything from prior boots, not no-op. Otherwise a
        // rollback to empty leaves stale active rows queryable forever.
        poolMerklePersister.persist(manifest);
        log.info("v3 pool-merkle seeder: {} pool(s) ready", manifest.pools().size());
    }

    // ---- phase 1: validate + recompute ------------------------------------

    private PoolsManifest loadAndValidate() {
        Resource resource = resourceLoader.getResource(properties.poolsResource());
        if (!resource.exists()) {
            if (properties.failOnMissingResource()) {
                throw new IllegalStateException(
                        "v3 pool-merkle resource missing: " + properties.poolsResource()
                                + " (set shithole.p2p.fail-on-missing-resource=false to allow empty boot)");
            }
            log.warn("v3 pool-merkle resource {} missing; treating as empty manifest",
                    properties.poolsResource());
            return new PoolsManifest(1, null, null, List.of());
        }

        PoolsManifest manifest;
        // Resource location may carry a `.gz` suffix — the builder emits
        // gzipped manifests by default because the uncompressed form is
        // ~73 MB. Sniff the suffix and stack GZIPInputStream when needed.
        // BufferedInputStream is intentional: GZIPInputStream's default
        // read buffer is tiny and Jackson's streaming parser triggers many
        // small reads.
        boolean gzipped = properties.poolsResource().endsWith(".gz");
        try (InputStream raw = resource.getInputStream();
             InputStream in = gzipped
                     ? new GZIPInputStream(new BufferedInputStream(raw))
                     : new BufferedInputStream(raw)) {
            manifest = objectMapper.readValue(in, PoolsManifest.class);
        } catch (IOException e) {
            throw new IllegalStateException(
                    "v3 pool-merkle resource " + properties.poolsResource() + " is unreadable", e);
        }

        // Cross-pool uniqueness: same active ticker twice would let two roots
        // claim the same name and break the partial unique index added in
        // V1_0_3, AND defeat findActiveByTicker (NonUniqueResultException →
        // 500 on /p2p/pools/{ticker}). Catch it at the manifest boundary.
        Set<String> seenTickers = new HashSet<>();
        for (PoolsManifest.PoolEntry pool : manifest.pools()) {
            if (!seenTickers.add(pool.ticker())) {
                throw new IllegalStateException(
                        "v3 pool-merkle: duplicate ticker '" + pool.ticker() + "' in manifest");
            }
            byte[] claimedRoot = parseHexExactOrThrow(pool.merkleRootHex(), 32,
                    "merkle_root_hex for ticker=" + pool.ticker());
            List<byte[]> assetNames = pool.assetNamesHex().stream()
                    .map(hex -> parseHexExactOrThrow(hex, 28,
                            "asset_names_hex entry under ticker=" + pool.ticker()))
                    .toList();
            if (assetNames.size() != pool.totalAssets()) {
                throw new IllegalStateException(
                        "v3 pool-merkle ticker=" + pool.ticker()
                                + " total_assets=" + pool.totalAssets()
                                + " but asset_names_hex has " + assetNames.size() + " entries");
            }
            if (pool.poolIdHex() != null) {
                parseHexExactOrThrow(pool.poolIdHex(), 28,
                        "pool_id_hex for ticker=" + pool.ticker());
            }
            byte[] recomputed = poolMerkleService.computeRoot(assetNames);
            if (!java.util.Arrays.equals(claimedRoot, recomputed)) {
                throw new IllegalStateException(
                        "v3 pool-merkle ticker=" + pool.ticker()
                                + " claimed root " + HEX.formatHex(claimedRoot)
                                + " ≠ recomputed " + HEX.formatHex(recomputed)
                                + " — refusing to boot. Resource tampering or library drift.");
            }
        }
        log.info("v3 pool-merkle: verified {} pool root(s) against {}",
                manifest.pools().size(), properties.poolsResource());
        return manifest;
    }

    private static byte[] parseHexExactOrThrow(String hex, int expectedLen, String field) {
        if (hex == null) {
            throw new IllegalStateException(field + " is null");
        }
        byte[] bytes;
        try {
            bytes = HEX.parseHex(hex);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(field + " is not valid hex: " + hex, e);
        }
        if (bytes.length != expectedLen) {
            throw new IllegalStateException(
                    field + " expected " + expectedLen + " bytes but got " + bytes.length
                            + " (hex=" + hex + ")");
        }
        return bytes;
    }

    /**
     * Externalised settings for the seeder. Bound under {@code shithole.p2p}
     * so operators can disable / point at a non-classpath manifest. Defaults:
     * enabled=true, resource=classpath:p2p/pools.json, fail-on-missing=true.
     */
    @ConfigurationProperties(prefix = "shithole.p2p")
    public record PoolMerkleSeederProperties(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("classpath:p2p/pools.json.gz") String poolsResource,
            @DefaultValue("true") boolean failOnMissingResource) {
    }

    /**
     * Enables binding of {@link PoolMerkleSeederProperties} from application
     * config. Separate from the seeder bean itself so tests can stub the
     * properties without spinning the seeder up.
     */
    @Configuration
    @EnableConfigurationProperties(PoolMerkleSeederProperties.class)
    public static class P2pConfig {
    }
}
