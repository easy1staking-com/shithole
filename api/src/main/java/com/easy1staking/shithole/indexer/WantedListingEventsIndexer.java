package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.util.HexUtil;
import com.bloxbean.cardano.yaci.store.common.domain.AddressUtxo;
import com.bloxbean.cardano.yaci.store.common.domain.Amt;
import com.bloxbean.cardano.yaci.store.common.domain.TxInput;
import com.bloxbean.cardano.yaci.store.events.EventMetadata;
import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import com.bloxbean.cardano.yaci.store.utxo.domain.TxInputOutput;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.entity.WantedListingEventId;
import com.easy1staking.shithole.indexer.WatchAddressRegistry.WatchedCollection;
import com.easy1staking.shithole.indexer.WantedDatumDecoder.DecodedWantedDatum;
import com.easy1staking.shithole.repository.WantedListingEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * v3 indexer — populates {@code wanted_listing_events} as buyers create
 * p2p listings and sellers/buyers consume them via Fulfill / Reclaim / Rescue.
 *
 * <p>Flatter than v2's {@link ListingEventsIndexer}: wanted-listings DO
 * NOT replant on fulfill, so there's no lineage. Each tx is two simple
 * passes:
 *
 * <ol>
 *   <li><b>Outputs</b> at any watched wanted-listing script address with a
 *       valid {@link WantedDatumDecoder} decode + strict 1-NFT-of-collection
 *       shape → INSERT a row (UPSERT-safe via PK).</li>
 *   <li><b>Inputs</b> matching an existing row's outref → mark the row
 *       spent. Action defaults to {@code spent_unknown}; redeemer-driven
 *       classification (fulfill / reclaim / rescue) is a follow-up.</li>
 * </ol>
 *
 * <p>"Junk" outputs (well-shaped UTxOs at the watched address that fail
 * datum decode or don't carry exactly one NFT under the configured
 * {@code collection_policy_id}) are skipped silently — same strict-shape
 * filter approach as v2.
 */
