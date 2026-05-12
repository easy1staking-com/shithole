package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.ListingEntity;
import com.easy1staking.shithole.entity.ListingId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ListingRepository extends JpaRepository<ListingEntity, ListingId> {
}
