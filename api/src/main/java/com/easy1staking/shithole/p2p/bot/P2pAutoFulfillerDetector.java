package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.model.Utxo;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.matcher.P2pMatcherDetector;
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
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Per-block scan for wanted-listings the bot can unilaterally fulfill using
 * NFTs it already holds in {@link com.easy1staking.shithole.matcher.MatcherHotWallet}.
 *
 * <p>Algorithm (see {@code api/docs/P2P_MATCHER.md} §Auto-fulfill loop):
 * <ol>
 *   <li>Snapshot the wallet's NFT holdings (delegated to
 *       {@link BotWalletInventoryReader}).</li>
 *   <li>Page the active wanted-listings (same {@link WantedListingEventRepository
 *       #findAllActive} the matcher uses).</li>
 *   <li>Skip listings whose outref is already in flight (in the shared
 *       {@link P2pInFlightTracker} — typically the matcher has reserved that
 *       leg this block).</li>
 *   <li>For each remaining listing, iterate the wallet's NFTs under the
 *       listing's collection policy. The FIRST asset_name that's a member of
 *       the listing's {@code acceptedMerkleRoot} (per
 *       {@link PoolMerkleService#isMember}) becomes the deposit.</li>
 *   <li>Compute an estimated-net for ranking (descending sort).</li>
 *   <li>Cap at {@code shithole.p2p.auto-fulfill.max-per-block}.</li>
 * </ol>
 *
 * <p>NFT-pick policy: "first hit wins" per user decision. We don't try to
 * minimize min-utxo cost or to pick the NFT that would yield the highest
 * resale (e.g. via trait-rarity heuristics). Simpler, fast enough, and the
 * received NFT goes back to the same hot wallet so it can be reused in a
 * future cycle anyway.
 */
@Component
@ConditionalOnProperty(name = "shithole.p2p.auto-fulfill.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pAutoFulfillerDetector {

    /** Defensive cap mirroring {@link P2pMatcherDetector#MAX_ACTIVE_LISTINGS_TO_CONSIDER}. */
    static final int MAX_ACTIVE_LISTINGS_TO_CONSIDER = 1_000;

    /** Single-Fulfill tx fee estimate (lighter than the matcher's 2-Fulfill case). */
    static final long TX_FEE_ESTIMATE_LOVELACE = 800_000L;

    /** Fail closed: never submit an estimated break-even or loss-making fulfill. */
    static final long MIN_ESTIMATED_NET_LOVELACE = 1L;

    private final WantedListingEventRepository wantedListingRepo;
    private final ConfigRepository configRepo;
    private final PoolMerkleService poolMerkleService;
    private final BotWalletInventoryReader walletReader;
    private final P2pInFlightTracker inFlightTracker;

    /**
     * Max candidates to return per scan. Cap so a busy block with many
     * matchable listings can't drain the bot's wallet in one go. Default 3.
     */
    @Value("${shithole.p2p.auto-fulfill.max-per-block:3}")
    private int maxPerBlock;

    /**
     * Mirror of {@link P2pMatcherDetector}'s strict-mode flag. Default
     * off: only the on-chain contract floor gates submission. When
     * true, additionally require {@code estimateNet > 0} under the
     * conservative pads.
     */
    @Value("${shithole.p2p.bot.strict-profit-check:false}")
    private boolean strictProfitCheck;

    /**
     * Read-only scan. Returns the top {@code maxPerBlock} fulfillable
     * candidates the bot can submit this block, ranked by estimated net
     * descending. The coordinator submits them one-at-a-time and registers
     * each in the shared {@link P2pInFlightTracker}.
     */
    public List<FulfillCandidate> scanForFulfillable() {
        BotWalletInventory inventory = walletReader.read();
        if (inventory.isEmpty()) {
            log.debug("P2pAutoFulfillerDetector: wallet inventory empty; nothing to fulfill");
            return List.of();
        }
        return scanWithInventory(inventory);
    }

    /**
     * Test-visible variant — pass a pre-built inventory so unit tests don't
     * have to stub a {@link BotWalletInventoryReader}. Production callers go
     * through {@link #scanForFulfillable()}.
     */
    public List<FulfillCandidate> scanWithInventory(BotWalletInventory inventory) {
        List<WantedListingEventEntity> active = wantedListingRepo.findAllActive(
                PageRequest.of(0, MAX_ACTIVE_LISTINGS_TO_CONSIDER));
        if (active.isEmpty()) return List.of();
        if (active.size() >= MAX_ACTIVE_LISTINGS_TO_CONSIDER) {
            log.warn("P2pAutoFulfillerDetector: hit MAX_ACTIVE_LISTINGS_TO_CONSIDER={}; "
                    + "candidates beyond this won't be considered",
                    MAX_ACTIVE_LISTINGS_TO_CONSIDER);
        }

        // Per-collection protocol_fee lookup memo (cuts repeat repo hits).
        Map<String, Long> protocolFeeByPolicy = new HashMap<>();
        List<FulfillCandidate> candidates = new ArrayList<>();

        for (WantedListingEventEntity listing : active) {
            String listingKey = P2pInFlightTracker.outrefKey(listing);
            if (inFlightTracker.isInFlight(listingKey)) {
                log.debug("P2pAutoFulfillerDetector: skipping {} — already in flight", listingKey);
                continue;
            }
            String collectionPolicyHex = collectionPolicyHex(listing);
            if (collectionPolicyHex == null) continue;

            Map<String, Utxo> walletNfts = inventory.forCollection(collectionPolicyHex);
            if (walletNfts.isEmpty()) continue;

            // First-hit pick: iterate the wallet's NFTs in iteration order and
            // pick the first asset_name that's a member of the listing's
            // accepted_merkle_root. PoolMerkleService.isMember short-circuits
            // on miss (no proof materialised in the false branch).
            String matchedAssetHex = null;
            byte[] matchedAssetBytes = null;
            for (String assetHex : walletNfts.keySet()) {
                byte[] assetBytes = hexBytes(assetHex);
                if (poolMerkleService.isMember(listing.getAcceptedMerkleRoot(), assetBytes)) {
                    matchedAssetHex = assetHex;
                    matchedAssetBytes = assetBytes;
                    break;
                }
            }
            if (matchedAssetHex == null) continue;

            String configKey = bytesHex(listing.getConfigNftPolicy());
            long protocolFee = protocolFeeByPolicy.computeIfAbsent(
                    configKey,
                    k -> configRepo.findById(k.toLowerCase(Locale.ROOT))
                            .map(ConfigEntity::getProtocolFee)
                            .orElse(0L));

            // CONTRACT-LEVEL gate (always enforced): the listing's
            // bounty must cover protocol_fee + min_seller_compensation,
            // matching wanted_listing.ak W2. Below the floor, the
            // validator would reject the tx — skip pre-emptively.
            long contractFloor = protocolFee + P2pMatcherDetector.MIN_SELLER_COMPENSATION_LOVELACE;
            long bounty = listing.getLovelace() == null ? 0L : listing.getLovelace();
            if (bounty < contractFloor) {
                log.debug("P2pAutoFulfillerDetector: skipping {} — below contract floor (need {}, got {})",
                        listingKey, contractFloor, bounty);
                continue;
            }

            long estimatedNet = estimateNet(listing, protocolFee);
            // OPTIONAL strict mode: skip when conservative pads say we'd
            // lose money. Default off; the contract floor above is the
            // real invariant.
            if (strictProfitCheck && estimatedNet < MIN_ESTIMATED_NET_LOVELACE) {
                log.debug("P2pAutoFulfillerDetector: skipping {} — strict mode, est_net={}",
                        listingKey, estimatedNet);
                continue;
            }
            candidates.add(new FulfillCandidate(
                    listing,
                    matchedAssetBytes,
                    walletNfts.get(matchedAssetHex),
                    estimatedNet));
        }

        candidates.sort((c1, c2) -> Long.compare(c2.estimatedNetLovelace(), c1.estimatedNetLovelace()));

        // Per-block cap so a fat block can't drain the wallet in one go.
        if (candidates.size() > maxPerBlock) {
            candidates = new ArrayList<>(candidates.subList(0, maxPerBlock));
        }
        if (!candidates.isEmpty()) {
            log.info("P2pAutoFulfillerDetector: found {} fulfillable candidate(s); top net={} lovelace",
                    candidates.size(), candidates.get(0).estimatedNetLovelace());
        }
        return candidates;
    }

    /**
     * Estimated net = bounty − (treasury output, if fee>0) − buyer_output
     * min-utxo − tx fee estimate.
     */
    static long estimateNet(WantedListingEventEntity listing, long protocolFeeLovelace) {
        long bounty = listing.getLovelace() == null ? 0L : listing.getLovelace();
        long buyerOut = P2pMatcherDetector.BUYER_OUTPUT_MIN_UTXO_LOVELACE;
        long treasuryOut = protocolFeeLovelace > 0
                ? Math.max(protocolFeeLovelace, P2pMatcherDetector.TREASURY_OUTPUT_MIN_UTXO_LOVELACE)
                : 0L;
        return bounty - buyerOut - treasuryOut - TX_FEE_ESTIMATE_LOVELACE;
    }

    private static String collectionPolicyHex(WantedListingEventEntity row) {
        byte[] unit = row.getOfferedNftUnit();
        if (unit == null || unit.length < 28) return null;
        return bytesHex(Arrays.copyOfRange(unit, 0, 28));
    }

    private static String bytesHex(byte[] b) {
        if (b == null) return "";
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static byte[] hexBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return out;
    }
}
