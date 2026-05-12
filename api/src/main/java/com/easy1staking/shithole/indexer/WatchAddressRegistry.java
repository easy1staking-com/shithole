package com.easy1staking.shithole.indexer;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory mirror of the {@code listing_script_address} → curation metadata
 * relation from {@code curated_collections}. Drives the
 * {@link ListingEventsIndexer}'s per-output hot path so we don't hit the DB
 * on every chain event.
 *
 * <p>Three refresh paths:
 * <ul>
 *   <li>{@link #load()} runs at startup ({@link PostConstruct}).</li>
 *   <li>{@link #onConfigRegistered(ConfigRegisteredEvent)} runs whenever the
 *       config-registration service publishes a new row.</li>
 *   <li>{@link #reconcile()} runs every 60s as a backstop so we recover from
 *       any missed event (e.g. the registration commit happened between
 *       startup load and the event publish, or a registration on another
 *       instance).</li>
 * </ul>
 *
 * <p>The map is keyed by the bech32 listing-script address. Values carry the
 * curated row's {@code config_nft_policy} (hex) and {@code collection_policy_id}
 * (hex) so the indexer can resolve datum / output info without re-querying.
 */
@Component
@ConditionalOnProperty(name = "shithole.indexer.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class WatchAddressRegistry {

    private final CuratedCollectionRepository curatedCollectionRepository;

    /** {@code listing_script_address (bech32) → curated row snapshot}. */
    private final Map<String, WatchedCollection> watched = new ConcurrentHashMap<>();

    @PostConstruct
    void load() {
        reconcile();
    }

    /**
     * Re-read curated_collections and reconcile the in-memory set. Idempotent;
     * a re-load just overwrites entries by key. We never remove entries during
     * the run — a curated collection cannot be un-curated in v1, but if that
     * changes the reconcile() will need to drop missing keys.
     */
    @Scheduled(fixedDelay = 60_000L, initialDelay = 60_000L)
    public synchronized void reconcile() {
        List<CuratedCollectionEntity> rows;
        try {
            rows = curatedCollectionRepository.findAll();
        } catch (RuntimeException e) {
            // The 60s reconcile must never bring down the indexer. Log and skip.
            log.warn("WatchAddressRegistry reconcile failed, will retry: {}", e.getMessage());
            return;
        }
        Map<String, WatchedCollection> next = new HashMap<>(watched);
        for (CuratedCollectionEntity row : rows) {
            String addr = row.getListingScriptAddress();
            if (addr == null || addr.isBlank()) {
                continue;
            }
            WatchedCollection wc = new WatchedCollection(
                    row.getSlug(),
                    row.getConfigNftPolicy(),
                    row.getCollectionPolicyId(),
                    addr);
            next.put(addr, wc);
        }
        watched.clear();
        watched.putAll(next);
        log.debug("WatchAddressRegistry reconciled: {} watched address(es)", watched.size());
    }

    @EventListener
    public void onConfigRegistered(ConfigRegisteredEvent event) {
        if (event.getListingScriptAddress() == null || event.getListingScriptAddress().isBlank()) {
            log.warn("ConfigRegisteredEvent for slug={} has no listing-script address; ignoring",
                    event.getSlug());
            return;
        }
        WatchedCollection wc = new WatchedCollection(
                event.getSlug(),
                event.getConfigNftPolicy(),
                event.getCollectionPolicyId(),
                event.getListingScriptAddress());
        watched.put(event.getListingScriptAddress(), wc);
        log.info("WatchAddressRegistry +slug={} address={}",
                event.getSlug(), event.getListingScriptAddress());
    }

    public boolean isWatched(String address) {
        return address != null && watched.containsKey(address);
    }

    public WatchedCollection get(String address) {
        return address == null ? null : watched.get(address);
    }

    public Set<String> all() {
        return Set.copyOf(watched.keySet());
    }

    public int size() {
        return watched.size();
    }

    /** Snapshot of the curated row needed for indexing. Immutable. */
    public record WatchedCollection(
            String slug,
            String configNftPolicy,
            String collectionPolicyId,
            String listingScriptAddress) {
    }
}
