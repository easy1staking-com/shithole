package com.easy1staking.shithole.matcher;

import com.easy1staking.shithole.entity.WantedListingEventEntity;

/**
 * One detected 2-cycle pair of wanted-listings, along with the estimated
 * net lovelace the bot would pocket if this pair were submitted.
 *
 * <p>Invariants (enforced by {@link P2pMatcherDetector}):
 * <ul>
 *   <li>{@code a} and {@code b} share the same {@code configNftPolicy}
 *       (v1 same-collection constraint).</li>
 *   <li>{@code a.acceptedMerkleRoot} contains the asset name of
 *       {@code b.offered_nft_unit} as a leaf, AND vice versa.</li>
 *   <li>{@code a} and {@code b} are distinct UTxOs (PK
 *       (txHash, outputIndex) differs).</li>
 * </ul>
 *
 * <p>{@code estimatedNetLovelace} is a provisional number — exact net is
 * known only after CCL completes the balance pass — but it's good enough
 * to rank candidates by profitability for "most profitable first"
 * selection.
 */
public record MatchedPair(
        WantedListingEventEntity a,
        WantedListingEventEntity b,
        long estimatedNetLovelace) {

    /**
     * Stable identity for in-flight tracking and de-dup. Lexicographic
     * order over the two outrefs so {@code key(A,B) == key(B,A)} — the
     * matcher doesn't care which side is which.
     */
    public String key() {
        String ka = hex(a.getTxHash()) + "#" + a.getOutputIndex();
        String kb = hex(b.getTxHash()) + "#" + b.getOutputIndex();
        return ka.compareTo(kb) <= 0 ? ka + "+" + kb : kb + "+" + ka;
    }

    private static String hex(byte[] b) {
        if (b == null) return "";
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }
}
