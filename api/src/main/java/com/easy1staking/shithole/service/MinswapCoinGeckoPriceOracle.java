package com.easy1staking.shithole.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@link PriceOracle} backed by Minswap (token → ADA) + CoinGecko (ADA → USD).
 *
 * <p>Polls on a schedule and caches the last good value per source, so a
 * transient upstream failure (429 / outage) degrades to a stale-but-present
 * estimate rather than dropping it. Both upstreams are keyed on the REAL
 * mainnet token units, so estimates work even on a preprod BE (preprod-mimic
 * listings resolve to the same label via {@link #UNIT_TO_LABEL}).
 *
 * <p>Minswap: {@code GET /v1/assets/{unit}/metrics} → {@code price} (ADA, no
 * currency param). CoinGecko: {@code /simple/price?ids=cardano&vs_currencies=usd}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MinswapCoinGeckoPriceOracle implements PriceOracle {

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private static final String MINSWAP = "https://api-mainnet-prod.minswap.org/v1/assets/%s/metrics";
    private static final String COINGECKO =
            "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd";

    private final ObjectMapper objectMapper;

    /** label → ADA per whole token. */
    private final Map<String, BigDecimal> tokenAda = new ConcurrentHashMap<>();
    private volatile BigDecimal adaUsd;

    @Override
    public Optional<BigDecimal> tokenAdaPrice(String label) {
        return Optional.ofNullable(tokenAda.get(label));
    }

    @Override
    public Optional<BigDecimal> adaUsdPrice() {
        return Optional.ofNullable(adaUsd);
    }

    /** Poll ~every 60s; a short initial delay lets the app finish booting. */
    @Scheduled(initialDelay = 8_000, fixedDelay = 60_000)
    public void refresh() {
        for (Map.Entry<String, String> e : LABEL_TO_MAINNET_UNIT.entrySet()) {
            fetchTokenAda(e.getKey(), e.getValue());
        }
        fetchAdaUsd();
    }

    private void fetchTokenAda(String label, String unit) {
        try {
            JsonNode root = getJson(String.format(MINSWAP, unit));
            if (root == null) return;
            JsonNode price = root.path("price");
            if (price.isMissingNode() || price.isNull()) {
                log.debug("oracle: no price for {} in Minswap metrics", label);
                return;
            }
            BigDecimal ada = new BigDecimal(price.asText());
            if (ada.signum() > 0) {
                tokenAda.put(label, ada);
                log.debug("oracle: {} = {} ADA", label, ada);
            }
        } catch (Exception ex) {
            log.debug("oracle: Minswap fetch failed for {} — keeping last value: {}", label, ex.toString());
        }
    }

    private void fetchAdaUsd() {
        try {
            JsonNode root = getJson(COINGECKO);
            if (root == null) return;
            JsonNode usd = root.path("cardano").path("usd");
            if (usd.isMissingNode() || usd.isNull()) return;
            BigDecimal v = new BigDecimal(usd.asText());
            if (v.signum() > 0) {
                adaUsd = v;
                log.debug("oracle: ADA = {} USD", v);
            }
        } catch (Exception ex) {
            log.debug("oracle: CoinGecko fetch failed — keeping last value: {}", ex.toString());
        }
    }

    private JsonNode getJson(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("Accept", "application/json")
                .GET()
                .build();
        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            log.debug("oracle: {} -> HTTP {}", url, res.statusCode());
            return null;
        }
        return objectMapper.readTree(res.body());
    }
}
