package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.util.HexUtil;
import com.bloxbean.cardano.yaci.store.common.domain.AddressUtxo;
import com.bloxbean.cardano.yaci.store.common.domain.Amt;
import com.bloxbean.cardano.yaci.store.common.domain.TxInput;
import com.bloxbean.cardano.yaci.store.events.EventMetadata;
import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import com.bloxbean.cardano.yaci.store.utxo.domain.TxInputOutput;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.entity.ListingEventEntity;
import com.easy1staking.shithole.entity.ListingEventId;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.repository.ListingEventRepository;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigInteger;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ListingEventsIndexer}. The indexer's dependencies are
 * mocked; the in-memory store is a {@code Map<ListingEventId,
 * ListingEventEntity>} populated by stubbed repository {@code save(...)} calls.
 */
@ExtendWith(MockitoExtension.class)
class ListingEventsIndexerTest {

    // 28-byte hex constants used across the tests.
    private static final String CONFIG_POLICY = "ab".repeat(28);
    private static final String COLLECTION_POLICY = "cd".repeat(28);
    private static final String WATCHED_ADDR = "addr_test1w_listing_script";
    private static final String OTHER_ADDR = "addr_test1q_random_wallet";
    private static final byte[] LISTER_PKH = bytes28((byte) 0x42);
    private static final byte[] OTHER_PKH = bytes28((byte) 0x99);

    @Mock private CuratedCollectionRepository curatedRepo;
    @Mock private ListingEventRepository listingRepo;
    @Mock private WantedListingScriptAddressDeriver wantedDeriver;

    private WatchAddressRegistry registry;
    private ListingDatumDecoder decoder;
    private ListingEventsIndexer indexer;
    private Map<ListingEventId, ListingEventEntity> store;

    @BeforeEach
    void setUp() {
        // Seed the watch registry with one curated collection.
        CuratedCollectionEntity cc = CuratedCollectionEntity.builder()
                .slug("hosky")
                .configNftPolicy(CONFIG_POLICY)
                .collectionPolicyId(COLLECTION_POLICY)
                .listingScriptAddress(WATCHED_ADDR)
                .build();
        when(curatedRepo.findAll()).thenReturn(List.of(cc));
        // Stub the v3 wanted-listing address deriver — not exercised by v2
        // indexer tests but the registry calls into it during reconcile().
        lenient().when(wantedDeriver.deriveAddress(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("addr_test1w_wanted_dummy");
        registry = new WatchAddressRegistry(curatedRepo, Networks.preprod(), wantedDeriver);
        registry.reconcile(); // load synchronously

        decoder = new ListingDatumDecoder();

        // Wire up an in-memory ListingEventRepository.
        store = new HashMap<>();
        lenient().when(listingRepo.findActiveByTxHashAndOutputIndex(any(), any()))
                .thenAnswer(inv -> {
                    byte[] hash = inv.getArgument(0);
                    Integer idx = inv.getArgument(1);
                    var row = store.get(new ListingEventId(hash, idx));
                    return row != null && row.getSpentAction() == null
                            ? Optional.of(row) : Optional.empty();
                });
        lenient().when(listingRepo.existsById(any())).thenAnswer(inv -> {
            ListingEventId id = inv.getArgument(0);
            return store.containsKey(id);
        });
        lenient().when(listingRepo.save(any())).thenAnswer(inv -> {
            ListingEventEntity row = inv.getArgument(0);
            store.put(new ListingEventId(row.getTxHash(), row.getOutputIndex()), row);
            return row;
        });

        indexer = new ListingEventsIndexer(registry, decoder, listingRepo);
    }

    // ------------------------------------------------------------------
    // genesis insert
    // ------------------------------------------------------------------

    @Test
    void genesisCreatesRowWithSwapIndexZeroAndNullUpdateRef() {
        String txHash = hex32((byte) 0x10);
        AddressUtxo out = newListingOutput(
                txHash, 0,
                WATCHED_ADDR,
                buildListingDatumHex(LISTER_PKH, null),
                "asset01",
                BigInteger.valueOf(2_000_000L));
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(out))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 100L));

