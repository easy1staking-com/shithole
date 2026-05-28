package com.easy1staking.shithole.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.easy1staking.shithole.model.TraitWithRarity;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * In-memory rarity lookup for NFT collections we've pre-aggregated.
 *
 * <p>On startup loads every {@code classpath:rarity/*.json} resource and
 * indexes it by {@code policyId} → {@code categoryName} →
 * {@code traitValue} → {@code (count, pct)}. Each file mirrors the shape
 * the FE ships at {@code web/src/lib/data/hosky-rarity.json}:
 *
 * <pre>{@code
 * {
 *   "policyId": "a5bb0e5b...",
 *   "collectionName": "HOSKY CashGrab",
 *   "totalCount": 420420,
 *   "categories": [
 *     { "name": "Fur", "values": [{"value": "Original", "count": 151663, "pct": 36.07}, ...] },
 *     ...
 *   ]
 * }
 * }</pre>
 *
 * <p>Rarity data is collection-specific and the source-of-truth lives in the
 * pre-aggregation script under {@code .local/build-hosky-rarity.py}. Add
 * a new collection by dropping its JSON next to {@code hosky-cashgrab.json}
 * and restarting the BE.
 *
 * <p>The {@code enrich(policyId, category, value)} API is null-safe: an
 * unknown policy or category returns a {@link TraitWithRarity} carrying the
 * incoming category/value and null rarity, so callers can always emit a
 * uniform shape without checking up front.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RarityService {

    private final ObjectMapper objectMapper;

    /** policyId -> categoryName -> value -> (count, pct). */
    private final Map<String, Map<String, Map<String, RarityInfo>>> rarity = new HashMap<>();

    @PostConstruct
    public void load() {
        ResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
        Resource[] resources;
        try {
            resources = resolver.getResources("classpath:rarity/*.json");
        } catch (IOException e) {
            log.warn("rarity: failed to enumerate classpath:rarity/*.json — service will return empty", e);
            return;
        }
        for (Resource res : resources) {
            try (var in = res.getInputStream()) {
                JsonNode root = objectMapper.readTree(in);
                String policyId = root.path("policyId").asText(null);
                if (policyId == null || policyId.isBlank()) {
                    log.warn("rarity: file {} missing top-level policyId — skipping", res.getFilename());
                    continue;
                }
                policyId = policyId.toLowerCase(Locale.ROOT);
                Map<String, Map<String, RarityInfo>> byCategory = new HashMap<>();
                JsonNode cats = root.path("categories");
                if (cats.isArray()) {
                    for (JsonNode cat : cats) {
                        String name = cat.path("name").asText(null);
                        if (name == null) continue;
                        Map<String, RarityInfo> byValue = new HashMap<>();
                        JsonNode vals = cat.path("values");
                        if (vals.isArray()) {
                            for (JsonNode v : vals) {
                                String value = v.path("value").asText(null);
                                if (value == null) continue;
                                long count = v.path("count").asLong(0);
                                double pct = v.path("pct").asDouble(0.0);
                                byValue.put(value, new RarityInfo(count, pct));
                            }
                        }
                        byCategory.put(name, byValue);
                    }
                }
                rarity.put(policyId, byCategory);
                log.info("rarity: loaded {} ({} categories) from {}", policyId,
                        byCategory.size(), res.getFilename());
            } catch (IOException e) {
                log.warn("rarity: failed to parse {} — skipping", res.getFilename(), e);
            }
        }
    }

    /**
     * Build a {@link TraitWithRarity} carrying the collection-wide rarity for
     * {@code (policyId, category, value)} when known. Falls back to a
     * rarity-less entry when the policy isn't loaded or the value isn't found —
     * callers always get a non-null result with at least {@code category}/{@code value}.
     */
    public TraitWithRarity enrich(String policyId, String category, String value) {
        TraitWithRarity.TraitWithRarityBuilder b = TraitWithRarity.builder()
                .category(category)
                .value(value);
        if (policyId == null) return b.build();
        Optional.ofNullable(rarity.get(policyId.toLowerCase(Locale.ROOT)))
                .map(byCat -> byCat.get(category))
                .map(byVal -> byVal.get(value))
                .ifPresent(info -> b.count(info.count).pct(info.pct));
        return b.build();
    }

    /** Whether we have a rarity table for the given policyId (any data at all). */
    public boolean hasRarity(String policyId) {
        if (policyId == null) return false;
        return rarity.containsKey(policyId.toLowerCase(Locale.ROOT));
    }

    private record RarityInfo(long count, double pct) {}

    // Test helper.
    Iterator<String> loadedPolicies() {
        return rarity.keySet().iterator();
    }
}
