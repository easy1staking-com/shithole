package com.easy1staking.shithole.matcher;

import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.p2p.PoolMerkleService;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.WantedListingEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Scans the active wanted-listing set for 2-cycle pairs that are
 * simultaneously fulfillable in a single tx. Mirrors v2's read-pattern:
 * the repository is the source of truth, no separate caching layer.
 *
 * <p>Algorithm (see {@code docs/P2P_MATCHER.md} §pair-detection):
 * <ol>
 *   <li>Page the active wanted-listings (cap at a defensive ceiling).</li>
 *   <li>Group by {@code configNftPolicy} — v1 only matches within a
 *       collection.</li>
 *   <li>Within each group, compute O(n^2) pair-walks but with cheap
 *       {@link PoolMerkleService#isMember} short-circuit (no proof
 *       materialisation in the negative branch). At v1's expected scale
 *       (≤ hundreds of active listings per collection), this is sub-ms.</li>
 *   <li>Sort by estimated net descending, return.</li>
 * </ol>
 *
 * <p>Estimated net uses constants for the four output min-utxo floors +
 * a static {@code TX_FEE_ESTIMATE_LOVELACE} for the on-chain fee. The
 * absolute number is approximate; the *order* between pairs is what
 * matters and that order is preserved by any monotonic transform.
 */
