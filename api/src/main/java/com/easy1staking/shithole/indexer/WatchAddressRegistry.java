package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
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
    private final ConfigRepository configRepository;
    private final Network appNetwork;
    private final WantedListingScriptAddressDeriver wantedListingScriptAddressDeriver;

    /**
     * Atomic snapshot of {@code listing_script_address → curated row}. Readers
     * see a stable, immutable map; writers atomically swap in a new map. This
     * closes the clear-then-fill window that a {@code ConcurrentHashMap.clear()
     * + putAll()} pair would expose to concurrent readers.
     */
    private final java.util.concurrent.atomic.AtomicReference<Map<String, WatchedCollection>> watched =
            new java.util.concurrent.atomic.AtomicReference<>(Map.of());

    /**
     * Parallel snapshot keyed by config script address (derived from
     * {@code config_nft_policy} via {@link AddressProvider}). Same
     * {@link WatchedCollection} values as {@link #watched}. Drives the
     * {@code ConfigEventsIndexer}'s per-output check.
     */
    private final java.util.concurrent.atomic.AtomicReference<Map<String, WatchedCollection>> watchedByConfigAddress =
            new java.util.concurrent.atomic.AtomicReference<>(Map.of());

    /**
     * Parallel snapshot keyed by the v3 wanted_listing script address
     * (derived from {@code config_nft_policy} via UPLC apply). Drives the
     * {@code WantedListingEventsIndexer}'s per-output check.
     */
    private final java.util.concurrent.atomic.AtomicReference<Map<String, WatchedCollection>> watchedByWantedAddress =
            new java.util.concurrent.atomic.AtomicReference<>(Map.of());

    @PostConstruct
    void load() {
        reconcile();
    }

    /**
     * Re-read curated_collections and reconcile the in-memory set. Idempotent;
     * a re-load just overwrites entries by key. We never remove entries during
     * the run — a curated collection cannot be un-curated in v1, but if that
     * changes the reconcile() will need to drop missing keys.
     *
     * <p>Builds the next snapshot into a fresh map, then atomically swaps it
     * in. Readers either see the old snapshot or the new one, never a half-
     * populated transient state.
     */
    @Scheduled(fixedDelay = 60_000L, initialDelay = 60_000L)
    public void reconcile() {
        List<CuratedCollectionEntity> rows;
        try {
            rows = curatedCollectionRepository.findAll();
        } catch (RuntimeException e) {
            // The 60s reconcile must never bring down the indexer. Log and skip.
            log.warn("WatchAddressRegistry reconcile failed, will retry: {}", e.getMessage());
            return;
        }
        Map<String, WatchedCollection> next = new HashMap<>(watched.get());
        Map<String, WatchedCollection> nextByConfig = new HashMap<>(watchedByConfigAddress.get());
        Map<String, WatchedCollection> nextByWanted = new HashMap<>(watchedByWantedAddress.get());
        for (CuratedCollectionEntity row : rows) {
            String addr = row.getListingScriptAddress();
            if (addr == null || addr.isBlank()) {
                continue;
            }
            String configAddr = deriveConfigScriptAddress(row.getConfigNftPolicy());
            String wantedAddr = deriveWantedListingAddress(row.getConfigNftPolicy());
            String treasuryAddr = null;
            String adminPkh = null;
            try {
                ConfigEntity config = configRepository.findById(row.getConfigNftPolicy()).orElse(null);
                if (config != null) {
                    treasuryAddr = config.getTreasuryAddrBech32();
                    adminPkh = config.getAdminPkh();
                }
            } catch (RuntimeException e) {
                // Config row missing or DB hiccup — fall through with nulls.
                // The indexer's counterparty classifier treats nulls as "no
                // signal" rather than "treasury matches everything".
                log.debug("Config lookup failed for policy {}: {}", row.getConfigNftPolicy(), e.getMessage());
            }
            WatchedCollection wc = new WatchedCollection(
                    row.getSlug(),
                    row.getConfigNftPolicy(),
                    row.getCollectionPolicyId(),
                    addr,
                    configAddr,
                    wantedAddr,
                    treasuryAddr,
                    adminPkh);
            next.put(addr, wc);
            if (configAddr != null) nextByConfig.put(configAddr, wc);
            if (wantedAddr != null) nextByWanted.put(wantedAddr, wc);
        }
        Map<String, WatchedCollection> snapshot = Map.copyOf(next);
        Map<String, WatchedCollection> configSnapshot = Map.copyOf(nextByConfig);
        Map<String, WatchedCollection> wantedSnapshot = Map.copyOf(nextByWanted);
        watched.set(snapshot);
        watchedByConfigAddress.set(configSnapshot);
        watchedByWantedAddress.set(wantedSnapshot);
        log.debug("WatchAddressRegistry reconciled: {} listing + {} config + {} wanted watched address(es)",
                snapshot.size(), configSnapshot.size(), wantedSnapshot.size());
    }

    /**
     * Derive the v3 wanted_listing script address from the config_nft_policy
     * via UPLC apply. Memoized inside the deriver service. Returns null on
     * derivation failure (logged) so the rest of the reconcile still goes
     * through — v3-specific failures shouldn't break v2 indexing.
     */
    private String deriveWantedListingAddress(String configNftPolicyHex) {
        if (configNftPolicyHex == null || configNftPolicyHex.isBlank()) return null;
        try {
            return wantedListingScriptAddressDeriver.deriveAddress(configNftPolicyHex);
        } catch (RuntimeException e) {
            log.warn("Failed to derive wanted_listing script address for policy {}: {}",
                    configNftPolicyHex, e.getMessage());
            return null;
        }
    }

    /**
     * Derive the bech32 config-script address from the {@code config_nft_policy}
     * hex (= the multi-handler validator's script hash). Returns {@code null}
     * if the hex is missing or malformed — caller falls through.
     */
    private String deriveConfigScriptAddress(String configNftPolicyHex) {
        if (configNftPolicyHex == null || configNftPolicyHex.isBlank()) return null;
        try {
            byte[] hash = HexUtil.decodeHexString(configNftPolicyHex);
            Credential cred = Credential.fromScript(hash);
            Address addr = AddressProvider.getEntAddress(cred, appNetwork);
            return addr.toBech32();
        } catch (RuntimeException e) {
            log.warn("Failed to derive config script address for policy {}: {}",
                    configNftPolicyHex, e.getMessage());
            return null;
        }
    }

    @EventListener
    public void onConfigRegistered(ConfigRegisteredEvent event) {
        if (event.getListingScriptAddress() == null || event.getListingScriptAddress().isBlank()) {
            log.warn("ConfigRegisteredEvent for slug={} has no listing-script address; ignoring",
                    event.getSlug());
            return;
        }
        String configAddr = deriveConfigScriptAddress(event.getConfigNftPolicy());
        String wantedAddr = deriveWantedListingAddress(event.getConfigNftPolicy());
        String treasuryAddr = null;
        String adminPkh = null;
        try {
            ConfigEntity config = configRepository.findById(event.getConfigNftPolicy()).orElse(null);
            if (config != null) {
                treasuryAddr = config.getTreasuryAddrBech32();
                adminPkh = config.getAdminPkh();
            }
        } catch (RuntimeException e) {
            log.debug("Config lookup failed for policy {} on register: {}",
                    event.getConfigNftPolicy(), e.getMessage());
        }
        WatchedCollection wc = new WatchedCollection(
                event.getSlug(),
                event.getConfigNftPolicy(),
                event.getCollectionPolicyId(),
                event.getListingScriptAddress(),
                configAddr,
                wantedAddr,
                treasuryAddr,
                adminPkh);
        watched.updateAndGet(prev -> {
            Map<String, WatchedCollection> next = new HashMap<>(prev);
            next.put(event.getListingScriptAddress(), wc);
            return Map.copyOf(next);
        });
        if (configAddr != null) {
            watchedByConfigAddress.updateAndGet(prev -> {
                Map<String, WatchedCollection> next = new HashMap<>(prev);
                next.put(configAddr, wc);
                return Map.copyOf(next);
            });
        }
        if (wantedAddr != null) {
            watchedByWantedAddress.updateAndGet(prev -> {
                Map<String, WatchedCollection> next = new HashMap<>(prev);
                next.put(wantedAddr, wc);
                return Map.copyOf(next);
            });
        }
        log.info("WatchAddressRegistry +slug={} listing={} config={} wanted={}",
                event.getSlug(), event.getListingScriptAddress(), configAddr, wantedAddr);
    }

    public boolean isWatched(String address) {
        return address != null && watched.get().containsKey(address);
    }

    public WatchedCollection get(String address) {
        return address == null ? null : watched.get().get(address);
    }

    /** Lookup by the config script address (not the listing address). */
    public WatchedCollection getByConfigAddress(String address) {
        return address == null ? null : watchedByConfigAddress.get().get(address);
    }

    /** Lookup by the v3 wanted_listing script address. */
    public WatchedCollection getByWantedAddress(String address) {
        return address == null ? null : watchedByWantedAddress.get().get(address);
    }

    public Set<String> all() {
        return watched.get().keySet();
    }

    public Set<String> allConfigAddresses() {
        return watchedByConfigAddress.get().keySet();
    }

    public Set<String> allWantedAddresses() {
        return watchedByWantedAddress.get().keySet();
    }

    public int size() {
        return watched.get().size();
    }

    /**
     * Set of all known treasury bech32 addresses, across every watched
     * collection. Used by the indexers' counterparty classifier to skip
     * treasury-bound outputs when picking the swapper / fulfiller pkh.
     */
    public Set<String> allTreasuryAddresses() {
        return watched.get().values().stream()
                .map(WatchedCollection::treasuryAddressBech32)
                .filter(s -> s != null && !s.isBlank())
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** Snapshot of the curated row needed for indexing. Immutable.
     *  {@code configScriptAddress} / {@code wantedListingScriptAddress} /
     *  {@code treasuryAddressBech32} / {@code adminPkhHex} may be null if
     *  their derivation or DB lookup failed at reconcile time. */
    public record WatchedCollection(
            String slug,
            String configNftPolicy,
            String collectionPolicyId,
            String listingScriptAddress,
            String configScriptAddress,
            String wantedListingScriptAddress,
            String treasuryAddressBech32,
            String adminPkhHex) {
    }
}
