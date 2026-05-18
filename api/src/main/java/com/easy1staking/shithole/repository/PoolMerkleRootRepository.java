package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@code pool_merkle_roots}. Drives the four v3 endpoints +
 * the seeder's active-flag flip.
 *
 * <p>The PK is the 32-byte {@code merkle_root}. Active rows are looked up
 * via the {@code pool_merkle_roots_active_ticker} partial index.
 */
@Repository
public interface PoolMerkleRootRepository extends JpaRepository<PoolMerkleRootEntity, byte[]> {

    /**
     * All currently-active roots, ordered by ticker for stable JSON output.
     * Drives {@code GET /api/p2p/pools}.
     */
    @Query("select r from PoolMerkleRootEntity r "
            + "where r.isActive = true "
            + "order by r.ticker asc")
    List<PoolMerkleRootEntity> findAllActive();

    /**
     * Active root for a single ticker. Drives {@code GET /api/p2p/pools/{ticker}}.
     */
    @Query("select r from PoolMerkleRootEntity r "
            + "where r.ticker = :ticker "
            + "and r.isActive = true")
    Optional<PoolMerkleRootEntity> findActiveByTicker(@Param("ticker") String ticker);

    /**
     * Flip every row to active iff its {@code merkle_root} is in the supplied
     * set. Called once at boot, inside the seeder's transactional phase, after
     * INSERT-IF-MISSING has settled the rows for the current curation.
     *
     * <p>Two-step flip (everything OFF, then current ON) is intentional: a single
     * {@code SET is_active = (merkle_root IN :currentRoots)} would also flip
     * unrelated historical rows, but the semantic is the same — only currently-
     * curated roots are active. The two-step variant is easier to reason about
     * when the set is empty (e.g. dev with no curation).
     */
    @Modifying
    @Query("update PoolMerkleRootEntity r set r.isActive = false where r.isActive = true")
    int deactivateAll();

    @Modifying
    @Query("update PoolMerkleRootEntity r set r.isActive = true where r.merkleRoot in :currentRoots")
    int activate(@Param("currentRoots") List<byte[]> currentRoots);
}
