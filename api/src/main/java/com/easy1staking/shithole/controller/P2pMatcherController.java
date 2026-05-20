package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.matcher.P2pMatcherCoordinator;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Ops-only status endpoint for the autonomous P2P matcher bot. The bot has
 * no public POST surface — it's wholly autonomous, driven by chain events.
 * This GET is purely for operators / monitoring.
 *
 * <p>Always wired (no {@code @ConditionalOnProperty}) so when the matcher
 * is disabled the endpoint can still respond with {@code enabled: false}.
 * The {@link P2pMatcherCoordinator} bean is injected via
 * {@link ObjectProvider} so its conditional absence doesn't fail this
 * controller's wiring.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
public class P2pMatcherController {

    private final ObjectProvider<P2pMatcherCoordinator> coordinatorProvider;

    @GetMapping(value = "/p2p/matcher/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> status() {
        P2pMatcherCoordinator coord = coordinatorProvider.getIfAvailable();
        Map<String, Object> body = new LinkedHashMap<>();
        if (coord == null) {
            // Matcher disabled. Emit the same key set so the FE / monitor
            // doesn't have to special-case the off-state.
            body.put("enabled", false);
            body.put("last_scan_at", null);
            body.put("in_flight_tx_hash", null);
            body.put("last_match_at", null);
            body.put("lifetime_matches", 0);
            body.put("lifetime_profit_lovelace", 0);
            return ResponseEntity.ok(body);
        }
        P2pMatcherCoordinator.Status s = coord.getStatus();
        body.put("enabled", s.enabled());
        body.put("last_scan_at", formatInstant(s.lastScanAt()));
        body.put("in_flight_tx_hash", s.inFlightTxHash());
        body.put("last_match_at", formatInstant(s.lastMatchAt()));
        body.put("lifetime_matches", s.lifetimeMatches());
        body.put("lifetime_profit_lovelace", s.lifetimeProfitLovelace());
        return ResponseEntity.ok(body);
    }

    private static String formatInstant(Instant i) {
        return i == null ? null : DateTimeFormatter.ISO_INSTANT.format(i);
    }
}
