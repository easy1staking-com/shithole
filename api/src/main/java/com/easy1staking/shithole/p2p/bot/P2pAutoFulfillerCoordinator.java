package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Block-event-driven orchestrator for the autonomous P2P auto-fulfill bot.
 *
 * <p>Per-block flow:
 * <ol>
 *   <li>Hook {@link AddressUtxoEvent} — fires AFTER the indexer's
 *       {@code @Transactional} write commits AND after the matcher's
 *       coordinator runs (by {@link Order @Order(200)} vs the matcher's
 *       {@code @Order(100)}; same Spring event dispatch).</li>
 *   <li>Call {@link P2pAutoFulfillerDetector#scanForFulfillable()}.</li>
 *   <li>For each candidate (capped at {@code max-per-block}):
 *     <ul>
 *       <li>Reserve the listing's outref in the shared
 *           {@link P2pInFlightTracker} — the matcher might still hold pieces
 *           of this set, so the detector's earlier filter is a hint, not a
 *           guarantee.</li>
 *       <li>Build + submit via {@link P2pAutoFulfillerTxBuilder}.</li>
 *       <li>On submit success leave the reservation in place until the
 *           listing is observed-spent. On failure release immediately.</li>
 *     </ul>
 *   </li>
 * </ol>
 *
 * <p>State is in-memory only (lifetime counters reset on restart).
 * Persistent ledger is a follow-up.
 *
 * <p><b>Matcher coordination:</b> the matcher runs FIRST (lower {@link Order}
 * value). When it submits a pair, both legs' outrefs are reserved in
 * {@link P2pInFlightTracker}. The auto-fulfiller's detector then skips those
 * listings, so the two loops cannot try to spend the same UTxO in the same
 * block. The decision to keep them in SEPARATE coordinators (rather than
 * merging into a single P2pBotCoordinator) keeps each loop independently
 * disable-able via its own {@code enabled} flag.
 */
@Component
@ConditionalOnProperty(name = "shithole.p2p.auto-fulfill.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pAutoFulfillerCoordinator {

    /** Owner tag stamped onto entries this coordinator places in the shared in-flight tracker. */
    public static final String INFLIGHT_OWNER = "auto-fulfill";

    private final P2pAutoFulfillerDetector detector;
    private final P2pAutoFulfillerTxBuilder txBuilder;
    private final P2pInFlightTracker inFlightTracker;
    private final BotWalletInventoryReader inventoryReader;

    // ---- Status (read by the controller) ----------------------------------
    private final AtomicReference<Instant> lastScanAt = new AtomicReference<>();
    private final AtomicReference<Instant> lastMatchAt = new AtomicReference<>();
    private final AtomicLong lifetimeFulfilled = new AtomicLong(0);
    private final AtomicLong lifetimeProfitLovelace = new AtomicLong(0);
    private final AtomicInteger lastInventoryCount = new AtomicInteger(0);

    /**
     * Serialises auto-fulfiller work across overlapping block events. Same
     * pattern as the matcher: tryLock + skip-if-busy to keep block ingestion
     * responsive. The next block will pick up the slack.
     */
    private final ReentrantLock workLock = new ReentrantLock();

    /**
     * Block-event hook. Runs AFTER {@link com.easy1staking.shithole.matcher
     * .P2pMatcherCoordinator}'s handler (Spring's {@link Order @Order} on
     * listener beans is honored within the same event-dispatch sequence).
     */
    @EventListener(condition = "!@syncStatus.isSyncing()")
    @Order(200) // runs AFTER P2pMatcherCoordinator's @Order(100) handler so
                // the matcher's reservations land in P2pInFlightTracker before
                // the auto-fulfiller scans, and the auto-fulfiller picks from
                // the leftover listings.
                //
                // Gated on SyncStatus for the same reason as the matcher: a
                // Fulfill built during catch-up replays against the wrong
                // listing set and burns fees on a guaranteed-fail submit.
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) return;
        if (!workLock.tryLock()) return; // previous cycle still running
        try {
            scanAndSubmit();
        } catch (RuntimeException e) {
            log.error("P2pAutoFulfillerCoordinator: uncaught error in scan/submit cycle: {}",
                    e.getMessage(), e);
        } finally {
            workLock.unlock();
        }
    }

    void scanAndSubmit() {
        lastScanAt.set(Instant.now());
        inFlightTracker.pruneExpired();

        // Refresh inventory size for the status endpoint. Cheap — same call
        // the detector makes (with snapshot semantics; no chain re-query
        // beyond Blockfrost's normal page).
        try {
            BotWalletInventory inventory = walletInventoryForStatus();
            lastInventoryCount.set(inventory.totalCount());
            List<FulfillCandidate> candidates = detector.scanWithInventory(inventory);
            if (candidates.isEmpty()) return;
            submitCandidates(candidates);
        } catch (RuntimeException e) {
            log.error("P2pAutoFulfillerCoordinator: scan failed: {}", e.getMessage(), e);
        }
    }

    /**
     * Hook to read the inventory once per cycle. Extracted so the test can
     * stub it without touching the wallet reader. Production calls into
     * {@link P2pAutoFulfillerDetector}'s wallet reader path indirectly via
     * {@link P2pAutoFulfillerDetector#scanForFulfillable()}; the coordinator
     * reads it directly here so the status endpoint can report the size even
     * on cycles where no candidates are found.
     */
    private BotWalletInventory walletInventoryForStatus() {
        return inventoryReader.read();
    }

    private void submitCandidates(List<FulfillCandidate> candidates) {

        for (FulfillCandidate candidate : candidates) {
            String listingKey = candidate.listingOutrefKey();
            if (!inFlightTracker.tryReserve(listingKey, INFLIGHT_OWNER)) {
                // Another loop reserved this listing between detect and submit.
                log.debug("P2pAutoFulfillerCoordinator: skipping {} — contended", listingKey);
                continue;
            }
            boolean reservationHeld = true;
            try {
                P2pAutoFulfillerTxBuilder.BuildResult result =
                        txBuilder.buildAndSubmit(candidate);
                if (result.success()) {
                    lastMatchAt.set(Instant.now());
                    lifetimeFulfilled.incrementAndGet();
                    lifetimeProfitLovelace.addAndGet(Math.max(0L, result.netLovelace()));
                    log.info("P2pAutoFulfillerCoordinator: submitted listing={} tx={} est_net={} lifetime_fulfilled={}",
                            listingKey, result.txHash(), result.netLovelace(),
                            lifetimeFulfilled.get());
                    // Reservation stays until indexer observes the listing spent
                    // (releases naturally via the next coordinator pass once the
                    // listing drops out of the active set — or by the
                    // OutputSpentEvent path in a future enhancement).
                    reservationHeld = false;
                } else {
                    String msg = result.errorMessage() == null ? "" : result.errorMessage();
                    if (msg.contains("race lost") || msg.contains("no longer on-chain")) {
                        log.info("P2pAutoFulfillerCoordinator: listing {} race lost ({}); skipping",
                                listingKey, msg);
                    } else {
                        log.warn("P2pAutoFulfillerCoordinator: listing {} build/submit failed: {}",
                                listingKey, msg);
                    }
                }
            } catch (Exception e) {
                log.error("P2pAutoFulfillerCoordinator: exception submitting listing {}: {}",
                        listingKey, e.getMessage(), e);
            } finally {
                if (reservationHeld) {
                    inFlightTracker.release(listingKey, INFLIGHT_OWNER);
                }
            }
        }
    }

    /* ---------------- Status accessors (used by the controller) ----------- */

    public Status getStatus() {
        return new Status(
                true,
                lastScanAt.get(),
                lastMatchAt.get(),
                lastInventoryCount.get(),
                lifetimeFulfilled.get(),
                lifetimeProfitLovelace.get(),
                inFlightTracker.size());
    }

    /**
     * Snapshot for {@code GET /api/p2p/auto-fulfill/status}. {@code enabled}
     * is always true here because the bean only loads when
     * {@code shithole.p2p.auto-fulfill.enabled=true}.
     */
    public record Status(
            boolean enabled,
            Instant lastScanAt,
            Instant lastMatchAt,
            int inventoryCount,
            long lifetimeFulfilled,
            long lifetimeProfitLovelace,
            int inFlightCount) {}

    /**
     * Test hook so unit tests can inject the inventory count without going
     * through the wallet reader.
     */
    void setLastInventoryCountForTest(int count) {
        this.lastInventoryCount.set(count);
    }
}
