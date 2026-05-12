package com.easy1staking.shithole;

import com.bloxbean.cardano.yaci.store.starter.core.YaciStoreAutoConfiguration;
import com.bloxbean.cardano.yaci.store.starter.utxo.UtxoStoreAutoConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Shithole BE entry point.
 *
 * <p>Yaci Store auto-configuration is excluded during the bootstrap phase.
 *
 * <p>History: under {@code yaci-store 0.1.6} the auto-config eagerly resolved
 * genesis files for the configured network and refused to start without them.
 * Under {@code yaci-store 2.1.0-pre3} the strict genesis-file check is gone
 * (empty paths fall back to a {@code ByronGenesis(protocolMagic)} stub), but
 * the auto-config still wires {@code BlockSync}/{@code BlockRangeSync}/
 * {@code GenesisBlockFinder} beans which point at the configured Cardano node
 * host:port. None of those beans connect eagerly, but they bring along
 * {@code @EnableJpaRepositories} + {@code @EntityScan} over the yaci-store
 * common/events packages and a {@code GenesisConfig @Component} that calls
 * {@code parseGenesisFiles()} in its constructor.
 *
 * <p>The bootstrap phase doesn't yet run an indexer, so we exclude both
 * auto-configs to keep the dependency surface minimal and avoid pulling
 * yaci-store entities into the JPA persistence context. The indexer phase
 * will re-enable them via a dedicated {@code @Configuration} guarded by a
 * {@code shithole.indexer.enabled} flag (default false) and provide the
 * genesis files / start slot for the target network. Until then, the REST
 * endpoints serve packaged fixtures.
 */
@SpringBootApplication(exclude = {
        YaciStoreAutoConfiguration.class,
        UtxoStoreAutoConfiguration.class
})
public class ShitholeApi {
    public static void main(String[] args) {
        SpringApplication.run(ShitholeApi.class, args);
    }
}
