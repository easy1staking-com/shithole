package com.easy1staking.shithole;

import com.bloxbean.cardano.yaci.store.starter.core.YaciStoreAutoConfiguration;
import com.bloxbean.cardano.yaci.store.starter.utxo.UtxoStoreAutoConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Shithole BE entry point.
 *
 * <p>Yaci Store auto-configuration is excluded during the bootstrap phase because
 * it eagerly resolves genesis files for the configured network and refuses to
 * start without them. The indexer phase will re-enable it via a dedicated
 * {@code @Configuration} guarded by a {@code shithole.indexer.enabled} flag
 * (default false) and provide the genesis files / start slot for the target
 * network. Until then, the REST endpoints serve packaged fixtures.
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
