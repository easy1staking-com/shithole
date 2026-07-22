package com.easy1staking.shithole.service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.MathContext;
import java.util.Map;
import java.util.Optional;

/**
 * Price oracle for the "≈ estimated" ADA/USD figures on the marketplace
 * activity feed + stats. Prices a token → ADA on a native DEX, then applies
 * one ADA → USD (never token → USD directly — that compounds two noisy legs).
 *
 * <p>Swappable behind this interface so tests inject a fake and the DEX/FX
 * sources can change without touching callers. Values are best-effort:
 * {@link #estimate} returns {@code null} legs when a source is unavailable
 * (e.g. a preprod-mimic token with no real DEX pool), and the UI renders the
 * native price regardless.
 */
public interface PriceOracle {

    /** ADA per one whole unit of {@code label} (HOSKY/SNEK/USDM). Empty if unknown. */
    Optional<BigDecimal> tokenAdaPrice(String label);

    /** USD per ADA. Empty if unknown. */
    Optional<BigDecimal> adaUsdPrice();

    /** {@code adaEstimate} / {@code usdEstimate} may each be null when unpriceable. */
    record PriceEstimate(BigDecimal adaEstimate, BigDecimal usdEstimate) {
        public static final PriceEstimate EMPTY = new PriceEstimate(null, null);
    }

    /** Resolve a (policy, name) price token to its display label; {@code null} if unknown. */
    static String labelFor(String pricePolicyHex, String priceNameHex) {
        if (pricePolicyHex == null || pricePolicyHex.isBlank()) return "ADA";
        return UNIT_TO_LABEL.get((pricePolicyHex + (priceNameHex == null ? "" : priceNameHex)).toLowerCase());
    }

    /** Smallest-unit exponent for a token label. */
    static int decimalsFor(String label) {
        return ("ADA".equals(label) || "USDM".equals(label)) ? 6 : 0; // HOSKY/SNEK/unknown = 0
    }

    /** Mainnet asset units the oracle polls, keyed by label (used by the impl). */
    Map<String, String> LABEL_TO_MAINNET_UNIT = Map.of(
            "HOSKY", "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59",
            "SNEK", "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
            "USDM", "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d");

    /** Both networks' known price-token units → label. Lets us price preprod
     *  mimic listings off the real mainnet token price via the shared label. */
    Map<String, String> UNIT_TO_LABEL = Map.of(
            // HOSKY
            "4956a8205aeed1337e45b51679f7cdca1ea44d02c0e78d800acf2f1e484f534b59", "HOSKY",
            "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59", "HOSKY",
            // SNEK
            "51c13093b6572b7e4e7ed3e0f6451a82b9d3a5d8dea8b831a0a55424534e454b", "SNEK",
            "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b", "SNEK",
            // USDM
            "1ccce842d51112e37ca436f9cedf726507d159a0b0970b6d416634065553444d", "USDM",
            "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d", "USDM");

    /**
     * Convert a marketplace price ({@code nativeQty} in smallest units of the
     * given token) into ADA + USD estimates. ADA-priced listings (empty policy)
     * are already ADA. Shared default so tests exercise it against a fake oracle.
     */
    default PriceEstimate estimate(
            BigInteger nativeQty, String pricePolicyHex, String priceNameHex, int decimals) {
        if (nativeQty == null || nativeQty.signum() <= 0) return PriceEstimate.EMPTY;
        // qty in whole tokens (or whole ADA when it's lovelace).
        BigDecimal whole = new BigDecimal(nativeQty).movePointLeft(Math.max(0, decimals));

        BigDecimal ada;
        boolean isAda = pricePolicyHex == null || pricePolicyHex.isBlank();
        if (isAda) {
            ada = whole;
        } else {
            String unit = (pricePolicyHex + (priceNameHex == null ? "" : priceNameHex)).toLowerCase();
            String label = UNIT_TO_LABEL.get(unit);
            Optional<BigDecimal> perToken = label == null ? Optional.empty() : tokenAdaPrice(label);
            ada = perToken.map(p -> whole.multiply(p, MathContext.DECIMAL64)).orElse(null);
        }

        BigDecimal usd = null;
        if (ada != null) {
            usd = adaUsdPrice().map(f -> ada.multiply(f, MathContext.DECIMAL64)).orElse(null);
        }
        return new PriceEstimate(ada, usd);
    }
}
