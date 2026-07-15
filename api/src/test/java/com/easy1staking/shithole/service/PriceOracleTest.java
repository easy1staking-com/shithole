package com.easy1staking.shithole.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Unit tests for {@link PriceOracle#estimate} — the token→ADA→USD conversion.
 * Exercises the default method against a fake oracle so we don't hit Minswap /
 * CoinGecko. (The DB-backed activity/stats aggregation is verified live.)
 */
class PriceOracleTest {

    // HOSKY (mainnet) + SNEK (mainnet) units — present in UNIT_TO_LABEL.
    private static final String HOSKY_POLICY = "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235";
    private static final String HOSKY_NAME = "484f534b59";
    private static final String SNEK_POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f";
    private static final String SNEK_NAME = "534e454b";

    /** Fake with fixed prices; USDM intentionally unpriced. */
    private static PriceOracle oracle(BigDecimal adaUsd) {
        return new PriceOracle() {
            @Override
            public Optional<BigDecimal> tokenAdaPrice(String label) {
                return switch (label) {
                    case "HOSKY" -> Optional.of(new BigDecimal("0.0000000423"));
                    case "SNEK" -> Optional.of(new BigDecimal("0.00196"));
                    default -> Optional.empty();
                };
            }

            @Override
            public Optional<BigDecimal> adaUsdPrice() {
                return Optional.ofNullable(adaUsd);
            }
        };
    }

    @Test
    void adaPricedIsAlreadyAda() {
        // 10 ADA = 10_000_000 lovelace, decimals 6, empty policy.
        var est = oracle(new BigDecimal("0.165")).estimate(BigInteger.valueOf(10_000_000L), "", "", 6);
        assertEquals(0, new BigDecimal("10").compareTo(est.adaEstimate()));
        assertEquals(0, new BigDecimal("1.65").compareTo(est.usdEstimate()));
    }

    @Test
    void hoskyPricedConvertsThroughAda() {
        // 500M HOSKY (decimals 0) * 0.0000000423 = 21.15 ADA; * 0.165 = 3.48975 USD.
        var est = oracle(new BigDecimal("0.165"))
                .estimate(BigInteger.valueOf(500_000_000L), HOSKY_POLICY, HOSKY_NAME, 0);
        assertEquals(0, new BigDecimal("21.15").compareTo(est.adaEstimate()));
        assertEquals(0, new BigDecimal("3.48975").compareTo(est.usdEstimate()));
    }

    @Test
    void snekPricedConverts() {
        // 1000 SNEK * 0.00196 = 1.96 ADA.
        var est = oracle(new BigDecimal("0.165"))
                .estimate(BigInteger.valueOf(1000L), SNEK_POLICY, SNEK_NAME, 0);
        assertEquals(0, new BigDecimal("1.96").compareTo(est.adaEstimate()));
    }

    @Test
    void unknownTokenHasNoEstimate() {
        var est = oracle(new BigDecimal("0.165"))
                .estimate(BigInteger.valueOf(100L), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "00", 0);
        assertNull(est.adaEstimate());
        assertNull(est.usdEstimate());
    }

    @Test
    void knownTokenButNoDexPriceHasNoEstimate() {
        // USDM is in UNIT_TO_LABEL but the fake oracle returns empty for it.
        String usdm = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";
        var est = oracle(new BigDecimal("0.165")).estimate(BigInteger.valueOf(5L), usdm, "0014df105553444d", 6);
        assertNull(est.adaEstimate());
        assertNull(est.usdEstimate());
    }

    @Test
    void adaEstimateWithoutFxHasNullUsd() {
        var est = oracle(null).estimate(BigInteger.valueOf(10_000_000L), "", "", 6);
        assertEquals(0, new BigDecimal("10").compareTo(est.adaEstimate()));
        assertNull(est.usdEstimate());
    }

    @Test
    void zeroOrNegativeQtyIsEmpty() {
        assertNull(oracle(new BigDecimal("0.165")).estimate(BigInteger.ZERO, "", "", 6).adaEstimate());
        assertNull(oracle(new BigDecimal("0.165")).estimate(null, "", "", 6).adaEstimate());
    }

    @Test
    void labelAndDecimalsResolution() {
        assertEquals("ADA", PriceOracle.labelFor("", ""));
        assertEquals("HOSKY", PriceOracle.labelFor(HOSKY_POLICY, HOSKY_NAME));
        assertEquals("SNEK", PriceOracle.labelFor(SNEK_POLICY, SNEK_NAME));
        assertNull(PriceOracle.labelFor("deadbeef", "00"));
        assertEquals(6, PriceOracle.decimalsFor("ADA"));
        assertEquals(6, PriceOracle.decimalsFor("USDM"));
        assertEquals(0, PriceOracle.decimalsFor("HOSKY"));
        assertEquals(0, PriceOracle.decimalsFor("SNEK"));
    }
}
