package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CuratedCollectionRepository extends JpaRepository<CuratedCollectionEntity, String> {
}
