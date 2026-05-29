package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import com.easy1staking.shithole.p2p.bot.P2pInFlightTracker;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Block-event-driven orchestrator for the P2P matcher bot.
 *
 * <p>Per-block flow:
 * <ol>
 *   <li>Hook {@link AddressUtxoEvent} — fires AFTER the indexer's
 *       {@code @Transactional} write phase commits, so {@code wanted_listing_events}
 *       already reflects this block's listings.</li>
 *   <li>Skip if a previous matcher tx is still in flight (we haven't
 *       observed it as confirmed yet). Avoids re-using listing UTxOs that
 *       a pending tx already plans to spend.</li>
 *   <li>Call {@link P2pMatcherDetector#scanForPairs()}.</li>
 *   <li>Pick the top-N (start with N=1) and submit via
 *       {@link P2pMatcherTxBuilder#buildAndSubmit(MatchedPair)}.</li>
 *   <li>Track the in-flight tx hash + pair key.</li>
 * </ol>
 *
 * <p>"In-flight confirmed" detection: once one of the pair's listing UTxOs
 * is marked spent in {@code wanted_listing_events} (by the indexer's
 * usual spent-path), the in-flight slot clears. We don't observe our own
 * tx hash directly — the indexer already does that work.
 *
 * <p>State is in-memory only. Restart-time loss of {@code lifetime_*}
 * counters is acceptable for v1; persistent matcher state is a follow-up.
 */
@Component
@ConditionalOnProperty(name = "shithole.p2p.matcher.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pMatcherCoordinator {

    /** Owner tag stamped onto entries this coordinator places in the shared in-flight tracker. */
    public static final String INFLIGHT_OWNER = "matcher";

    /** Number of pairs to submit per block. v1 picks the single best. */
    private static final int PAIRS_PER_BLOCK = 1;

    /** TTL for the "recently failed pair" cache. Avoids hot-loop on a bad pair. */
    private static final long FAILED_PAIR_TTL_MILLIS = 10 * 60_000L;

    private final P2pMatcherDetector detector;
    private final P2pMatcherTxBuilder txBuilder;
    /**
     * Shared in-flight tracker so the auto-fulfiller coordinator skips any
     * listings the matcher has reserved this block. Always-wired bean — its
     * absence would mean a misconfigured ApplicationContext, which we let
     * surface at startup rather than tolerate silently.
     */
    private final P2pInFlightTracker inFlightTracker;

    // ---- Status (read by the controller) ----------------------------------
    private final AtomicReference<Instant> lastScanAt = new AtomicReference<>();
    private final AtomicReference<Instant> lastMatchAt = new AtomicReference<>();
    private final AtomicReference<String> inFlightTxHash = new AtomicReference<>();
    private final AtomicReference<MatchedPair> inFlightPair = new AtomicReference<>();
    private final AtomicLong lifetimeMatches = new AtomicLong(0);
    private final AtomicLong lifetimeProfitLovelace = new AtomicLong(0);

    /** Pair-key → millisSinceEpoch when it failed. Pruned on access. */
    private final Map<String, Long> recentlyFailedPairs = new ConcurrentHashMap<>();

    /**
     * Serialises matcher work so two block events don't both try to submit
     * a tx in parallel. Block-event handlers may overlap if Spring's task
     * executor is async; we keep the matcher single-threaded.
     */
    private final ReentrantLock workLock = new ReentrantLock();

    /**
     * Block-event hook. Runs in the same Spring event-publication thread
     * as the indexers (sequentially after them); the indexer's
     * {@code @Transactional} write commits BEFORE our handler reads, so
     * the listing set we scan reflects this block's additions/spends.
     *
     * <p>Matcher submit is heavy (Blockfrost + Ogmios round-trips, CCL
     * balancing). To keep block ingestion responsive, this method
     * tryLock's a work-mutex and skips the block if the previous matcher
     * cycle hasn't finished. A future improvement is to push the work onto
     * an explicit task-executor; for v1, skipping is acceptable because
     * the next block-event arrives within seconds.
     */
    @EventListener(condition = "!@syncStatus.isSyncing()")
    @Order(100) // runs BEFORE the auto-fulfiller's @Order(200) handler so the
                // matcher grabs the highest-net pair first; auto-fulfiller
                // picks from the leftover listings via P2pInFlightTracker.
                //
                // The SpEL condition skips this handler entirely during
                // catch-up sync — submitting a Fulfill while the indexer is
                // 10k blocks behind tip would build against the stale UTxO
                // set and the tx would fail script eval on Blockfrost.
                // SyncStatus uses a 5-minute slot-distance threshold.
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) return;
        if (!workLock.tryLock()) {
            // Previous scan still running. Skip this block; we'll catch up
            // on the next event.
            return;
        }
        try {
            scanAndSubmit();
        } catch (RuntimeException e) {
            log.error("P2pMatcherCoordinator: uncaught error in scan/submit cycle: {}",
                    e.getMessage(), e);
        } finally {
            workLock.unlock();
        }
    }

    void scanAndSubmit() {
        lastScanAt.set(Instant.now());
        inFlightTracker.pruneExpired();

        // In-flight gate: if our previous tx hasn't been observed-spent by
        // the indexer yet, hold off. We could re-scan and pick a DIFFERENT
        // pair, but the risk is double-spending the same listing UTxO with
        // two concurrent txs in the mempool.
        if (inFlightTxHash.get() != null) {
            MatchedPair held = inFlightPair.get();
            if (held != null
                    && !inFlightTracker.isInFlight(P2pInFlightTracker.outrefKey(held.a()))
                    && !inFlightTracker.isInFlight(P2pInFlightTracker.outrefKey(held.b()))) {
                log.warn("P2pMatcherCoordinator: in-flight tx {} exceeded reservation TTL; clearing slot",
                        inFlightTxHash.get());
                inFlightTxHash.set(null);
                inFlightPair.set(null);
            } else if (isInFlightStillActive()) {
                log.debug("P2pMatcherCoordinator: skipping scan, tx {} still in flight",
                        inFlightTxHash.get());
                return;
            }
            // Listing UTxO is gone (either our tx confirmed or a competing
            // tx beat us). Clear in-flight state and continue.
            log.info("P2pMatcherCoordinator: in-flight tx {} resolved (listing spent); clearing slot",
                    inFlightTxHash.get());
            MatchedPair resolved = inFlightPair.get();
            if (resolved != null) {
                inFlightTracker.release(P2pInFlightTracker.outrefKey(resolved.a()), INFLIGHT_OWNER);
                inFlightTracker.release(P2pInFlightTracker.outrefKey(resolved.b()), INFLIGHT_OWNER);
            }
            inFlightTxHash.set(null);
            inFlightPair.set(null);
        }

        // Prune the failed-pair cache so old entries don't leak.
        pruneFailedPairs();

        List<MatchedPair> pairs = detector.scanForPairs();
        if (pairs.isEmpty()) return;

        int submitted = 0;
        for (MatchedPair pair : pairs) {
            if (submitted >= PAIRS_PER_BLOCK) break;
            if (recentlyFailedPairs.containsKey(pair.key())) continue;

            // Try to reserve BOTH legs of this pair in the shared in-flight
            // tracker before building the tx. If either leg is already held
            // (e.g. by the auto-fulfiller's previous-block tx still in flight),
            // skip this pair — we'd race the other loop and one tx would lose.
            String keyA = P2pInFlightTracker.outrefKey(pair.a());
            String keyB = P2pInFlightTracker.outrefKey(pair.b());
            if (!inFlightTracker.tryReserveAll(List.of(keyA, keyB), INFLIGHT_OWNER)) {
                log.debug("P2pMatcherCoordinator: skipping pair {} — at least one leg already in flight",
                        pair.key());
                continue;
            }
            boolean reservationHeld = true;
            try {
                P2pMatcherTxBuilder.BuildResult result = txBuilder.buildAndSubmit(pair);
                if (result.success()) {
                    inFlightTxHash.set(result.txHash());
                    inFlightPair.set(pair);
                    lastMatchAt.set(Instant.now());
                    lifetimeMatches.incrementAndGet();
                    lifetimeProfitLovelace.addAndGet(Math.max(0L, result.netLovelace()));
                    log.info("P2pMatcherCoordinator: submitted pair={} tx={} est_net={} lifetime_matches={}",
                            pair.key(), result.txHash(), result.netLovelace(),
                            lifetimeMatches.get());
                    submitted++;
                    // Reservation stays held until the listing is observed-spent.
                    reservationHeld = false;
                } else {
                    // Specific "race lost" classification — listing got
                    // spent before we could build. Don't blacklist (it
                    // wasn't OUR fault, and the listing is gone anyway).
                    String msg = result.errorMessage() == null ? "" : result.errorMessage();
                    if (msg.contains("race lost") || msg.contains("no longer on-chain")) {
                        log.info("P2pMatcherCoordinator: pair {} race lost ({}); skipping",
                                pair.key(), msg);
                    } else {
                        log.warn("P2pMatcherCoordinator: pair {} build/submit failed: {}",
                                pair.key(), msg);
                        recentlyFailedPairs.put(pair.key(), System.currentTimeMillis());
                    }
                }
            } catch (Exception e) {
                log.error("P2pMatcherCoordinator: exception submitting pair {}: {}",
                        pair.key(), e.getMessage(), e);
                recentlyFailedPairs.put(pair.key(), System.currentTimeMillis());
            } finally {
                if (reservationHeld) {
                    inFlightTracker.release(keyA, INFLIGHT_OWNER);
                    inFlightTracker.release(keyB, INFLIGHT_OWNER);
                }
            }
        }
    }

    /**
     * Returns true if the in-flight pair's listing UTxOs are STILL active
     * in {@code wanted_listing_events}. False means at least one has been
     * spent — either our tx confirmed (indexer marked it spent) or someone
     * else's tx beat us. Either way we can scan again.
     *
     * <p>The detector's repository-backed read is the source of truth; we
     * just reuse the same set of listings on every scan.
     */
    private boolean isInFlightStillActive() {
        MatchedPair pair = inFlightPair.get();
        if (pair == null) return false;
        List<MatchedPair> current = detector.scanForPairs();
        // Any pair whose two outrefs are still in the active set means our
        // listings are still active. Use the cheap key-equality.
        String myKey = pair.key();
        for (MatchedPair p : current) {
            if (p.key().equals(myKey)) return true;
        }
        return false;
    }

    private void pruneFailedPairs() {
        long now = System.currentTimeMillis();
        recentlyFailedPairs.entrySet().removeIf(e -> now - e.getValue() > FAILED_PAIR_TTL_MILLIS);
    }

    /* ---------------- Status accessors (used by the controller) ----------- */

    public Status getStatus() {
        return new Status(
                true,
                lastScanAt.get(),
                inFlightTxHash.get(),
                lastMatchAt.get(),
                lifetimeMatches.get(),
                lifetimeProfitLovelace.get());
    }

    /**
     * Snapshot of matcher state for the {@code GET /api/p2p/matcher/status}
     * endpoint. {@code enabled} is always true here because the bean only
     * loads when {@code shithole.p2p.matcher.enabled=true}. A disabled-state
     * variant is constructed directly by the controller.
     */
    public record Status(
            boolean enabled,
            Instant lastScanAt,
            String inFlightTxHash,
            Instant lastMatchAt,
            long lifetimeMatches,
            long lifetimeProfitLovelace) {}

    /** Test hook — surface the failed-pair cache snapshot for assertions. */
    Set<String> recentlyFailedPairKeysForTest() {
        return Collections.unmodifiableSet(new LinkedHashMap<>(recentlyFailedPairs).keySet());
    }
}
