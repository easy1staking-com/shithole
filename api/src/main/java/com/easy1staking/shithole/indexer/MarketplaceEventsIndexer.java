package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.util.HexUtil;
import com.bloxbean.cardano.yaci.core.model.Redeemer;
import com.bloxbean.cardano.yaci.core.model.TransactionInput;
import com.bloxbean.cardano.yaci.helper.model.Transaction;
import com.bloxbean.cardano.yaci.store.common.domain.AddressUtxo;
import com.bloxbean.cardano.yaci.store.common.domain.Amt;
import com.bloxbean.cardano.yaci.store.common.domain.TxInput;
import com.bloxbean.cardano.yaci.store.events.EventMetadata;
import com.bloxbean.cardano.yaci.store.events.TransactionEvent;
import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import com.bloxbean.cardano.yaci.store.utxo.domain.TxInputOutput;
import com.easy1staking.shithole.blueprint.generated.marketplace.model.MarketRedeemer;
import com.easy1staking.shithole.blueprint.generated.marketplace.model.converter.MarketRedeemerConverter;
import com.easy1staking.shithole.blueprint.generated.marketplace.model.marketredeemer.Buy;
import com.easy1staking.shithole.blueprint.generated.marketplace.model.marketredeemer.Cancel;
import com.easy1staking.shithole.entity.MarketplaceEventEntity;
import com.easy1staking.shithole.entity.MarketplaceEventId;
import com.easy1staking.shithole.indexer.MarketplaceDatumDecoder.DecodedMarketDatum;
import com.easy1staking.shithole.repository.MarketplaceEventRepository;
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
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Indexer for the singleton marketplace script address.
 *
 * <p>Mirrors the {@link WantedListingEventsIndexer} two-pass pattern:
 * <ol>
 *   <li><b>Outputs</b> at the marketplace address with a valid
 *       {@link MarketplaceDatumDecoder} decode → INSERT a row.</li>
 *   <li><b>Inputs</b> matching an active row's outref → mark spent. The
 *       {@link AddressUtxoEvent} pass picks an initial action via the
 *       output walk (listed_nft_unit's destination = buyer for a Buy,
 *       no buyer-bound output = Cancel). The {@link TransactionEvent}
 *       pass then refines using the actual Spend redeemer's constructor
 *       index (Buy = 0 → {@code sold}, Cancel = 1 → {@code cancelled})
 *       — authoritative when present.</li>
 * </ol>
 *
 * <p>The indexer self-disables when {@link WatchAddressRegistry#getMarketplaceAddress()}
 * is null (no admin pkh configured). It also short-circuits when the
 * address is set but the tx doesn't touch it, so the per-block overhead
 * is a single address-equality check.
 */
@Component
@ConditionalOnProperty(name = "shithole.indexer.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class MarketplaceEventsIndexer {

    /** Terminal Buy — NFT went to a buyer, ADA went to the seller. */
    static final String SOLD = "sold";
    /** Terminal Cancel — seller pulled the listing; everything went back. */
    static final String CANCELLED = "cancelled";
    /** Spent but couldn't pin Buy vs Cancel (no redeemer + degenerate outputs). */
    static final String SPENT_UNKNOWN = "spent_unknown";

    private final WatchAddressRegistry registry;
    private final MarketplaceDatumDecoder datumDecoder;
    private final MarketplaceEventRepository marketplaceEventRepository;
    private final MarketRedeemerConverter marketRedeemerConverter = new MarketRedeemerConverter();

    @EventListener
    @Transactional
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) return;
        String marketAddr = registry.getMarketplaceAddress();
        if (marketAddr == null) return; // marketplace indexing disabled

        List<TxInputOutput> txs = event.getTxInputOutputs();
        if (txs == null || txs.isEmpty()) return;

        EventMetadata meta = event.getMetadata();
        long slot = meta != null ? meta.getSlot() : 0L;
        OffsetDateTime at = meta != null && meta.getBlockTime() > 0
                ? OffsetDateTime.ofInstant(Instant.ofEpochSecond(meta.getBlockTime()), ZoneOffset.UTC)
                : OffsetDateTime.now(ZoneOffset.UTC);

        for (TxInputOutput tx : txs) {
            try {
                processTx(tx, marketAddr, slot, at);
            } catch (RuntimeException e) {
                // One bad tx must not poison the block. Re-indexing is
                // idempotent (PK + active-check guard against dupes).
                log.error("MarketplaceEventsIndexer: error processing tx {}: {}",
                        tx != null ? tx.getTxHash() : "<null>", e.getMessage(), e);
            }
        }
    }

    private void processTx(TxInputOutput tx, String marketAddr, long slot, OffsetDateTime at) {
        if (tx == null || tx.getTxHash() == null) return;
        List<AddressUtxo> outputs = tx.getOutputs();

        // Pass 1: any input that consumes one of our active listings → mark spent.
        // Run the output-heuristic classifier here so the row carries SOMETHING
        // even if the TransactionEvent never fires (e.g. block-replay with no
        // witness data).
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
                Optional<MarketplaceEventEntity> existing =
                        marketplaceEventRepository.findActiveByTxHashAndOutputIndex(
                                prevTxHash, in.getOutputIndex());
                if (existing.isEmpty()) continue;
                MarketplaceEventEntity row = existing.get();

                ClassifiedSpend cs = classifySpend(row, outputs, marketAddr);
                row.setSpentAtSlot(slot);
                row.setSpentAt(at);
                row.setSpentByTxHash(HexUtil.decodeHexString(tx.getTxHash()));
                row.setSpentAction(cs.action());
                row.setBuyerPkh(cs.buyerPkh());
                marketplaceEventRepository.save(row);
                log.info("market indexer: spent {}#{} action={} buyer={} (by tx {})",
                        HexUtil.encodeHexString(prevTxHash), in.getOutputIndex(),
                        cs.action(),
                        cs.buyerPkh() == null ? "<none>" : HexUtil.encodeHexString(cs.buyerPkh()),
                        tx.getTxHash());
            }
        }

        // Pass 2: any output at the marketplace address with a valid datum
        // → INSERT a new active row.
        if (outputs == null) return;
        for (AddressUtxo out : outputs) {
            if (out == null) continue;
            if (!marketAddr.equals(out.getOwnerAddr())) continue;

            Optional<DecodedMarketDatum> datumOpt = datumDecoder.decode(out.getInlineDatum());
            if (datumOpt.isEmpty()) {
                log.debug("market indexer: skip {}#{} — datum decode failed",
                        out.getTxHash(), out.getOutputIndex());
                continue;
            }
            DecodedMarketDatum datum = datumOpt.get();

            // Extract the listed NFT — must be exactly one non-ADA asset
            // with quantity 1. Anything else = junk (e.g. someone paid
            // a bundle in by accident).
            Optional<byte[]> unitOpt = extractListedUnit(out);
            if (unitOpt.isEmpty()) {
                log.debug("market indexer: skip {}#{} — no single-NFT shape",
                        out.getTxHash(), out.getOutputIndex());
                continue;
            }

            byte[] txHashBytes = HexUtil.decodeHexString(out.getTxHash());
            MarketplaceEventId id = new MarketplaceEventId(txHashBytes, out.getOutputIndex());
            if (marketplaceEventRepository.existsById(id)) {
                log.debug("market indexer: {}#{} already indexed, skipping",
                        out.getTxHash(), out.getOutputIndex());
                continue;
            }

            long lovelace = adaLovelace(out.getAmounts());
            byte[] listedUnit = unitOpt.get();
            // Collection dimension = the listed NFT's policy id (first 28 bytes).
            byte[] collectionPolicyId = Arrays.copyOf(listedUnit, 28);
            MarketplaceEventEntity row = MarketplaceEventEntity.builder()
                    .txHash(txHashBytes)
                    .outputIndex(out.getOutputIndex())
                    .sellerPkh(datum.sellerPkh())
                    .sellerAddressBech32(datum.sellerAddressBech32())
                    .pricePolicy(datum.pricePolicy())
                    .priceName(datum.priceName())
                    .priceQty(datum.priceQty())
                    .accompanyingLovelace(datum.accompanyingLovelace())
                    .listedNftUnit(listedUnit)
                    .collectionPolicyId(collectionPolicyId)
                    .lovelace(lovelace)
                    .createdAtSlot(slot)
                    .createdAt(at)
                    .build();
            marketplaceEventRepository.save(row);
            log.info("market indexer: +listing {}#{} seller={} price={} {}/{} bond={} unit={}",
                    out.getTxHash(), out.getOutputIndex(),
                    HexUtil.encodeHexString(datum.sellerPkh()).substring(0, 8),
                    datum.priceQty(),
                    HexUtil.encodeHexString(datum.pricePolicy()),
                    HexUtil.encodeHexString(datum.priceName()),
                    datum.accompanyingLovelace(),
                    HexUtil.encodeHexString(unitOpt.get()));
        }
    }

    /**
     * Return the listed NFT's unit bytes (policy + asset_name) iff the
     * output carries EXACTLY one non-ADA asset with quantity 1. Anything
     * else (bundle, FT, junk) → empty.
     */
    private Optional<byte[]> extractListedUnit(AddressUtxo out) {
        List<Amt> amts = out.getAmounts();
        if (amts == null) return Optional.empty();
        Amt listed = null;
        int nonAdaCount = 0;
        for (Amt a : amts) {
            String unit = a.getUnit();
            if (unit == null || unit.isEmpty() || "lovelace".equals(unit)) continue;
            nonAdaCount++;
            if (nonAdaCount > 1) return Optional.empty();
            listed = a;
        }
        if (listed == null) return Optional.empty();
        if (!listed.getQuantity().equals(BigInteger.ONE)) return Optional.empty();
        String unit = listed.getUnit().toLowerCase(Locale.ROOT);
        if (unit.length() < 56) return Optional.empty();
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

    /**
     * Provisional classification from the output walk. The
     * {@link TransactionEvent} pass overrides this with the redeemer-
     * driven authoritative value when available.
     *
     * <p>Heuristic: the listed_nft_unit always leaves the listing UTxO.
     * The output that receives it identifies the destination — if it's
     * the seller's bech32 (matches the row's seller address), this is
     * almost certainly a Cancel; otherwise it's a Buy and the
     * destination's payment credential = buyer_pkh.
     */
    private ClassifiedSpend classifySpend(MarketplaceEventEntity row,
                                          List<AddressUtxo> txOutputs,
                                          String marketAddr) {
        if (txOutputs == null || txOutputs.isEmpty()) {
            return new ClassifiedSpend(SPENT_UNKNOWN, null);
        }
        String unitHex = HexUtil.encodeHexString(row.getListedNftUnit()).toLowerCase(Locale.ROOT);
        String sellerAddr = row.getSellerAddressBech32();

        for (AddressUtxo out : txOutputs) {
            if (out == null) continue;
            String addr = out.getOwnerAddr();
            if (addr == null || marketAddr.equals(addr)) continue;
            if (!outputContainsUnit(out, unitHex)) continue;

            // Output carries the listed NFT.
            if (sellerAddr != null && sellerAddr.equals(addr)) {
                return new ClassifiedSpend(CANCELLED, null);
            }
            String cred = out.getOwnerPaymentCredential();
            byte[] buyerPkh = hexToBytesSafe(cred);
            return new ClassifiedSpend(SOLD, buyerPkh);
        }
        // No output carries the listed unit — degenerate path; the
        // TransactionEvent pass might still clean this up via redeemer.
        return new ClassifiedSpend(SPENT_UNKNOWN, null);
    }

    private static boolean outputContainsUnit(AddressUtxo out, String unitHexLower) {
        List<Amt> amts = out.getAmounts();
        if (amts == null) return false;
        for (Amt a : amts) {
            String u = a.getUnit();
            if (u == null) continue;
            if (u.toLowerCase(Locale.ROOT).equals(unitHexLower)) return true;
        }
        return false;
    }

    private static byte[] hexToBytesSafe(String hex) {
        if (hex == null || hex.isEmpty()) return null;
        try {
            String h = hex.startsWith("0x") ? hex.substring(2) : hex;
            return HexUtil.decodeHexString(h);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private record ClassifiedSpend(String action, byte[] buyerPkh) {
    }

    /* ------------------------------------------------------------------
     * Redeemer-driven refinement of spent_action.
     *
     * The AUE handler runs the output heuristic. This handler reads the
     * actual Spend redeemer and overrides authoritatively.
     *
     * Either firing order is fine:
     *   - AUE first → heuristic stamps. TX overrides.
     *   - TX first  → redeemer stamps. AUE's findActive returns empty
     *     because spent_action is no longer null, AUE skips the spend
     *     update path.
     * ------------------------------------------------------------------ */

    @EventListener
    @Transactional
    public void onTransactionEvent(TransactionEvent event) {
        if (event == null || event.getTransactions() == null) return;
        if (registry.getMarketplaceAddress() == null) return;

        for (Transaction tx : event.getTransactions()) {
            try {
                refineSpendsFromRedeemer(tx);
            } catch (RuntimeException e) {
                log.error("market indexer (redeemer): error on tx {}: {}",
                        tx == null ? "<null>" : tx.getTxHash(), e.getMessage(), e);
            }
        }
    }

    private void refineSpendsFromRedeemer(Transaction tx) {
        if (tx == null || tx.getBody() == null || tx.getWitnesses() == null) return;
        if (tx.getBody().getInputs() == null || tx.getBody().getInputs().isEmpty()) return;
        if (tx.getWitnesses().getRedeemers() == null
                || tx.getWitnesses().getRedeemers().isEmpty()) return;

        List<TransactionInput> sorted = SpendRedeemerExtractor.sortInputs(tx.getBody().getInputs());

        for (TransactionInput in : sorted) {
            if (in == null || in.getTransactionId() == null) continue;
            byte[] prevTxHash;
            try {
                prevTxHash = HexUtil.decodeHexString(in.getTransactionId());
            } catch (Exception e) {
                continue;
            }
            Optional<MarketplaceEventEntity> rowOpt = marketplaceEventRepository
                    .findById(new MarketplaceEventId(prevTxHash, in.getIndex()));
            if (rowOpt.isEmpty()) continue;
            MarketplaceEventEntity row = rowOpt.get();

            int sortedIdx = SpendRedeemerExtractor.indexOfInput(sorted, in.getTransactionId(), in.getIndex());
            Optional<Redeemer> redeemerOpt = SpendRedeemerExtractor.spendRedeemerAt(tx.getWitnesses(), sortedIdx);
            if (redeemerOpt.isEmpty()) continue;
            Redeemer r = redeemerOpt.get();
            if (r.getData() == null || r.getData().getCbor() == null) continue;

            String action;
            try {
                MarketRedeemer red = marketRedeemerConverter.deserialize(r.getData().getCbor());
                if (red instanceof Buy) action = SOLD;
                else if (red instanceof Cancel) action = CANCELLED;
                else action = SPENT_UNKNOWN;
            } catch (RuntimeException e) {
                log.warn("market indexer (redeemer): failed to decode redeemer for {}#{}: {}",
                        in.getTransactionId(), in.getIndex(), e.getMessage());
                continue;
            }

            String previous = row.getSpentAction();
            if (action.equals(previous)) continue;

            row.setSpentAction(action);
            // Cancel paths have no buyer; clear any stamp the heuristic
            // may have left.
            if (!SOLD.equals(action)) {
                row.setBuyerPkh(null);
            }
            marketplaceEventRepository.save(row);
            log.info("market indexer (redeemer): refined {}#{} {} -> {}",
                    in.getTransactionId(), in.getIndex(),
                    previous == null ? "<none>" : previous, action);
        }
    }
}
