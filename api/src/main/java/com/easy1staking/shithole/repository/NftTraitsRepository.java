package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.NftTraitsEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Repository for {@code nft_traits}. PK lookup carries the load — the seeder
 * iterates all rows on boot to (re)build pool memberships, and ad-hoc per-NFT
 * lookups go through {@link JpaRepository#findById(Object)}.
 *
 * <p>Trait-containment scans (e.g. "every NFT whose traits include
 * {@code {Background: Cyan}}") are JSONB-GIN-backed and best expressed via
 * native SQL when needed — added on demand, not pre-defined here.
 */
@Repository
public interface NftTraitsRepository extends JpaRepository<NftTraitsEntity, byte[]> {
}
