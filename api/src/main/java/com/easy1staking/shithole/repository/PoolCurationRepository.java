package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.PoolCurationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Repository for {@code pool_curation}. PK is {@code ticker}; PK lookup is
 * sufficient for the seeder + controller. No custom queries yet.
 */
@Repository
public interface PoolCurationRepository extends JpaRepository<PoolCurationEntity, String> {
}
