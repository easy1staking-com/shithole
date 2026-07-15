package com.easy1staking.shithole.config;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;

/**
 * Seeds marketplace-only curated collections (Gnomeskies / Snekkies / Hosky
 * 10k …) into {@code curated_collections} at boot. Unlike pit collections
 * (promoted from an on-chain config via {@code ConfigRegistrationService}),
 * these have NO config — they're real existing collections the marketplace
 * simply whitelists, so the BE needs their {@code collection_policy_id -> slug}
 * + theme + default pricing token to serve the activity/stats endpoints.
 *
 * <p>Reads {@code marketplace_collections.csv}, seeds only the rows matching
 * {@code app.network}, and is idempotent: a row is skipped if its slug OR its
 * collection policy already has a curated row (never clobbers a pit config).
 * Runs on {@link ApplicationReadyEvent} so Flyway + JPA are fully up.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MarketplaceCollectionSeeder {

    private static final String CSV = "classpath:marketplace_collections.csv";

    private final CuratedCollectionRepository curatedRepository;
    private final ResourceLoader resourceLoader;

    @Value("${app.network:mainnet}")
    private String appNetwork;

    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        Resource res = resourceLoader.getResource(CSV);
        if (!res.exists()) {
            log.warn("marketplace seed: {} not found — skipping", CSV);
            return;
        }
        int inserted = 0;
        int skipped = 0;
        boolean headerSeen = false;
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(res.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                if (!headerSeen) { // first data-looking line is the column header
                    headerSeen = true;
                    continue;
                }
                String[] c = trimmed.split(",", -1);
                if (c.length < 9) {
                    log.warn("marketplace seed: malformed row, skipping: {}", trimmed);
                    continue;
                }
                if (!c[0].trim().equalsIgnoreCase(appNetwork)) continue;

                String slug = c[1].trim();
                String policy = c[2].trim();
                if (curatedRepository.existsById(slug)
                        || curatedRepository.findFirstByCollectionPolicyId(policy).isPresent()) {
                    skipped++;
                    continue;
                }
                curatedRepository.save(CuratedCollectionEntity.builder()
                        .slug(slug)
                        .configNftPolicy(null)
                        .collectionPolicyId(policy)
                        .displayName(c[3].trim())
                        .accentColor(blankToNull(c[4]))
                        .displayOrder(0)
                        .promotedAt(OffsetDateTime.now())
                        .surface("marketplace")
                        .defaultPricePolicy(blankToNull(c[5]))
                        .defaultPriceName(blankToNull(c[6]))
                        .defaultPriceDecimals(parseIntOrNull(c[7]))
                        .priceTokenLabel(blankToNull(c[8]))
                        .build());
                inserted++;
            }
        } catch (IOException e) {
            log.error("marketplace seed: failed reading {}: {}", CSV, e.getMessage(), e);
            return;
        }
        log.info("marketplace seed [{}]: {} inserted, {} already present",
                appNetwork, inserted, skipped);
    }

    private static String blankToNull(String s) {
        String t = s == null ? null : s.trim();
        return (t == null || t.isEmpty()) ? null : t;
    }

    private static Integer parseIntOrNull(String s) {
        String t = blankToNull(s);
        if (t == null) return null;
        try {
            return Integer.valueOf(t);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
