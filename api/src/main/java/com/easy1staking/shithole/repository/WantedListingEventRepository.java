package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.entity.WantedListingEventId;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@code wanted_listing_events}.
 *
 * <p>Query patterns:
 * <ul>
 *   <li>browse: list active listings, optionally filtered by collection
 *       or by merkle root</li>
 *   <li>"my listings": active listings I created (by buyer_pkh)</li>
 *   <li>indexer: lookup-on-spent (by outref PK)</li>
 * </ul>
 */
@Repository
public interface WantedListingEventRepository
        extends JpaRepository<WantedListingEventEntity, WantedListingEventId> {

    /** Active by (tx_hash, output_index) — used by the indexer's spent-side. */
    @Query("select e from WantedListingEventEntity e "
            + "where e.txHash = :txHash "
            + "and e.outputIndex = :outputIndex "
            + "and e.spentAction is null")
    Optional<WantedListingEventEntity> findActiveByTxHashAndOutputIndex(
            @Param("txHash") byte[] txHash,
            @Param("outputIndex") Integer outputIndex);

    /** All active listings, newest first. Drives the bare /p2p browse page. */
    @Query("select e from WantedListingEventEntity e "
            + "where e.spentAction is null "
            + "order by e.createdAtSlot desc")
    List<WantedListingEventEntity> findAllActive(Pageable pageable);

    /** Active listings under a specific collection (config_nft_policy). */
    @Query("select e from WantedListingEventEntity e "
            + "where e.configNftPolicy = :policy "
            + "and e.spentAction is null "
            + "order by e.createdAtSlot desc")
    List<WantedListingEventEntity> findActiveByConfigNftPolicy(
            @Param("policy") byte[] configNftPolicy,
            Pageable pageable);

    /** Active listings whose accepted_merkle_root is in :roots. */
    @Query("select e from WantedListingEventEntity e "
            + "where e.acceptedMerkleRoot in :roots "
            + "and e.spentAction is null "
            + "order by e.createdAtSlot desc")
    List<WantedListingEventEntity> findActiveByMerkleRoots(
            @Param("roots") List<byte[]> roots,
            Pageable pageable);

    /** Active listings created by a specific buyer. */
    @Query("select e from WantedListingEventEntity e "
            + "where e.buyerPkh = :buyerPkh "
            + "and e.spentAction is null "
            + "order by e.createdAtSlot desc")
    List<WantedListingEventEntity> findActiveByBuyerPkh(
            @Param("buyerPkh") byte[] buyerPkh,
            Pageable pageable);

    /** All listings (active + historical) by buyer; for "your past listings" view. */
    @Query("select e from WantedListingEventEntity e "
            + "where e.buyerPkh = :buyerPkh "
            + "order by e.createdAtSlot desc")
    List<WantedListingEventEntity> findAllByBuyerPkh(
            @Param("buyerPkh") byte[] buyerPkh,
            Pageable pageable);

    long countByConfigNftPolicyAndSpentActionIsNull(byte[] configNftPolicy);

    /**
     * All wanted-listing events a wallet participated in — either as the
     * original buyer OR as the fulfiller (V1_0_6+). Ordered most-recent
     * first by the row's last-modified slot (spent slot if spent, else
     * created slot). Powers {@code GET /api/p2p/listings/by-pkh/{pkh}}
     * for the unified wallet-history view.
     */
    @Query("select e from WantedListingEventEntity e "
            + "where e.buyerPkh = :pkh or e.fulfillerPkh = :pkh "
            + "order by coalesce(e.spentAtSlot, e.createdAtSlot) desc")
    List<WantedListingEventEntity> findAllByPkh(@Param("pkh") byte[] pkh, Pageable pageable);
}
