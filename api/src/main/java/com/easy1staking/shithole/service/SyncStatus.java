package com.easy1staking.shithole.service;

import com.bloxbean.cardano.yaci.store.common.service.CursorService;
import com.bloxbean.cardano.yaci.store.events.internal.CommitEvent;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cardanofoundation.conversions.CardanoConverters;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Tracks how far behind chain tip the local indexer is, and exposes
 * {@link #isSyncing()} so autonomous bots can gate their work on
 * "indexer caught up to wall-clock now".
 *
 * <p>Pattern ported verbatim from
 * {@code adamatic/cardano-recurring-payment-offchain}'s
 * {@code SyncStatus} (the only deltas are package + bean name; threshold
 * + comparison are identical).
 *
 * <h3>Why this matters here</h3>
 * The p2p matcher + auto-fulfiller submit chain txs whenever a new
 * block lands. During a fresh boot or a long downtime catch-up, the
 * indexer is replaying historical blocks at thousands-of-blocks-per-
 * second. If the bots fire during that catch-up they'll build txs
 * against ancient state — every tx is guaranteed to fail script
 * evaluation (the listing UTxO they thought was active was actually
 * spent ten thousand blocks later) and burn fees on submission.
 *
 * <h3>Mechanism</h3>
 * <ul>
 *   <li>At {@link PostConstruct}, seed {@code indexerSlot} from the
 *       persisted cursor — so a freshly-restarted process knows where
 *       it left off even before the first {@link CommitEvent} fires.</li>
 *   <li>On every {@link CommitEvent} (one per indexed block), update
 *       {@code indexerSlot} to that block's slot.</li>
 *   <li>{@link #isSyncing()} compares against the current wall-clock
 *       slot via {@link CardanoConverters}. Returns true when the
 *       distance >= {@link #SYNC_THRESHOLD_SLOTS} seconds, OR when
 *       {@code indexerSlot} is still zero (we haven't seen the first
 *       cursor / commit yet).</li>
 * </ul>
 *
 * <h3>Bean name</h3>
 * Declared as {@code @Service} (no explicit name), so Spring's default
 * name is {@code syncStatus}. SpEL conditions reference it as
 * {@code !@syncStatus.isSyncing()}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SyncStatus {

    /**
     * 5 minutes (Cardano post-Shelley: 1 slot = 1 second). A 5-minute
     * window comfortably covers a normal block-production interval
     * (~20s mean) plus indexer-to-DB lag, while still firing during the
     * dozens-of-seconds-to-minutes window of a fresh-boot catch-up.
     */
    private static final long SYNC_THRESHOLD_SLOTS = 300L;

    private final CardanoConverters cardanoConverters;

    private final CursorService cursorService;

    /**
     * Last slot the indexer committed. {@code 0L} means we haven't
     * observed either a startup cursor or a {@link CommitEvent} yet —
     * treated as "syncing" by {@link #isSyncing()}.
     */
    private final AtomicLong indexerSlot = new AtomicLong(0L);

    @PostConstruct
    public void init() {
        var cursorOpt = cursorService.getCursor();
        if (cursorOpt.isPresent()) {
            var cursor = cursorOpt.get();
            var currentSlot = cursor.getSlot();
            log.info("SyncStatus: seeded indexer slot from cursor: {}", currentSlot);
            indexerSlot.set(currentSlot);
        } else {
            log.info("SyncStatus: no cursor on disk — first run, will sync from start-slot");
        }
    }

    /**
     * Bump our notion of the indexer slot on every commit. Yaci-store
     * fires this once per persisted block, regardless of catch-up vs
     * tip mode.
     */
    @EventListener
    public void onCommit(CommitEvent<?> event) {
        if (event == null || event.getMetadata() == null) return;
        indexerSlot.set(event.getMetadata().getSlot());
    }

    /**
     * True iff the indexer is more than {@link #SYNC_THRESHOLD_SLOTS}
     * slots behind wall-clock now. Used as a SpEL condition on
     * autonomous bots' {@code @EventListener} methods to skip work
     * during catch-up.
     */
    public boolean isSyncing() {
        var slot = indexerSlot.get();
        if (slot == 0L) return true;
        var nowSlot = cardanoConverters.time().toSlot(LocalDateTime.now(ZoneOffset.UTC));
        return (nowSlot - slot) >= SYNC_THRESHOLD_SLOTS;
    }

    /** Current indexer slot — exposed for observability (status endpoints). */
    public long getIndexerSlot() {
        return indexerSlot.get();
    }
}
