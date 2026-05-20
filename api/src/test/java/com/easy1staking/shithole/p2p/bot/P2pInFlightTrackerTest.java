package com.easy1staking.shithole.p2p.bot;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class P2pInFlightTrackerTest {

    private P2pInFlightTracker tracker;

    @BeforeEach
    void setUp() {
        tracker = new P2pInFlightTracker();
    }

    @Test
    void reserveAndReleaseSingle() {
        String key = "abcd#0";
        assertThat(tracker.tryReserve(key, "matcher")).isTrue();
        assertThat(tracker.isInFlight(key)).isTrue();
        // Re-reserve fails — owned by someone.
        assertThat(tracker.tryReserve(key, "auto-fulfill")).isFalse();
        tracker.release(key);
        assertThat(tracker.isInFlight(key)).isFalse();
    }

    @Test
    void ownerScopedReleaseDoesNotClearDifferentOwner() {
        String key = "abcd#0";
        assertThat(tracker.tryReserve(key, "matcher")).isTrue();
        tracker.release(key, "auto-fulfill");
        assertThat(tracker.isInFlight(key)).isTrue();
        tracker.release(key, "matcher");
        assertThat(tracker.isInFlight(key)).isFalse();
    }

    @Test
    void reserveAllIsAtomic() {
        String k1 = "aaaa#0";
        String k2 = "bbbb#0";
        // Pre-reserve k2 by another owner.
        tracker.tryReserve(k2, "auto-fulfill");
        // Matcher tries to grab both — must fail entirely and NOT acquire k1.
        boolean acquired = tracker.tryReserveAll(List.of(k1, k2), "matcher");
        assertThat(acquired).isFalse();
        assertThat(tracker.isInFlight(k1)).isFalse();
        // k2 still owned by auto-fulfill.
        assertThat(tracker.isInFlight(k2)).isTrue();
    }

    @Test
    void reserveAllSucceedsWhenAllFree() {
        boolean acquired = tracker.tryReserveAll(List.of("aaaa#0", "bbbb#0"), "matcher");
        assertThat(acquired).isTrue();
        assertThat(tracker.size()).isEqualTo(2);
    }

    @Test
    void staleReservationsExpireOnAccess() {
        tracker = new P2pInFlightTracker(1_000L);
        String key = "cccc#0";
        assertThat(tracker.tryReserve(key, "auto-fulfill")).isTrue();
        tracker.ageReservationForTest(key, System.currentTimeMillis() - 2_000L);

        assertThat(tracker.isInFlight(key)).isFalse();
        assertThat(tracker.tryReserve(key, "matcher")).isTrue();
    }

    @Test
    void outrefKeyIsCanonical() {
        byte[] hash = new byte[32];
        java.util.Arrays.fill(hash, (byte) 0xab);
        String key = P2pInFlightTracker.outrefKey(hash, 7);
        assertThat(key).isEqualTo("ab".repeat(32) + "#7");
    }
}