@Component
@ConditionalOnProperty(name = "shithole.indexer.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class WantedListingEventsIndexer {

    /** v1: every terminal spend marked as unknown; redeemer classification TBD. */
    static final String SPENT_UNKNOWN = "spent_unknown";

    private final WatchAddressRegistry registry;
    private final WantedDatumDecoder datumDecoder;
    private final WantedListingEventRepository wantedListingEventRepository;

    @EventListener
    @Transactional
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) return;
        if (registry.allWantedAddresses().isEmpty()) return; // fast path

        List<TxInputOutput> txs = event.getTxInputOutputs();
        if (txs == null || txs.isEmpty()) return;

        EventMetadata meta = event.getMetadata();
        long slot = meta != null ? meta.getSlot() : 0L;
        OffsetDateTime at = meta != null && meta.getBlockTime() > 0
                ? OffsetDateTime.ofInstant(Instant.ofEpochSecond(meta.getBlockTime()), ZoneOffset.UTC)
                : OffsetDateTime.now(ZoneOffset.UTC);

        for (TxInputOutput tx : txs) {
            try {
                processTx(tx, slot, at);
            } catch (RuntimeException e) {
                // One bad tx must not poison the block. Re-indexing is
                // idempotent (PK + active-check guard against dupes).
                log.error("WantedListingEventsIndexer: error processing tx {}: {}",
                        tx != null ? tx.getTxHash() : "<null>", e.getMessage(), e);
            }
        }
    }

    private void processTx(TxInputOutput tx, long slot, OffsetDateTime at) {
        if (tx == null || tx.getTxHash() == null) return;
        // Pass 1: any input that consumes one of our active listings → mark spent.
        List<TxInput> inputs = tx.getInputs();
        if (inputs != null) {
            for (TxInput in : inputs) {
                if (in == null || in.getTxHash() == null) continue;
                byte[] prevTxHash;
                try {
                    prevTxHash = HexUtil.decodeHexString(in.getTxHash());
                } catch (Exception e) {
                    continue;
                }
                Optional<WantedListingEventEntity> existing =
                        wantedListingEventRepository.findActiveByTxHashAndOutputIndex(
                                prevTxHash, in.getOutputIndex());
                if (existing.isEmpty()) continue;
                WantedListingEventEntity row = existing.get();
                row.setSpentAtSlot(slot);
                row.setSpentAt(at);
                row.setSpentByTxHash(HexUtil.decodeHexString(tx.getTxHash()));
                row.setSpentAction(SPENT_UNKNOWN);
                wantedListingEventRepository.save(row);
                log.info("p2p indexer: marked spent {}#{} (by tx {})",
                        HexUtil.encodeHexString(prevTxHash), in.getOutputIndex(), tx.getTxHash());
            }
        }

        // Pass 2: any output at a watched wanted-listing address with a
        // valid datum + 1-NFT-of-collection shape → INSERT a new active row.
        List<AddressUtxo> outputs = tx.getOutputs();
        if (outputs == null) return;
        for (AddressUtxo out : outputs) {
            if (out == null) continue;
            WatchedCollection wc = registry.getByWantedAddress(out.getOwnerAddr());
            if (wc == null) continue;

            // Strict-shape filter — refuse "junk" outputs.
            Optional<DecodedWantedDatum> datumOpt = datumDecoder.decode(out.getInlineDatum());
            if (datumOpt.isEmpty()) {
                log.debug("p2p indexer: skip {}#{} (slug={}) — datum decode failed",
                        out.getTxHash(), out.getOutputIndex(), wc.slug());
                continue;
            }
            DecodedWantedDatum datum = datumOpt.get();

            // Extract the offered NFT (must be exactly one asset under
            // collection_policy_id with quantity 1; anything else = junk).
            Optional<byte[]> unitOpt = extractOfferedUnit(out, wc.collectionPolicyId());
            if (unitOpt.isEmpty()) {
                log.debug("p2p indexer: skip {}#{} (slug={}) — no single-NFT shape",
                        out.getTxHash(), out.getOutputIndex(), wc.slug());
                continue;
            }

            // PK collision guard — if we re-index the same block, save() would
            // overwrite the row (resetting spent_* to null on a row that we
            // already marked spent earlier in this same tx). Guard with an
            // existsById check.
            byte[] txHashBytes = HexUtil.decodeHexString(out.getTxHash());
            WantedListingEventId id = new WantedListingEventId(txHashBytes, out.getOutputIndex());
            if (wantedListingEventRepository.existsById(id)) {
                log.debug("p2p indexer: {}#{} already indexed, skipping",
                        out.getTxHash(), out.getOutputIndex());
                continue;
            }

            long lovelace = adaLovelace(out.getAmounts());
            WantedListingEventEntity row = WantedListingEventEntity.builder()
                    .txHash(txHashBytes)
                    .outputIndex(out.getOutputIndex())
                    .configNftPolicy(HexUtil.decodeHexString(wc.configNftPolicy()))
                    .buyerPkh(datum.buyerPkh())
                    .buyerAddressBech32(datum.buyerAddressBech32())
                    .acceptedMerkleRoot(datum.acceptedMerkleRoot())
                    .offeredNftUnit(unitOpt.get())
                    .lovelace(lovelace)
                    .createdAtSlot(slot)
                    .createdAt(at)
                    .build();
            wantedListingEventRepository.save(row);
            log.info("p2p indexer: +listing {}#{} slug={} buyer={} root={} bounty={} unit={}",
                    out.getTxHash(), out.getOutputIndex(), wc.slug(),
                    HexUtil.encodeHexString(datum.buyerPkh()).substring(0, 8),
                    HexUtil.encodeHexString(datum.acceptedMerkleRoot()).substring(0, 8),
                    lovelace,
                    HexUtil.encodeHexString(unitOpt.get()));
        }
    }

    /**
     * Return the offered NFT's unit bytes (policy + asset_name) iff the
     * output carries EXACTLY one non-ADA asset and it's under
     * {@code collectionPolicyIdHex} with quantity 1. Anything else → empty.
     */
    private Optional<byte[]> extractOfferedUnit(AddressUtxo out, String collectionPolicyIdHex) {
        List<Amt> amts = out.getAmounts();
        if (amts == null) return Optional.empty();
        Amt offered = null;
        int nonAdaCount = 0;
        for (Amt a : amts) {
            String unit = a.getUnit();
            if (unit == null || unit.isEmpty() || "lovelace".equals(unit)) continue;
            nonAdaCount++;
            if (nonAdaCount > 1) return Optional.empty();
            offered = a;
        }
        if (offered == null) return Optional.empty();
        if (!offered.getQuantity().equals(BigInteger.ONE)) return Optional.empty();
        String unit = offered.getUnit().toLowerCase(Locale.ROOT);
        if (unit.length() < 56) return Optional.empty();
        if (!unit.startsWith(collectionPolicyIdHex.toLowerCase(Locale.ROOT))) {
            return Optional.empty();
        }
        try {
            return Optional.of(HexUtil.decodeHexString(unit));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private static long adaLovelace(List<Amt> amts) {
        if (amts == null) return 0L;
        for (Amt a : amts) {
            if ("lovelace".equals(a.getUnit())) {
                return a.getQuantity().longValueExact();
            }
        }
        return 0L;
    }
}
