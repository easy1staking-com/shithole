package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.CandidateConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CandidateConfigRepository extends JpaRepository<CandidateConfigEntity, String> {
}
