package com.easy1staking.shithole.config;

import com.bloxbean.cardano.client.api.UtxoSupplier;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.api.DefaultUtxoSupplier;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.common.model.Networks;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the CCL Blockfrost backend used by the config-registration endpoint
 * ({@code POST /api/configs}) for on-chain validation.
 *
 * <p>{@code app.network} drives both the Blockfrost URL and the
 * {@link Network} bean used for address derivation. Supported values:
 * {@code mainnet}, {@code preprod}.
 *
 * <p>An empty {@code blockfrost.project-id} is tolerated at boot time so the
 * app can come up without a key — only the config-registration call path
 * needs it, and that path will fail loudly when invoked.
 */
@Configuration
@Slf4j
public class BlockfrostConfig {

    @Value("${app.network:mainnet}")
    private String appNetwork;

    @Value("${blockfrost.url:}")
    private String blockfrostUrl;

    @Value("${blockfrost.project-id:}")
    private String blockfrostProjectId;

    @Bean
    public Network appNetwork() {
        return switch (appNetwork.toLowerCase()) {
            case "mainnet" -> Networks.mainnet();
            case "preprod" -> Networks.preprod();
            case "preview" -> Networks.preview();
            default -> throw new IllegalArgumentException(
                    "Unsupported app.network=" + appNetwork + " (expected mainnet | preprod | preview)");
        };
    }

    @Bean
    public BackendService backendService() {
        String url = blockfrostUrl == null || blockfrostUrl.isBlank()
                ? defaultBlockfrostUrl()
                : blockfrostUrl;
        log.info("Blockfrost backend bound to url={} (project-id present={})",
                url, blockfrostProjectId != null && !blockfrostProjectId.isBlank());
        return new BFBackendService(url, blockfrostProjectId);
    }

    @Bean
    public UtxoSupplier utxoSupplier(BackendService backendService) {
        return new DefaultUtxoSupplier(backendService.getUtxoService());
    }

    private String defaultBlockfrostUrl() {
        return switch (appNetwork.toLowerCase()) {
            case "mainnet" -> "https://cardano-mainnet.blockfrost.io/api/v0/";
            case "preprod" -> "https://cardano-preprod.blockfrost.io/api/v0/";
            case "preview" -> "https://cardano-preview.blockfrost.io/api/v0/";
            default -> "https://cardano-mainnet.blockfrost.io/api/v0/";
        };
    }
}
