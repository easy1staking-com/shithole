package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.SwapEventEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SwapEventRepository extends JpaRepository<SwapEventEntity, Long> {
}
