package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CuratedCollectionRepository extends JpaRepository<CuratedCollectionEntity, String> {

    /**
     * Check whether a curated row already exists for a given config NFT policy.
     * Slug is the PK; this lets us 409 on duplicate config submissions where
     * the FE picks a different slug but the same policy.
     */
    boolean existsByConfigNftPolicy(String configNftPolicy);

    /**
     * Ordered list for {@code GET /api/curated}. Lower {@code displayOrder}
     * surfaces first; ties broken by slug for a stable response.
     */
    List<CuratedCollectionEntity> findAllByOrderByDisplayOrderAscSlugAsc();

    /**
     * Lookup by config NFT policy for the listing-script-address → config
     * resolution path (when the indexer or REST layer has a config hash and
     * needs the curation metadata).
     */
    Optional<CuratedCollectionEntity> findByConfigNftPolicy(String configNftPolicy);

    /**
     * Resolve a collection by its NFT policy id — the canonical multi-surface
     * key. Marketplace events derive it from the sold NFT's policy; used to
     * turn a {@code collection_policy_id} into a slug (and its curation
     * metadata) for the activity/stats endpoints.
     */
    Optional<CuratedCollectionEntity> findFirstByCollectionPolicyId(String collectionPolicyId);

    /**
     * Pit-visible curated collections for {@code GET /api/curated} — excludes
     * marketplace-only rows so the pit/p2p surfaces don't show collections
     * that have no on-chain config.
     */
    List<CuratedCollectionEntity> findBySurfaceNotOrderByDisplayOrderAscSlugAsc(String surface);
}
