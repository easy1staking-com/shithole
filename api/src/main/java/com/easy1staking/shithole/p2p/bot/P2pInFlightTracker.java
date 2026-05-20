package com.easy1staking.shithole.p2p.bot;

import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.matcher.MatchedPair;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Process-wide set of {@code (tx_hash, output_index)} outrefs that one of the
 * P2P bot loops (matcher or auto-fulfiller) has SUBMITTED a tx for but hasn't
 * yet observed as confirmed-spent in {@code wanted_listing_events}.
 *
 * <p>Both coordinators consult and contribute to this set so the two loops
 * never both try to spend the same listing UTxO. The matcher registers BOTH
 * outrefs of a {@link MatchedPair}; the auto-fulfiller registers the single
 * outref of a {@code FulfillCandidate}.
 *
 * <p>Entries clear in three ways:
 * <ul>
 *   <li>Explicit {@link #release(String)} call by the coordinator when its
 *       in-flight tx is observed-spent (or it gives up).</li>
 *   <li>{@link #releaseAll(java.util.Collection)} for batch clearing.</li>
 *   <li>TTL eviction on access. This is deliberately fail-open after a long
 *       timeout so a dropped mempool tx cannot block a listing forever.</li>
 * </ul>
 *
 * <p>Always-wired bean (no {@code @ConditionalOnProperty}) — present whether
 * either bot loop is enabled, so the controller can introspect even when both
 * loops are off. Callers cheaply read-only with {@link #isInFlight(String)}.
 *
 * <p>Keys are the canonical outref string {@code lower_hex(txHash) + "#" + idx}.
 * Use {@link #outrefKey(byte[], int)} to derive; helpers also accept a
 * {@link WantedListingEventEntity} or a {@link MatchedPair} directly.
 */
@Component
@Slf4j
public class P2pInFlightTracker {

    /** Long enough for normal confirmation, finite so dropped txs do not leak forever. */
    static final long DEFAULT_TTL_MILLIS = 30 * 60_000L;

    /** outrefKey → owner/timestamp reservation metadata. */
    private final ConcurrentHashMap<String, Reservation> inFlight = new ConcurrentHashMap<>();

    private final long ttlMillis;

    public P2pInFlightTracker() {
        this(DEFAULT_TTL_MILLIS);
    }

    P2pInFlightTracker(long ttlMillis) {
        if (ttlMillis <= 0) {
            throw new IllegalArgumentException("ttlMillis must be positive");
        }
        this.ttlMillis = ttlMillis;
    }

    public static String outrefKey(byte[] txHash, int outputIndex) {
        if (txHash == null) {
            throw new IllegalArgumentException("txHash null");
        }
        StringBuilder sb = new StringBuilder(txHash.length * 2 + 4);
        for (byte b : txHash) sb.append(String.format("%02x", b));
        sb.append("#").append(outputIndex);
        return sb.toString();
    }

    public static String outrefKey(WantedListingEventEntity row) {
        return outrefKey(row.getTxHash(), row.getOutputIndex());
    }

    /**
     * Reserve a single outref for {@code owner}. Returns {@code true} if the
     * outref was free (and is now reserved); {@code false} if another loop
     * had it. Callers MUST drop the candidate if this returns false.
     */
    public boolean tryReserve(String outrefKey, String owner) {
        pruneExpired();
        Reservation prior = inFlight.putIfAbsent(outrefKey, new Reservation(owner, System.currentTimeMillis()));
        if (prior == null) {
            log.debug("P2pInFlightTracker reserved {} for {}", outrefKey, owner);
            return true;
        }
        log.debug("P2pInFlightTracker: {} already in flight (owner={})", outrefKey, prior.owner());
        return false;
    }

    /**
     * Atomically reserve a set of outrefs for {@code owner}. All-or-nothing:
     * if ANY outref is already held, none are reserved and the method returns
     * {@code false}. Used by the matcher to grab both legs of a pair.
     */
    public boolean tryReserveAll(Collection<String> outrefKeys, String owner) {
        pruneExpired();
        // Best-effort 2-phase: first check, then putIfAbsent. Race is fine —
        // putIfAbsent will fail for any that became contended in between.
        Set<String> acquired = new HashSet<>();
        for (String k : outrefKeys) {
            if (inFlight.putIfAbsent(k, new Reservation(owner, System.currentTimeMillis())) == null) {
                acquired.add(k);
            } else {
                // Rollback: release everything we acquired in this call.
                for (String a : acquired) release(a, owner);
                log.debug("P2pInFlightTracker: tryReserveAll for {} aborted, contention on {}", owner, k);
                return false;
            }
        }
        return true;
    }

    /** Release a single outref. No-op if not reserved. */
    public void release(String outrefKey) {
        inFlight.remove(outrefKey);
    }

    /**
     * Release a single outref only when it is still owned by {@code owner}.
     * Coordinators use this for normal cleanup so a late failure path cannot
     * clear a newer reservation from the other loop.
     */
    public void release(String outrefKey, String owner) {
        Reservation current = inFlight.get(outrefKey);
        if (current != null && current.owner().equals(owner)) {
            inFlight.remove(outrefKey, current);
        }
    }

    /** Release several outrefs at once. */
    public void releaseAll(Collection<String> outrefKeys) {
        outrefKeys.forEach(this::release);
    }

    /** Release several outrefs only if still owned by {@code owner}. */
    public void releaseAll(Collection<String> outrefKeys, String owner) {
        outrefKeys.forEach(k -> release(k, owner));
    }

    /** True if the outref is currently reserved by EITHER loop. */
    public boolean isInFlight(String outrefKey) {
        pruneExpired();
        return inFlight.containsKey(outrefKey);
    }

    public int size() {
        pruneExpired();
        return inFlight.size();
    }

    /** Read-only snapshot. Useful for the controller's status. */
    public Set<String> snapshot() {
        pruneExpired();
        return Collections.unmodifiableSet(new HashSet<>(inFlight.keySet()));
    }

    /** Evict expired reservations and return how many were removed. */
    public int pruneExpired() {
        long now = System.currentTimeMillis();
        int before = inFlight.size();
        inFlight.entrySet().removeIf(e -> now - e.getValue().reservedAtMillis() > ttlMillis);
        int removed = before - inFlight.size();
        if (removed > 0) {
            log.warn("P2pInFlightTracker evicted {} stale reservation(s) older than {} ms",
                    removed, ttlMillis);
        }
        return removed;
    }

    void ageReservationForTest(String outrefKey, long reservedAtMillis) {
        inFlight.computeIfPresent(outrefKey,
                (k, v) -> new Reservation(v.owner(), reservedAtMillis));
    }

    private record Reservation(String owner, long reservedAtMillis) {}
}