        assertThat(store).hasSize(1);
        ListingEventEntity row = store.values().iterator().next();
        assertThat(row.getSwapIndex()).isZero();
        assertThat(row.getUpdateRefHash()).isNull();
        assertThat(row.getListerPkh()).containsExactly(LISTER_PKH);
        assertThat(row.getSpentAction()).isNull();
        assertThat(row.getInitialTxHash()).containsExactly(row.getTxHash());
        assertThat(row.getInitialOutputIndex()).isEqualTo(row.getOutputIndex());
        assertThat(row.getCreatedAtSlot()).isEqualTo(100L);
        assertThat(row.getLovelace()).isEqualTo(2_000_000L);
    }

    // ------------------------------------------------------------------
    // swap: spend + same-address create → update old, insert successor
    // ------------------------------------------------------------------

    @Test
    void swapMarksOldRowSpentAndInsertsSuccessor() {
        // 1. Seed a live genesis row.
        String prevTxHex = hex32((byte) 0x01);
        byte[] prevTxBytes = HexUtil.decodeHexString(prevTxHex);
        ListingEventEntity prev = ListingEventEntity.builder()
                .txHash(prevTxBytes)
                .outputIndex(0)
                .initialTxHash(prevTxBytes)
                .initialOutputIndex(0)
                .swapIndex(0)
                .configNftPolicy(HexUtil.decodeHexString(CONFIG_POLICY))
                .listerPkh(LISTER_PKH)
                .nftUnit(HexUtil.decodeHexString(COLLECTION_POLICY + hexAsset("asset01")))
                .lovelace(2_000_000L)
                .updateRefHash(null)
                .createdAtSlot(50L)
                .createdAt(java.time.OffsetDateTime.now())
                .build();
        store.put(new ListingEventId(prevTxBytes, 0), prev);

        // 2. Swap tx: consumes prev, emits new listing output with update_ref=Some(...)
        byte[] fakeUpdateRefHash = bytes28((byte) 0xaa);
        String swapTxHex = hex32((byte) 0x02);
        AddressUtxo newOut = newListingOutput(
                swapTxHex, 0,
                WATCHED_ADDR,
                buildListingDatumHex(LISTER_PKH, fakeUpdateRefHash),
                "asset02", // NB
                BigInteger.valueOf(3_000_000L));
        TxInput spending = TxInput.builder()
                .txHash(prevTxHex)
                .outputIndex(0)
                .build();
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(swapTxHex)
                .inputs(List.of(spending))
                .outputs(List.of(newOut))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 200L));

        // 3. Verify prev is marked spent='swap' and successor row was inserted.
        ListingEventEntity prevAfter = store.get(new ListingEventId(prevTxBytes, 0));
        assertThat(prevAfter.getSpentAction()).isEqualTo("swap");
        assertThat(prevAfter.getSpentAtSlot()).isEqualTo(200L);
        assertThat(prevAfter.getSpentByTxHash()).containsExactly(HexUtil.decodeHexString(swapTxHex));

        ListingEventEntity succ = store.get(new ListingEventId(HexUtil.decodeHexString(swapTxHex), 0));
        assertThat(succ).isNotNull();
        assertThat(succ.getSwapIndex()).isEqualTo(1);
        assertThat(succ.getInitialTxHash()).containsExactly(prevTxBytes);
        assertThat(succ.getInitialOutputIndex()).isZero();
        assertThat(succ.getUpdateRefHash()).containsExactly(fakeUpdateRefHash);
        assertThat(succ.getSpentAction()).isNull();
    }

    // ------------------------------------------------------------------
    // cancel/recover: spend with no co-tx create → update old only
    // ------------------------------------------------------------------

    @Test
    void cancelMarksOldRowSpentWithoutInsertingSuccessor() {
        String prevTxHex = hex32((byte) 0x03);
        byte[] prevTxBytes = HexUtil.decodeHexString(prevTxHex);
        ListingEventEntity prev = ListingEventEntity.builder()
                .txHash(prevTxBytes)
                .outputIndex(0)
                .initialTxHash(prevTxBytes)
                .initialOutputIndex(0)
                .swapIndex(0)
                .configNftPolicy(HexUtil.decodeHexString(CONFIG_POLICY))
                .listerPkh(LISTER_PKH)
                .nftUnit(HexUtil.decodeHexString(COLLECTION_POLICY + hexAsset("asset01")))
                .lovelace(2_000_000L)
                .createdAtSlot(50L)
                .createdAt(java.time.OffsetDateTime.now())
                .build();
        store.put(new ListingEventId(prevTxBytes, 0), prev);

        // Cancel tx: consumes prev; output goes to a wallet address, not the listing script.
        String cancelTxHex = hex32((byte) 0x04);
        TxInput spending = TxInput.builder()
                .txHash(prevTxHex)
                .outputIndex(0)
                .build();
        AddressUtxo walletOut = AddressUtxo.builder()
                .txHash(cancelTxHex)
                .outputIndex(0)
                .ownerAddr(OTHER_ADDR)
                .lovelaceAmount(BigInteger.valueOf(2_000_000L))
                .build();
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(cancelTxHex)
                .inputs(List.of(spending))
                .outputs(List.of(walletOut))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 300L));

        ListingEventEntity prevAfter = store.get(new ListingEventId(prevTxBytes, 0));
        assertThat(prevAfter.getSpentAction()).isEqualTo(ListingEventsIndexer.SPENT_UNKNOWN);
        assertThat(prevAfter.getSpentAction().length()).isLessThanOrEqualTo(16);
        assertThat(prevAfter.getSpentAtSlot()).isEqualTo(300L);
        assertThat(store).hasSize(1); // only the prev row remains
    }

    // ------------------------------------------------------------------
    // junk output (no valid datum) → no row inserted
    // ------------------------------------------------------------------

    @Test
    void junkOutputAtWatchedAddressDoesNotInsertRow() {
        String txHash = hex32((byte) 0x05);
        // Output at watched address but with NO inline datum at all.
        AddressUtxo junk = AddressUtxo.builder()
                .txHash(txHash)
                .outputIndex(0)
                .ownerAddr(WATCHED_ADDR)
                .lovelaceAmount(BigInteger.valueOf(2_000_000L))
                .amounts(List.of(amt(COLLECTION_POLICY, hexAsset("asset01"), 1)))
                .inlineDatum(null)
                .build();
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(junk))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 400L));

        assertThat(store).isEmpty();
        verify(listingRepo, never()).save(any());
    }

    @Test
    void corruptDatumAtWatchedAddressDoesNotInsertRow() {
        String txHash = hex32((byte) 0x06);
        AddressUtxo junk = AddressUtxo.builder()
                .txHash(txHash)
                .outputIndex(0)
                .ownerAddr(WATCHED_ADDR)
                .lovelaceAmount(BigInteger.valueOf(2_000_000L))
                .amounts(List.of(amt(COLLECTION_POLICY, hexAsset("asset01"), 1)))
                .inlineDatum("00aabbcc") // not valid CBOR-Plutus
                .build();
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(junk))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 410L));

        assertThat(store).isEmpty();
    }

    // ------------------------------------------------------------------
    // output at unwatched address → ignored
    // ------------------------------------------------------------------

    @Test
    void outputAtUnwatchedAddressIsIgnored() {
        String txHash = hex32((byte) 0x07);
        AddressUtxo elsewhere = newListingOutput(
                txHash, 0,
                OTHER_ADDR, // unwatched
                buildListingDatumHex(LISTER_PKH, null),
                "asset01",
                BigInteger.valueOf(2_000_000L));
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(elsewhere))
                .build();

        indexer.onAddressUtxoEvent(eventFor(tx, 500L));

        assertThat(store).isEmpty();
        verify(listingRepo, never()).save(any());
    }

    // ------------------------------------------------------------------
    // idempotency: duplicate event re-processing
    // ------------------------------------------------------------------

    @Test
    void duplicateEventDoesNotDoubleInsertGenesis() {
        String txHash = hex32((byte) 0x08);
        AddressUtxo out = newListingOutput(
                txHash, 0,
                WATCHED_ADDR,
                buildListingDatumHex(LISTER_PKH, null),
                "asset01",
                BigInteger.valueOf(2_000_000L));
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(out))
                .build();

        AddressUtxoEvent event = eventFor(tx, 600L);

        indexer.onAddressUtxoEvent(event);
        indexer.onAddressUtxoEvent(event); // replay

        assertThat(store).hasSize(1);
        // First call: 1 save. Second call: existsById hit → no save.
        verify(listingRepo, times(1)).save(any());
    }

    @Test
    void noCuratedRowsMakesIndexerNoop() {
        // Fresh registry loaded against an empty repo — the in-memory watched
        // map starts and stays empty. Bootstrap path: no curated collections
        // means the indexer is wired but does nothing.
        CuratedCollectionRepository emptyRepo = org.mockito.Mockito.mock(CuratedCollectionRepository.class);
        when(emptyRepo.findAll()).thenReturn(List.of());
        WatchAddressRegistry emptyRegistry =
                new WatchAddressRegistry(emptyRepo, Networks.preprod(), wantedDeriver);
        emptyRegistry.reconcile();
        assertThat(emptyRegistry.size()).isZero();

        ListingEventsIndexer emptyIndexer = new ListingEventsIndexer(emptyRegistry, decoder, listingRepo);

        String txHash = hex32((byte) 0x09);
        AddressUtxo out = newListingOutput(
                txHash, 0, WATCHED_ADDR,
                buildListingDatumHex(LISTER_PKH, null), "asset01",
                BigInteger.valueOf(2_000_000L));
        TxInputOutput tx = TxInputOutput.builder()
                .txHash(txHash)
                .inputs(List.of())
                .outputs(List.of(out))
                .build();

        emptyIndexer.onAddressUtxoEvent(eventFor(tx, 700L));

        assertThat(store).isEmpty();
        verify(listingRepo, never()).findActiveByTxHashAndOutputIndex(any(), any());
    }

    // ------------------------------------------------------------------
    // ListingDatumDecoder smoke tests (white-box)
    // ------------------------------------------------------------------

    @Test
    void decoderRoundTripsListingDatumWithSomeUpdateRef() {
        byte[] hash = bytes28((byte) 0xde);
        String hex = buildListingDatumHex(LISTER_PKH, hash);
        var decoded = decoder.decode(hex);
        assertThat(decoded).isPresent();
        assertThat(decoded.get().listerPkh()).containsExactly(LISTER_PKH);
        assertThat(decoded.get().updateRefHash()).containsExactly(hash);
    }

    @Test
    void decoderRoundTripsListingDatumWithNone() {
        String hex = buildListingDatumHex(LISTER_PKH, null);
        var decoded = decoder.decode(hex);
        assertThat(decoded).isPresent();
        assertThat(decoded.get().listerPkh()).containsExactly(LISTER_PKH);
        assertThat(decoded.get().updateRefHash()).isNull();
    }

    @Test
    void decoderRejectsBlankAndNull() {
        assertThat(decoder.decode(null)).isEmpty();
        assertThat(decoder.decode("")).isEmpty();
        assertThat(decoder.decode("   ")).isEmpty();
    }

    // ==========================================================================
    // Fixture helpers
    // ==========================================================================

    /** Build a 32-byte hex tx-hash by repeating one byte. */
    private static String hex32(byte b) {
        byte[] out = new byte[32];
        java.util.Arrays.fill(out, b);
        return HexUtil.encodeHexString(out);
    }

    /** Build a 28-byte byte array (policy/pkh) by repeating one byte. */
    private static byte[] bytes28(byte b) {
        byte[] out = new byte[28];
        java.util.Arrays.fill(out, b);
        return out;
    }

    /**
     * Build a fake 28-byte hex asset_name from a label by left-padding to 28
     * bytes (so the resulting unit hex has the SPEC's enforced length).
     * We don't need real CIP-25 names — only deterministic byte content.
     */
    private static String hexAsset(String label) {
        byte[] raw = label.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] out = new byte[28];
        System.arraycopy(raw, 0, out, 0, Math.min(raw.length, out.length));
        return HexUtil.encodeHexString(out);
    }

    /**
     * Build a hex-encoded ListingDatum CBOR: {@code Constr 0 [lister_pkh,
     * Constr (0 if Some else 1) [hash?]]}.
     */
    private static String buildListingDatumHex(byte[] listerPkh, byte[] updateRefHash) {
        ConstrPlutusData option;
        if (updateRefHash == null) {
            option = ConstrPlutusData.builder()
                    .alternative(1L)
                    .data(new ListPlutusData())
                    .build();
        } else {
            option = ConstrPlutusData.builder()
                    .alternative(0L)
                    .data(ListPlutusData.of(BytesPlutusData.of(updateRefHash)))
                    .build();
        }
        ConstrPlutusData root = ConstrPlutusData.builder()
                .alternative(0L)
                .data(ListPlutusData.of(BytesPlutusData.of(listerPkh), option))
                .build();
        return root.serializeToHex();
    }

    /**
     * Build an AddressUtxo modelling a well-shaped listing output:
     * collection_policy NFT (quantity 1, 28-byte asset name) + lovelace +
     * inline datum.
     */
    private static AddressUtxo newListingOutput(String txHash, int outputIndex,
                                                String ownerAddr,
                                                String inlineDatumHex,
                                                String assetLabel,
                                                BigInteger lovelace) {
        Amt nft = amt(COLLECTION_POLICY, hexAsset(assetLabel), 1);
        return AddressUtxo.builder()
                .txHash(txHash)
                .outputIndex(outputIndex)
                .ownerAddr(ownerAddr)
                .lovelaceAmount(lovelace)
                .amounts(List.of(nft))
                .inlineDatum(inlineDatumHex)
                .build();
    }

    private static Amt amt(String policyHex, String assetNameHex, long qty) {
        return Amt.builder()
                .unit(policyHex + assetNameHex)
                .policyId(policyHex)
                .assetName(assetNameHex)
                .quantity(BigInteger.valueOf(qty))
                .build();
    }

    private static AddressUtxoEvent eventFor(TxInputOutput tx, long slot) {
        EventMetadata meta = EventMetadata.builder()
                .slot(slot)
                .blockTime(1_700_000_000L + slot)
                .build();
        return AddressUtxoEvent.builder()
                .metadata(meta)
                .txInputOutputs(List.of(tx))
                .build();
    }
}
