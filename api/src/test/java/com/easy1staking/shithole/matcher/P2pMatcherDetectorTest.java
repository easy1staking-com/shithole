package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.p2p.PoolMerkleService;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import com.easy1staking.shithole.repository.WantedListingEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Tests for {@link P2pMatcherDetector}. The merkle service is REAL (no
 * mock) — same rationale as PoolMerkleServiceTest, since the on-chain
 * compatibility is the load-bearing invariant. Repos are mocked.
 *
 * <p>Fixture: 5 listings under one collection, plus 1 isolated listing
 * under a different collection. Exercise:
 * <ul>
 *   <li>matchable pairs are found (both directions in tree)</li>
 *   <li>one-directional matches are NOT returned</li>
 *   <li>cross-collection pairs are NEVER considered</li>
 *   <li>ordering is by estimated net descending</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class P2pMatcherDetectorTest {

    private static final HexFormat HEX = HexFormat.of();

    private static final byte[] COLLECTION_POLICY_1 = bytes28((byte) 0xCC);
    private static final byte[] COLLECTION_POLICY_2 = bytes28((byte) 0xDD);
    private static final byte[] CONFIG_POLICY_1 = bytes28((byte) 0xAB);
    private static final byte[] CONFIG_POLICY_2 = bytes28((byte) 0xCD);

    // Asset names (lex-ascending within each pair, library is order-sensitive).
    private static final byte[] NAME_A = nameOf((byte) 0x01);
    private static final byte[] NAME_B = nameOf((byte) 0x02);
    private static final byte[] NAME_C = nameOf((byte) 0x03);
    private static final byte[] NAME_D = nameOf((byte) 0x04);
    private static final byte[] NAME_E = nameOf((byte) 0x05);

    @Mock private WantedListingEventRepository wantedRepo;
    @Mock private ConfigRepository configRepo;
    @Mock private PoolMerkleRootRepository poolRepo;

    private PoolMerkleService poolMerkleService;
    private P2pMatcherDetector detector;

    @BeforeEach
    void setUp() {
        poolMerkleService = new PoolMerkleService(poolRepo);
        detector = new P2pMatcherDetector(wantedRepo, configRepo, poolMerkleService);
    }

    @Test
    void scanForPairs_findsBidirectionalMatch() {
        // Listing A offers NAME_A, accepts a root containing NAME_B.
        // Listing B offers NAME_B, accepts a root containing NAME_A.
        // → pair (A, B) is bidirectionally fulfillable.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 10_000_000L, (byte) 0x10);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 12_000_000L, (byte) 0x11);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, 0L);

        List<MatchedPair> pairs = detector.scanForPairs();

        assertThat(pairs).hasSize(1);
        MatchedPair pair = pairs.get(0);
        // Pair is (a, b) in some order; both sides present.
        assertThat(List.of(pair.a(), pair.b())).containsExactlyInAnyOrder(la, lb);
        // Net = 22 ADA bounty - 2 * 1.5 ADA buyer outs - 1.5 ADA tx fee estimate, fee=0.
        assertThat(pair.estimatedNetLovelace())
                .isEqualTo(10_000_000L + 12_000_000L
                        - 2L * P2pMatcherDetector.BUYER_OUTPUT_MIN_UTXO_LOVELACE
                        - P2pMatcherDetector.TX_FEE_ESTIMATE_LOVELACE);
    }

    @Test
    void scanForPairs_skipsOneDirectionalMatch() {
        // Listing A accepts NAME_B (offered by B), but B does NOT accept
        // NAME_A (B's root has only NAME_C). One-directional only.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_C));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_C));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 5_000_000L, (byte) 0x20);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 5_000_000L, (byte) 0x21);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, 0L);

        List<MatchedPair> pairs = detector.scanForPairs();

        assertThat(pairs).isEmpty();
    }

    @Test
    void scanForPairs_neverConsidersCrossCollection() {
        // Two listings that would form a bidirectional match… but they
        // live in different collections. V1 invariant: same collection only.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 5_000_000L, (byte) 0x30);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_2, COLLECTION_POLICY_2, 5_000_000L, (byte) 0x31);

        stubActive(la, lb);

        List<MatchedPair> pairs = detector.scanForPairs();
        assertThat(pairs).isEmpty();
    }

    @Test
    void scanForPairs_sortsByEstimatedNetDesc() {
        // Three listings under one collection:
        //   la offers A, accepts root_AB (contains B and D)
        //   lb offers B, accepts root_A (contains A) — pair (la, lb) matchable
        //   ld offers D, accepts root_A (contains A) — pair (la, ld) also matchable
        //   lb bounty=50 ADA, ld bounty=10 ADA → pair (la, lb) ranked first.
        byte[] rootAB = poolMerkleService.computeRoot(List.of(NAME_B, NAME_D));
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootAB, List.of(NAME_B, NAME_D));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootAB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 5_000_000L, (byte) 0x40);
        WantedListingEventEntity lb = listing(NAME_B, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 50_000_000L, (byte) 0x41);
        WantedListingEventEntity ld = listing(NAME_D, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 10_000_000L, (byte) 0x42);

        stubActive(la, lb, ld);
        stubConfig(CONFIG_POLICY_1, 0L);

        List<MatchedPair> pairs = detector.scanForPairs();

        assertThat(pairs).hasSize(2);
        assertThat(pairs.get(0).estimatedNetLovelace())
                .isGreaterThan(pairs.get(1).estimatedNetLovelace());
        // Top pair includes lb (the high-bounty one).
        assertThat(List.of(pairs.get(0).a(), pairs.get(0).b())).contains(lb);
    }

    @Test
    void scanForPairs_emptyWhenNoListings() {
        when(wantedRepo.findAllActive(any())).thenReturn(List.of());
        assertThat(detector.scanForPairs()).isEmpty();
    }

    @Test
    void scanForPairs_handlesProtocolFeeInNetEstimate() {
        // Same fixture as the basic bidirectional test, but with a non-zero
        // protocol_fee. Estimate must subtract 2 × treasury outputs.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        long protocolFee = 2_000_000L;
        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 10_000_000L, (byte) 0x50);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 12_000_000L, (byte) 0x51);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, protocolFee);

        List<MatchedPair> pairs = detector.scanForPairs();
        assertThat(pairs).hasSize(1);
        long treasuryPer = Math.max(protocolFee, P2pMatcherDetector.TREASURY_OUTPUT_MIN_UTXO_LOVELACE);
        long expectedNet = 10_000_000L + 12_000_000L
                - 2L * P2pMatcherDetector.BUYER_OUTPUT_MIN_UTXO_LOVELACE
                - 2L * treasuryPer
                - P2pMatcherDetector.TX_FEE_ESTIMATE_LOVELACE;
        assertThat(pairs.get(0).estimatedNetLovelace()).isEqualTo(expectedNet);
    }

    @Test
    void scanForPairs_acceptsAtContractFloorByDefault() {
        // Each leg at 2 ADA bounty with protocol_fee=0 → contract floor
        // is exactly 2 ADA (protocol_fee + min_seller_compensation).
        // Both listings sit AT the floor. The bot's conservative
        // estimateNet would be negative here, but strict-profit-check
        // is OFF by default — only the contract floor gates submission.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 2_000_000L, (byte) 0x60);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 2_000_000L, (byte) 0x61);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, 0L);

        List<MatchedPair> pairs = detector.scanForPairs();
        assertThat(pairs).hasSize(1);
        // Conservative estimate is negative — that's fine, the contract
        // floor guarantees on-chain validation passes.
        assertThat(pairs.get(0).estimatedNetLovelace()).isNegative();
    }

    @Test
    void scanForPairs_skipsBelowContractFloor() {
        // Each leg at 1 ADA bounty with protocol_fee=0 → contract floor
        // is 2 ADA. Both listings are BELOW the floor; the on-chain W2
        // check would reject any Fulfill against them, so the bot must
        // skip pre-emptively.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 1_000_000L, (byte) 0x62);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 1_000_000L, (byte) 0x63);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, 0L);

        assertThat(detector.scanForPairs()).isEmpty();
    }

    @Test
    void scanForPairs_strictMode_skipsNonPositiveEstimatedNet() {
        // Reuse the floor-scenario from acceptsAtContractFloorByDefault
        // but flip strict-profit-check on. Should now skip — same
        // conservative arithmetic as before this refactor.
        ReflectionTestUtils.setField(detector, "strictProfitCheck", true);

        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_B));
        poolMerkleService.cacheTree(rootB, List.of(NAME_A));

        WantedListingEventEntity la = listing(NAME_A, rootA, CONFIG_POLICY_1, COLLECTION_POLICY_1, 2_000_000L, (byte) 0x64);
        WantedListingEventEntity lb = listing(NAME_B, rootB, CONFIG_POLICY_1, COLLECTION_POLICY_1, 2_000_000L, (byte) 0x65);

        stubActive(la, lb);
        stubConfig(CONFIG_POLICY_1, 0L);

        assertThat(detector.scanForPairs()).isEmpty();
    }

    /* ---- fixture helpers ---- */

    private void stubActive(WantedListingEventEntity... listings) {
        lenient().when(wantedRepo.findAllActive(any(Pageable.class)))
                .thenReturn(List.of(listings));
    }

    private void stubConfig(byte[] policy, long protocolFee) {
        String hex = HexUtil.encodeHexString(policy);
        ConfigEntity cfg = ConfigEntity.builder()
                .configNftPolicy(hex)
                .protocolFee(protocolFee)
                .build();
        lenient().when(configRepo.findById(hex)).thenReturn(Optional.of(cfg));
    }

    private static WantedListingEventEntity listing(
            byte[] offeredAssetName,
            byte[] acceptedMerkleRoot,
            byte[] configPolicy,
            byte[] collectionPolicy,
            long lovelace,
            byte txByte) {
        byte[] unit = new byte[collectionPolicy.length + offeredAssetName.length];
        System.arraycopy(collectionPolicy, 0, unit, 0, collectionPolicy.length);
        System.arraycopy(offeredAssetName, 0, unit, collectionPolicy.length, offeredAssetName.length);

        byte[] txHash = new byte[32];
        java.util.Arrays.fill(txHash, txByte);

        return WantedListingEventEntity.builder()
                .txHash(txHash)
                .outputIndex(0)
                .configNftPolicy(configPolicy)
                .buyerPkh(bytes28((byte) 0x77))
                .buyerAddressBech32("addr_test1_buyer_" + (txByte & 0xff))
                .acceptedMerkleRoot(acceptedMerkleRoot)
                .offeredNftUnit(unit)
                .lovelace(lovelace)
                .createdAtSlot(1L)
                .createdAt(OffsetDateTime.now())
                .build();
    }

    private static byte[] nameOf(byte tag) {
        // 28-byte deterministic asset_name.
        byte[] out = new byte[28];
        java.util.Arrays.fill(out, tag);
        return out;
    }

    private static byte[] bytes28(byte fill) {
        byte[] out = new byte[28];
        java.util.Arrays.fill(out, fill);
        return out;
    }
}
