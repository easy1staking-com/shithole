package com.easy1staking.shithole;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Shithole BE entry point.
 *
 * <p>The Yaci Store auto-configurations ({@code YaciStoreAutoConfiguration},
 * {@code UtxoStoreAutoConfiguration}) are now active because the indexer
 * phase requires them. They wire {@code BlockSync}/{@code BlockRangeSync}/
 * {@code GenesisBlockFinder} plus {@code @EnableJpaRepositories} +
 * {@code @EntityScan} over the yaci-store common/events packages, and
 * publish {@code AddressUtxoEvent} / {@code UtxoRollbackEvent} on every
 * block. {@code com.easy1staking.shithole.indexer.ListingEventsIndexer}
 * subscribes via {@code @EventListener}.
 *
 * <p>History: under {@code yaci-store 0.1.6} the auto-config eagerly resolved
 * genesis files for the configured network and refused to start without them.
 * Under {@code yaci-store 2.1.0-pre3} the strict genesis-file check is gone
 * (empty paths fall back to a {@code ByronGenesis(protocolMagic)} stub), so
 * the auto-config wires safely in a headless dev environment with no genesis
 * paths configured. Production deployments must still supply real genesis
 * file paths via {@code store.cardano.*-genesis-file} for the target network.
 */
@SpringBootApplication
@EnableJpaRepositories(basePackages = "com.easy1staking.shithole.repository")
@EntityScan(basePackages = "com.easy1staking.shithole.entity")
@EnableScheduling
public class ShitholeApi {
    public static void main(String[] args) {
        SpringApplication.run(ShitholeApi.class, args);
    }
}
