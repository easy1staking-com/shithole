package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.MarketplaceEventEntity;
import com.easy1staking.shithole.entity.MarketplaceEventId;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for {@code marketplace_events}.
 *
 * <p>Three load-bearing access patterns:
 * <ul>
 *   <li>indexer spent-side: by composite PK (active only) →
 *       {@link #findActiveByTxHashAndOutputIndex}.</li>
 *   <li>/me history feed: all events a wallet participated in (as seller
 *       OR buyer) ordered by last-touched slot DESC →
 *       {@link #findAllByPkh}.</li>
 *   <li>seller's own active listings → {@link #findActiveBySellerPkh}.</li>
 * </ul>
 */
@Repository
public interface MarketplaceEventRepository
        extends JpaRepository<MarketplaceEventEntity, MarketplaceEventId> {

    /** Active by (tx_hash, output_index) — used by the indexer's spent-side. */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.txHash = :txHash "
            + "and e.outputIndex = :outputIndex "
            + "and e.spentAction is null")
    Optional<MarketplaceEventEntity> findActiveByTxHashAndOutputIndex(
            @Param("txHash") byte[] txHash,
            @Param("outputIndex") Integer outputIndex);

    /** Active listings created by a specific seller. */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.sellerPkh = :sellerPkh "
            + "and e.spentAction is null "
            + "order by e.createdAtSlot desc")
    List<MarketplaceEventEntity> findActiveBySellerPkh(
            @Param("sellerPkh") byte[] sellerPkh,
            Pageable pageable);

    /**
     * All marketplace events a wallet participated in — either as the
     * original seller OR as the buyer. Ordered most-recent first by the
     * row's last-modified slot (spent slot if spent, else created slot).
     * Powers {@code GET /api/market/listings/by-pkh/{pkh}}.
     */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.sellerPkh = :pkh or e.buyerPkh = :pkh "
            + "order by coalesce(e.spentAtSlot, e.createdAtSlot) desc")
    List<MarketplaceEventEntity> findAllByPkh(@Param("pkh") byte[] pkh, Pageable pageable);

    /** Same as {@link #findAllByPkh} but scoped to a single collection — the
     * optional {@code ?collection} filter on the per-user history feed. */
    @Query("select e from MarketplaceEventEntity e "
            + "where (e.sellerPkh = :pkh or e.buyerPkh = :pkh) "
            + "and e.collectionPolicyId = :policy "
            + "order by coalesce(e.spentAtSlot, e.createdAtSlot) desc")
    List<MarketplaceEventEntity> findAllByPkhAndCollectionPolicyId(
            @Param("pkh") byte[] pkh, @Param("policy") byte[] policy, Pageable pageable);

    /**
     * Public per-collection activity feed — every marketplace event for a
     * collection (listed / sold / cancelled), newest-first by last-touched
     * slot. Powers {@code GET /api/collections/{slug}/activity}.
     */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.collectionPolicyId = :policy "
            + "order by coalesce(e.spentAtSlot, e.createdAtSlot) desc")
    List<MarketplaceEventEntity> findByCollectionPolicyId(
            @Param("policy") byte[] policy, Pageable pageable);

    /** Count of currently-active (unspent) marketplace listings for a collection. */
    long countByCollectionPolicyIdAndSpentActionIsNull(byte[] collectionPolicyId);

    /**
     * Sold events for a collection since a cutoff — powers the 24h volume /
     * sale-count / unique-trader stats. Ordered newest-first.
     */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.collectionPolicyId = :policy "
            + "and e.spentAction = 'sold' "
            + "and e.spentAt >= :since "
            + "order by e.spentAt desc")
    List<MarketplaceEventEntity> findSoldSince(
            @Param("policy") byte[] policy,
            @Param("since") java.time.OffsetDateTime since);

    /** Active listings for a collection — used for floor price. */
    @Query("select e from MarketplaceEventEntity e "
            + "where e.collectionPolicyId = :policy and e.spentAction is null")
    List<MarketplaceEventEntity> findActiveByCollectionPolicyId(@Param("policy") byte[] policy);
}
