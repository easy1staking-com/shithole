package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.ListingEventEntity;
import com.easy1staking.shithole.entity.ListingEventId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for the {@code listing_events} lineage table.
 *
 * <p>Finder methods cover the three load-bearing access patterns from
 * {@code docs/BACKEND.md} §"Swap-history lineage tracking":
 *
 * <ul>
 *   <li>"is this outref still a live listing?" — {@link #findActiveByTxHashAndOutputIndex(byte[], Integer)}</li>
 *   <li>"give me the whole history of this lineage" — {@link #findLineage(byte[], Integer)}</li>
 *   <li>"the swap datum embedded {@code compute_output_tag(prev_outref)}; which row was the prev outref?" —
 *       {@link #findByUpdateRefHash(byte[])}</li>
 * </ul>
 */
@Repository
public interface ListingEventRepository extends JpaRepository<ListingEventEntity, ListingEventId> {

    /**
     * Return the row for {@code (txHash, outputIndex)} only if it is still
     * an active listing (i.e. {@code spent_action IS NULL}). Postgres uses
     * the primary-key btree for this lookup; the {@code listing_events_active}
     * partial index is for the {@code (config_nft_policy, lister_pkh)} scan
     * paths used elsewhere.
     */
    @Query("select e from ListingEventEntity e "
            + "where e.txHash = :txHash "
            + "and e.outputIndex = :outputIndex "
            + "and e.spentAction is null")
    Optional<ListingEventEntity> findActiveByTxHashAndOutputIndex(
            @Param("txHash") byte[] txHash,
            @Param("outputIndex") Integer outputIndex);

    /**
     * Return every event for a lineage ordered by {@code swap_index}.
     * Backed by the {@code listing_events_lineage} index. The first row is
     * the genesis pay-to-script; the last row is either the still-live
     * listing or the terminal cancel/recover.
     */
    @Query("select e from ListingEventEntity e "
            + "where e.initialTxHash = :initialTxHash "
            + "and e.initialOutputIndex = :initialOutputIndex "
            + "order by e.swapIndex asc")
    List<ListingEventEntity> findLineage(
            @Param("initialTxHash") byte[] initialTxHash,
            @Param("initialOutputIndex") Integer initialOutputIndex);

    /**
     * Look up the listing event whose {@code update_ref_hash} matches the
     * given hash. Note the directionality: {@code update_ref_hash} is stored
     * on the SUCCESSOR row (the swap that created this listing), not on the
     * predecessor. To resolve {@code ListingDatum.update_ref} (a
     * {@code compute_output_tag(prev_outref)} hash) back to the structured
     * outref of the PREVIOUSLY consumed listing, call this finder to locate
     * the successor row, then look up the previous row in the same lineage at
     * {@code swap_index - 1}. Backed by the {@code listing_events_by_update_ref}
     * partial index.
     */
    @Query("select e from ListingEventEntity e where e.updateRefHash = :hash")
    Optional<ListingEventEntity> findByUpdateRefHash(@Param("hash") byte[] hash);
}
