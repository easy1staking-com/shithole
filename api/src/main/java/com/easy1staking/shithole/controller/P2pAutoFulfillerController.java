package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.p2p.bot.P2pAutoFulfillerCoordinator;
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
 * Ops-only status endpoint for the autonomous P2P auto-fulfill bot. Sibling
 * to {@link P2pMatcherController} — same disabled-state behaviour (returns
 * {@code enabled: false} with the full key set so monitoring doesn't have to
 * special-case the off state).
 *
 * <p>Always wired (no {@code @ConditionalOnProperty}); the
 * {@link P2pAutoFulfillerCoordinator} bean is injected via
 * {@link ObjectProvider} so its conditional absence doesn't fail this
 * controller's wiring.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
public class P2pAutoFulfillerController {

    private final ObjectProvider<P2pAutoFulfillerCoordinator> coordinatorProvider;

    @GetMapping(value = "/p2p/auto-fulfill/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> status() {
        P2pAutoFulfillerCoordinator coord = coordinatorProvider.getIfAvailable();
        Map<String, Object> body = new LinkedHashMap<>();
        if (coord == null) {
            body.put("enabled", false);
            body.put("last_scan_at", null);
            body.put("last_match_at", null);
            body.put("inventory_count", 0);
            body.put("lifetime_fulfilled", 0);
            body.put("lifetime_profit_lovelace", 0);
            body.put("in_flight_count", 0);
            return ResponseEntity.ok(body);
        }
        P2pAutoFulfillerCoordinator.Status s = coord.getStatus();
        body.put("enabled", s.enabled());
        body.put("last_scan_at", formatInstant(s.lastScanAt()));
        body.put("last_match_at", formatInstant(s.lastMatchAt()));
        body.put("inventory_count", s.inventoryCount());
        body.put("lifetime_fulfilled", s.lifetimeFulfilled());
        body.put("lifetime_profit_lovelace", s.lifetimeProfitLovelace());
        body.put("in_flight_count", s.inFlightCount());
        return ResponseEntity.ok(body);
    }

    private static String formatInstant(Instant i) {
        return i == null ? null : DateTimeFormatter.ISO_INSTANT.format(i);
    }
}
