package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Utxo;
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

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link P2pAutoFulfillerDetector}.
 *
 * <p>Same testing strategy as {@code P2pMatcherDetectorTest}: the merkle
 * service is REAL (load-bearing on-chain compatibility), the listing repo +
 * config repo are mocked, and the wallet inventory is hand-built via
 * {@link BotWalletInventory#from}.
 *
 * <p>Coverage:
 * <ul>
 *   <li>returns only listings the wallet inventory can fulfill (cross-checked
 *       against an unmatched listing in the fixture)</li>
 *   <li>respects the {@code maxPerBlock} cap</li>
 *   <li>skips listings already reserved in the shared
 *       {@link P2pInFlightTracker}</li>
 *   <li>ranks candidates by estimated net descending</li>
 *   <li>captures the correct deposit asset_name + UTxO from the inventory</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class P2pAutoFulfillerDetectorTest {

    private static final byte[] COLLECTION_POLICY = bytes28((byte) 0xCC);
    private static final byte[] CONFIG_POLICY = bytes28((byte) 0xAB);
    private static final String COLLECTION_POLICY_HEX =
            HexUtil.encodeHexString(COLLECTION_POLICY).toLowerCase(Locale.ROOT);

    private static final byte[] NAME_A = nameOf((byte) 0x01);
    private static final byte[] NAME_B = nameOf((byte) 0x02);
    private static final byte[] NAME_C = nameOf((byte) 0x03);
    private static final byte[] NAME_D = nameOf((byte) 0x04);
    private static final byte[] NAME_E = nameOf((byte) 0x05);

    @Mock private WantedListingEventRepository wantedRepo;
    @Mock private ConfigRepository configRepo;
    @Mock private PoolMerkleRootRepository poolRepo;
    @Mock private BotWalletInventoryReader walletReader;

    private PoolMerkleService poolMerkleService;
    private P2pInFlightTracker inFlightTracker;
    private P2pAutoFulfillerDetector detector;

    @BeforeEach
    void setUp() {
        poolMerkleService = new PoolMerkleService(poolRepo);
        inFlightTracker = new P2pInFlightTracker();
        detector = new P2pAutoFulfillerDetector(
                wantedRepo, configRepo, poolMerkleService, walletReader, inFlightTracker);
        // default cap; individual tests override
        ReflectionTestUtils.setField(detector, "maxPerBlock", 3);
    }

    /* ===================================================================== */
    /* matchable filter                                                       */
    /* ===================================================================== */

    @Test
    void returnsOnlyListingsTheWalletCanFulfill() {
        // Wallet holds NAME_A + NAME_B; we'll have:
        //   L1 (accepts NAME_A)  → matchable (deposit NAME_A)
        //   L2 (accepts NAME_B)  → matchable (deposit NAME_B)
        //   L3 (accepts NAME_C)  → NOT matchable (wallet doesn't hold NAME_C)
        //   L4 (accepts NAME_D)  → NOT matchable
        //   L5 (accepts NAME_E)  → NOT matchable
        byte[] root1 = poolMerkleService.computeRoot(List.of(NAME_A));
        byte[] root2 = poolMerkleService.computeRoot(List.of(NAME_B));
        byte[] root3 = poolMerkleService.computeRoot(List.of(NAME_C));
        byte[] root4 = poolMerkleService.computeRoot(List.of(NAME_D));
        byte[] root5 = poolMerkleService.computeRoot(List.of(NAME_E));
        poolMerkleService.cacheTree(root1, List.of(NAME_A));
        poolMerkleService.cacheTree(root2, List.of(NAME_B));
        poolMerkleService.cacheTree(root3, List.of(NAME_C));
        poolMerkleService.cacheTree(root4, List.of(NAME_D));
        poolMerkleService.cacheTree(root5, List.of(NAME_E));

        WantedListingEventEntity l1 = listing(NAME_C, root1, 10_000_000L, (byte) 0x11);
        WantedListingEventEntity l2 = listing(NAME_D, root2, 12_000_000L, (byte) 0x22);
        WantedListingEventEntity l3 = listing(NAME_A, root3, 8_000_000L,  (byte) 0x33);
        WantedListingEventEntity l4 = listing(NAME_B, root4, 9_000_000L,  (byte) 0x44);
        WantedListingEventEntity l5 = listing(NAME_E, root5, 7_000_000L,  (byte) 0x55);

        stubActive(l1, l2, l3, l4, l5);
        stubConfig(0L);

        BotWalletInventory inventory = walletWith(NAME_A, NAME_B);
        when(walletReader.read()).thenReturn(inventory);

        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(2);
        assertThat(result).extracting(FulfillCandidate::listing)
                .containsExactlyInAnyOrder(l1, l2);
        // Deposit asset_name is the one matched in the wallet, not the offered NFT.
        for (FulfillCandidate c : result) {
            if (c.listing() == l1) {
                assertThat(c.depositAssetName()).isEqualTo(NAME_A);
            } else if (c.listing() == l2) {
                assertThat(c.depositAssetName()).isEqualTo(NAME_B);
            }
        }
    }

    /* ===================================================================== */
    /* max-per-block cap                                                      */
    /* ===================================================================== */

    @Test
    void capsResultsAtMaxPerBlock() {
        // 10 listings all matchable to NAME_A; max-per-block=3 → expect 3.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        List<WantedListingEventEntity> listings = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            // distinct outrefs, varying bounties so the cap is order-deterministic
            byte tag = (byte) (0xA0 + i);
            listings.add(listing(NAME_C, rootA, 1_000_000L * (10 - i) + 10_000_000L, tag));
        }
        when(wantedRepo.findAllActive(any(Pageable.class))).thenReturn(listings);
        stubConfig(0L);

        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        ReflectionTestUtils.setField(detector, "maxPerBlock", 3);
        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(3);
        // top-3 by net (= bounty − constants). Since fee=0 and buyer/tx constants are
        // collection-independent, ordering follows bounty descending.
        long net0 = result.get(0).estimatedNetLovelace();
        long net1 = result.get(1).estimatedNetLovelace();
        long net2 = result.get(2).estimatedNetLovelace();
        assertThat(net0).isGreaterThanOrEqualTo(net1);
        assertThat(net1).isGreaterThanOrEqualTo(net2);
    }

    /* ===================================================================== */
    /* in-flight skip                                                         */
    /* ===================================================================== */

    @Test
    void skipsListingsAlreadyInFlight() {
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        WantedListingEventEntity l1 = listing(NAME_C, rootA, 10_000_000L, (byte) 0x11);
        WantedListingEventEntity l2 = listing(NAME_D, rootA, 12_000_000L, (byte) 0x22);

        stubActive(l1, l2);
        stubConfig(0L);
        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        // Reserve l1 — pretend the matcher grabbed it earlier in this block.
        inFlightTracker.tryReserve(P2pInFlightTracker.outrefKey(l1), "matcher");

        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(1);
        assertThat(result.get(0).listing()).isEqualTo(l2);
    }

    /* ===================================================================== */
    /* ranking                                                                */
    /* ===================================================================== */

    @Test
    void ranksByEstimatedNetDescending() {
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        byte[] rootB = poolMerkleService.computeRoot(List.of(NAME_B));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));
        poolMerkleService.cacheTree(rootB, List.of(NAME_B));

        WantedListingEventEntity small = listing(NAME_C, rootA, 5_000_000L,  (byte) 0x11);
        WantedListingEventEntity big   = listing(NAME_D, rootB, 50_000_000L, (byte) 0x22);
        stubActive(small, big);
        stubConfig(0L);
        when(walletReader.read()).thenReturn(walletWith(NAME_A, NAME_B));

        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(2);
        assertThat(result.get(0).listing()).isEqualTo(big);
        assertThat(result.get(1).listing()).isEqualTo(small);
    }

    /* ===================================================================== */
    /* empty inventory short-circuits                                         */
    /* ===================================================================== */

    @Test
    void emptyInventoryReturnsEmpty() {
        when(walletReader.read()).thenReturn(BotWalletInventory.empty());
        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).isEmpty();
    }

    /* ===================================================================== */
    /* protocol fee in net estimate                                           */
    /* ===================================================================== */

    @Test
    void subtractsTreasuryOutputWhenProtocolFeeNonZero() {
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        long protocolFee = 2_000_000L;
        WantedListingEventEntity l = listing(NAME_C, rootA, 20_000_000L, (byte) 0x11);
        stubActive(l);
        stubConfig(protocolFee);
        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(1);
        long treasuryPer = Math.max(protocolFee,
                com.easy1staking.shithole.matcher.P2pMatcherDetector.TREASURY_OUTPUT_MIN_UTXO_LOVELACE);
        long expectedNet = 20_000_000L
                - com.easy1staking.shithole.matcher.P2pMatcherDetector.BUYER_OUTPUT_MIN_UTXO_LOVELACE
                - treasuryPer
                - P2pAutoFulfillerDetector.TX_FEE_ESTIMATE_LOVELACE;
        assertThat(result.get(0).estimatedNetLovelace()).isEqualTo(expectedNet);
    }

    @Test
    void acceptsAtContractFloorByDefault() {
        // Listing at the on-chain floor (bounty = protocol_fee + 2 ADA).
        // Conservative estimateNet is negative, but strict-profit-check
        // is OFF by default — only the contract floor gates submission.
        // The validator's W2 invariant guarantees the tx will balance.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        long protocolFee = 1_000_000L;
        WantedListingEventEntity l = listing(NAME_C, rootA, 3_000_000L, (byte) 0x66);
        stubActive(l);
        stubConfig(protocolFee);
        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        List<FulfillCandidate> result = detector.scanForFulfillable();
        assertThat(result).hasSize(1);
        // Sanity-check: estimateNet IS negative here — just used for
        // ranking, no longer for skipping.
        assertThat(P2pAutoFulfillerDetector.estimateNet(l, protocolFee)).isNegative();
    }

    @Test
    void skipsBelowContractFloor() {
        // 2.5 ADA bounty with protocol_fee=1 ADA → floor is 3 ADA.
        // Below the floor → on-chain W2 would reject → skip pre-emptively.
        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        long protocolFee = 1_000_000L;
        WantedListingEventEntity l = listing(NAME_C, rootA, 2_500_000L, (byte) 0x67);
        stubActive(l);
        stubConfig(protocolFee);
        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        assertThat(detector.scanForFulfillable()).isEmpty();
    }

    @Test
    void strictMode_skipsNonPositiveEstimatedNet() {
        // Same floor-scenario as acceptsAtContractFloorByDefault, but
        // with strict-profit-check enabled — the conservative arithmetic
        // kicks in and skips because est_net is negative.
        ReflectionTestUtils.setField(detector, "strictProfitCheck", true);

        byte[] rootA = poolMerkleService.computeRoot(List.of(NAME_A));
        poolMerkleService.cacheTree(rootA, List.of(NAME_A));

        long protocolFee = 1_000_000L;
        WantedListingEventEntity l = listing(NAME_C, rootA, 3_000_000L, (byte) 0x68);
        stubActive(l);
        stubConfig(protocolFee);
        when(walletReader.read()).thenReturn(walletWith(NAME_A));

        assertThat(detector.scanForFulfillable()).isEmpty();
    }

    /* ===================================================================== */
    /* fixture helpers                                                        */
    /* ===================================================================== */

    private void stubActive(WantedListingEventEntity... listings) {
        lenient().when(wantedRepo.findAllActive(any(Pageable.class)))
                .thenReturn(List.of(listings));
    }

    private void stubConfig(long protocolFee) {
        String hex = HexUtil.encodeHexString(CONFIG_POLICY).toLowerCase(Locale.ROOT);
        ConfigEntity cfg = ConfigEntity.builder()
                .configNftPolicy(hex)
                .protocolFee(protocolFee)
                .build();
        lenient().when(configRepo.findById(hex)).thenReturn(Optional.of(cfg));
    }

    private static WantedListingEventEntity listing(
            byte[] offeredAssetName,
            byte[] acceptedMerkleRoot,
            long lovelace,
            byte txByte) {
        byte[] unit = new byte[COLLECTION_POLICY.length + offeredAssetName.length];
        System.arraycopy(COLLECTION_POLICY, 0, unit, 0, COLLECTION_POLICY.length);
        System.arraycopy(offeredAssetName, 0, unit, COLLECTION_POLICY.length, offeredAssetName.length);

        byte[] txHash = new byte[32];
        java.util.Arrays.fill(txHash, txByte);

        return WantedListingEventEntity.builder()
                .txHash(txHash)
                .outputIndex(0)
                .configNftPolicy(CONFIG_POLICY)
                .buyerPkh(bytes28((byte) 0x77))
                .buyerAddressBech32("addr_test1_buyer_" + (txByte & 0xff))
                .acceptedMerkleRoot(acceptedMerkleRoot)
                .offeredNftUnit(unit)
                .lovelace(lovelace)
                .createdAtSlot(1L)
                .createdAt(OffsetDateTime.now())
                .build();
    }

    /**
     * Build a wallet inventory snapshot from a list of asset_names, each
     * carried in its own UTxO. Min UTxO floor is added so the totals look
     * realistic.
     */
    private static BotWalletInventory walletWith(byte[]... assetNames) {
        List<Utxo> utxos = new ArrayList<>();
        for (int i = 0; i < assetNames.length; i++) {
            byte[] name = assetNames[i];
            String unit = COLLECTION_POLICY_HEX + HexUtil.encodeHexString(name).toLowerCase(Locale.ROOT);
            Utxo u = Utxo.builder()
                    .txHash("aa".repeat(32))
                    .outputIndex(i)
                    .address("addr_test1_botwallet")
                    .amount(List.of(
                            Amount.builder().unit("lovelace").quantity(BigInteger.valueOf(2_000_000L)).build(),
                            Amount.builder().unit(unit).quantity(BigInteger.ONE).build()))
                    .build();
            utxos.add(u);
        }
        return BotWalletInventory.from(utxos);
    }

    private static byte[] nameOf(byte tag) {
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
