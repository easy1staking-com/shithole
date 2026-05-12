package com.easy1staking.shithole.repository;

import com.easy1staking.shithole.entity.NftMetadataEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface NftMetadataRepository extends JpaRepository<NftMetadataEntity, String> {
}