@Component
@ConditionalOnProperty(name = "shithole.p2p.matcher.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pMatcherDetector {

    /** Defensive cap — pulling more than this is a sign something's off. */
    public static final int MAX_ACTIVE_LISTINGS_TO_CONSIDER = 1_000;

    /** Per-buyer-output min-utxo (NFT + small inline datum). ~1.3-1.5 ADA in practice. */
    public static final long BUYER_OUTPUT_MIN_UTXO_LOVELACE = 1_500_000L;

    /** Per-treasury-output min-utxo + protocol fee. Floor used when fee=0. */
    public static final long TREASURY_OUTPUT_MIN_UTXO_LOVELACE = 1_500_000L;

    /** Coarse tx-fee estimate for a 2-Fulfill tx (4 outputs + 2 scripts).
     *  Real fee is determined post-balance; this is only for pair ranking. */
    public static final long TX_FEE_ESTIMATE_LOVELACE = 1_500_000L;

    /** Fail closed: never submit an estimated break-even or loss-making pair. */
    public static final long MIN_ESTIMATED_NET_LOVELACE = 1L;

    /**
     * Hardcoded floor enforced on-chain by {@code wanted_listing.ak} W2:
     * {@code listing.lovelace >= cfg.protocol_fee + min_seller_compensation}
     * where {@code min_seller_compensation = 2_000_000} (2 ADA). Anything
     * below this floor would be rejected by the validator at fulfill time,
     * so the bot must filter it out before spending the tx fee learning
     * that the hard way.
     *
     * <p>This is the ONLY mandatory gate: above this floor, the contract
     * itself guarantees the swap math closes. The conservative
     * {@code estimateNet > 0} check is now optional, gated by
     * {@code shithole.p2p.bot.strict-profit-check}.
     */
    public static final long MIN_SELLER_COMPENSATION_LOVELACE = 2_000_000L;

    private final WantedListingEventRepository wantedListingRepo;
    private final ConfigRepository configRepo;
    private final PoolMerkleService poolMerkleService;

    /**
     * When true, additionally require {@code estimateNet > 0} using the
     * bot's CONSERVATIVE constants (1.5 ADA pads on every output, 1.5
     * ADA tx-fee estimate). Useful if you want to leave headroom on a
     * volatile mainnet. When false (default), only the on-chain
     * contract floor ({@link #MIN_SELLER_COMPENSATION_LOVELACE}) gates
     * submission; the contract math guarantees the tx balances above
     * that floor.
     */
    @Value("${shithole.p2p.bot.strict-profit-check:false}")
    private boolean strictProfitCheck;

    /**
     * Scan the active listings, return all viable pairs sorted by
     * estimated net descending.
     *
     * <p>Read-only — no DB writes, no side effects.
     */
    public List<MatchedPair> scanForPairs() {
        // Page once with a generous size; if the active set ever exceeds
        // MAX_ACTIVE_LISTINGS_TO_CONSIDER we should re-evaluate the
        // O(n^2) shape, not paginate (paginating gives WRONG answers —
        // a pair could span pages).
        List<WantedListingEventEntity> all = wantedListingRepo.findAllActive(
                PageRequest.of(0, MAX_ACTIVE_LISTINGS_TO_CONSIDER));
        if (all.isEmpty()) return List.of();
        if (all.size() >= MAX_ACTIVE_LISTINGS_TO_CONSIDER) {
            log.warn("P2pMatcherDetector: hit MAX_ACTIVE_LISTINGS_TO_CONSIDER={}; pairs beyond this won't be considered",
                    MAX_ACTIVE_LISTINGS_TO_CONSIDER);
        }

        // Group by config_nft_policy (same-collection match constraint).
        // Use LinkedHashMap so iteration order is deterministic for tests.
        Map<String, List<WantedListingEventEntity>> byCollection = new LinkedHashMap<>();
        for (WantedListingEventEntity row : all) {
            String key = hex(row.getConfigNftPolicy());
            byCollection.computeIfAbsent(key, k -> new ArrayList<>()).add(row);
        }

        // Per-collection protocol_fee for the estimate. Look up once.
        Map<String, Long> protocolFeeByCollection = new HashMap<>();
        List<MatchedPair> pairs = new ArrayList<>();

        for (Map.Entry<String, List<WantedListingEventEntity>> entry : byCollection.entrySet()) {
            String collectionKey = entry.getKey();
            List<WantedListingEventEntity> group = entry.getValue();
            if (group.size() < 2) continue;

            long protocolFee = protocolFeeByCollection.computeIfAbsent(
                    collectionKey,
                    k -> configRepo.findById(k.toLowerCase(Locale.ROOT))
                            .map(ConfigEntity::getProtocolFee)
                            .orElse(0L));

            for (int i = 0; i < group.size(); i++) {
                WantedListingEventEntity li = group.get(i);
                byte[] assetNameI = assetNameOf(li);
                if (assetNameI == null) continue;
                for (int j = i + 1; j < group.size(); j++) {
                    WantedListingEventEntity lj = group.get(j);
                    byte[] assetNameJ = assetNameOf(lj);
                    if (assetNameJ == null) continue;

                    // Self-match guard: a listing can't pair with itself
                    // (the PK check protects against this, but be defensive
                    // — a duplicate row with the same outref would slip
                    // through the loop here).
                    if (Arrays.equals(li.getTxHash(), lj.getTxHash())
                            && li.getOutputIndex().equals(lj.getOutputIndex())) {
                        continue;
                    }

                    // Both-direction membership check via the cheap predicate
                    // (no proof materialisation). The hot path short-circuits
                    // on the first false.
                    boolean matchable = poolMerkleService.isMatchableBoth(
                            li.getAcceptedMerkleRoot(), assetNameJ,
                            lj.getAcceptedMerkleRoot(), assetNameI);
                    if (!matchable) continue;

                    // CONTRACT-LEVEL gate (always enforced): each leg's
                    // bounty must cover protocol_fee + min_seller_compensation,
                    // matching wanted_listing.ak W2. Anything below would be
                    // rejected by the validator at fulfill time — skip pre-
                    // emptively rather than burning tx fees learning that.
                    long contractFloor = protocolFee + MIN_SELLER_COMPENSATION_LOVELACE;
                    long boundI = nullSafeLong(li.getLovelace());
                    long boundJ = nullSafeLong(lj.getLovelace());
                    if (boundI < contractFloor || boundJ < contractFloor) {
                        log.debug("P2pMatcherDetector: skipping pair {}#{} + {}#{} — below contract floor (need {}, got {} + {})",
                                hex(li.getTxHash()), li.getOutputIndex(),
                                hex(lj.getTxHash()), lj.getOutputIndex(),
                                contractFloor, boundI, boundJ);
                        continue;
                    }

                    long net = estimateNet(li, lj, protocolFee);
                    // OPTIONAL conservative gate: skip if our padded estimate
                    // says we'd lose money. Default off — the contract floor
                    // above is the real invariant. Enable via
                    // shithole.p2p.bot.strict-profit-check=true if you want
                    // extra headroom against fee volatility.
                    if (strictProfitCheck && net < MIN_ESTIMATED_NET_LOVELACE) {
                        log.debug("P2pMatcherDetector: skipping pair {}#{} + {}#{} — strict mode, est_net={}",
                                hex(li.getTxHash()), li.getOutputIndex(),
                                hex(lj.getTxHash()), lj.getOutputIndex(), net);
                        continue;
                    }
                    pairs.add(new MatchedPair(li, lj, net));
                }
            }
        }

        pairs.sort(Comparator.comparingLong(MatchedPair::estimatedNetLovelace).reversed());
        if (!pairs.isEmpty()) {
            log.info("P2pMatcherDetector: found {} candidate pair(s); top net={} lovelace",
                    pairs.size(), pairs.get(0).estimatedNetLovelace());
        }
        return pairs;
    }

    /**
     * Estimated net lovelace = sum of bounties − sum of treasury outputs
     * − two buyer-output min-utxos − tx fee estimate. Per the brief: no
     * profit floor; the bot will submit anything that balances. This
     * estimate's job is just RANKING, not deciding whether to submit.
     */
    static long estimateNet(
            WantedListingEventEntity a,
            WantedListingEventEntity b,
            long protocolFeeLovelace) {
        long bounties = nullSafeLong(a.getLovelace()) + nullSafeLong(b.getLovelace());
        long buyerOuts = 2L * BUYER_OUTPUT_MIN_UTXO_LOVELACE;
        long treasuryOuts = protocolFeeLovelace > 0
                // Each treasury output carries `protocol_fee` lovelace,
                // floored at the min-utxo (whichever is greater).
                ? 2L * Math.max(protocolFeeLovelace, TREASURY_OUTPUT_MIN_UTXO_LOVELACE)
                : 0L;
        return bounties - buyerOuts - treasuryOuts - TX_FEE_ESTIMATE_LOVELACE;
    }

    /**
     * Extract the asset_name portion of an {@code offered_nft_unit}
     * column (policy_id || asset_name). Returns null if the bytes are
     * malformed (shorter than a policy id).
     */
    static byte[] assetNameOf(WantedListingEventEntity row) {
        byte[] unit = row.getOfferedNftUnit();
        if (unit == null || unit.length < 28) return null;
        return Arrays.copyOfRange(unit, 28, unit.length);
    }

    private static long nullSafeLong(Long v) {
        return v == null ? 0L : v;
    }

    private static String hex(byte[] b) {
        if (b == null) return "";
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
