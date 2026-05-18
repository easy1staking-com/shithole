package com.easy1staking.shithole.p2p;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

/**
 * Persistence half of the v3 pool-merkle seeder. Kept in a SEPARATE bean
 * (not on {@link PoolMerkleSeeder}) so Spring's transaction proxy actually
 * fires — a self-invoked {@code @Transactional} on a {@link PoolMerkleSeeder}
 * method would silently bypass the proxy and leave the {@code @Modifying}
 * deactivate/activate queries running outside any transaction.
 *
 * <p>{@code Propagation.REQUIRES_NEW} is intentional: the seeder runs from
 * {@code ApplicationReadyEvent}, where Spring typically has no surrounding
 * transaction. {@code REQUIRES_NEW} guarantees a fresh one and atomicity
 * across INSERT + deactivate + activate. The whole block must be all-or-
 * nothing so the active flag never settles in an inconsistent state.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PoolMerklePersister {

    private static final HexFormat HEX = HexFormat.of();

    private final PoolMerkleRootRepository poolMerkleRootRepository;
    private final PoolMerkleService poolMerkleService;

    /**
     * Insert-if-missing every verified pool, then flip {@code is_active} so
     * ONLY rows from {@code manifest.pools()} are active. Empty manifest is
     * still applied: every active row is deactivated, leaving zero active —
     * the seeder's idea of "the curation just rolled back to empty."
     *
     * <p>Pre-warms the {@link PoolMerkleService} cache for each pool so the
     * first proof request after boot doesn't pay a tree-rebuild.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void persist(PoolsManifest manifest) {
        OffsetDateTime now = OffsetDateTime.now();
        String nftVersion = Optional.ofNullable(manifest.source())
                .map(PoolsManifest.Source::jsonlSha256)
                .orElse("unknown");
        String curationVersion = Optional.ofNullable(manifest.source())
                .map(PoolsManifest.Source::csv)
                .orElse("unknown");

        List<byte[]> currentRoots = manifest.pools().stream()
                .map(p -> HEX.parseHex(p.merkleRootHex()))
                .toList();

        for (PoolsManifest.PoolEntry pool : manifest.pools()) {
            byte[] root = HEX.parseHex(pool.merkleRootHex());
            if (!poolMerkleRootRepository.existsById(root)) {
                PoolMerkleRootEntity row = PoolMerkleRootEntity.builder()
                        .merkleRoot(root)
                        .ticker(pool.ticker())
                        .poolId(pool.poolIdHex() == null ? null : HEX.parseHex(pool.poolIdHex()))
                        .assetNamesHex(pool.assetNamesHex())
                        .totalAssets(pool.totalAssets())
                        .isActive(false) // flip after the activate() update below
                        .sourceNftVersion(nftVersion)
                        .sourceCurationVersion(curationVersion)
                        .computedAt(now)
                        .build();
                poolMerkleRootRepository.saveAndFlush(row);
                log.info("v3 pool-merkle: inserted root {} ticker={}",
                        HEX.formatHex(root), pool.ticker());
            }
        }

        int deactivated = poolMerkleRootRepository.deactivateAll();
        int activated = currentRoots.isEmpty()
                ? 0
                : poolMerkleRootRepository.activate(currentRoots);
        log.info("v3 pool-merkle: active flip deactivated={} activated={}", deactivated, activated);

        // Warm the service cache while we hold the tx — exceptions here roll
        // back the active flip too, which is the desired all-or-nothing.
        for (PoolsManifest.PoolEntry pool : manifest.pools()) {
            byte[] root = HEX.parseHex(pool.merkleRootHex());
            List<byte[]> assetNames = pool.assetNamesHex().stream()
                    .map(HEX::parseHex)
                    .toList();
            poolMerkleService.cacheTree(root, assetNames);
        }
    }
}
