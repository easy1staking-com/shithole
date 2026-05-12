package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CuratedCollectionRepository extends JpaRepository<CuratedCollectionEntity, String> {

    /**
     * Check whether a curated row already exists for a given config NFT policy.
     * Slug is the PK; this lets us 409 on duplicate config submissions where
     * the FE picks a different slug but the same policy.
     */
    boolean existsByConfigNftPolicy(String configNftPolicy);
}
