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
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.WantedRedeemer;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.WantedRedeemerConverter;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.wantedredeemer.Fulfill;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.wantedredeemer.Reclaim;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.wantedredeemer.Rescue;
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
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

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

    /** Terminal spends we can't classify into fulfill/reclaim/rescue. */
    static final String SPENT_UNKNOWN = "spent_unknown";
    /** Buyer received an NFT (the desired one) AND a non-buyer counterparty exists. */
    static final String FULFILL = "fulfill";
    /** Buyer received their own locked NFT + ADA back; no counterparty in the tx. */
    static final String RECLAIM = "reclaim";
    /** Admin Rescue path — no buyer-bound output. */
    static final String RESCUE = "rescue";

    private final WatchAddressRegistry registry;
    private final WantedDatumDecoder datumDecoder;
    private final WantedListingEventRepository wantedListingEventRepository;
    private final WantedRedeemerConverter wantedRedeemerConverter = new WantedRedeemerConverter();

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
        List<AddressUtxo> outputs = tx.getOutputs();

        // Pass 1: any input that consumes one of our active listings → mark spent.
        // Inspect the tx outputs to classify fulfill / reclaim / rescue and
        // stamp the fulfiller's payment-cred when present.
        Set<String> wantedAddresses = registry.allWantedAddresses();
        Set<String> treasuryAddresses = registry.allTreasuryAddresses();

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

                ClassifiedSpend cs = classifySpend(row, outputs, wantedAddresses, treasuryAddresses);
                row.setSpentAtSlot(slot);
                row.setSpentAt(at);
                row.setSpentByTxHash(HexUtil.decodeHexString(tx.getTxHash()));
                row.setSpentAction(cs.action());
                row.setFulfillerPkh(cs.fulfillerPkh());
                wantedListingEventRepository.save(row);
                log.info("p2p indexer: spent {}#{} action={} fulfiller={} (by tx {})",
                        HexUtil.encodeHexString(prevTxHash), in.getOutputIndex(),
                        cs.action(),
                        cs.fulfillerPkh() == null ? "<none>" : HexUtil.encodeHexString(cs.fulfillerPkh()),
                        tx.getTxHash());
            }
        }

        // Pass 2: any output at a watched wanted-listing address with a
        // valid datum + 1-NFT-of-collection shape → INSERT a new active row.
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

    /**
     * Walk the tx outputs and classify the spend of a single wanted-listing
     * row into {@link #FULFILL}, {@link #RECLAIM}, {@link #RESCUE}, or
     * {@link #SPENT_UNKNOWN}.
     *
     * <p>Heuristic:
     * <ul>
     *   <li>If at least one output goes to the row's {@code buyerAddressBech32}
     *       AND there's a single distinct payment-credential among the
     *       outputs that aren't script / treasury / buyer → {@link #FULFILL},
     *       stamp the fulfiller_pkh.</li>
     *   <li>If at least one output goes to the buyer's address AND no
     *       distinct counterparty remains → {@link #RECLAIM}. The buyer
     *       reclaiming pays the tx fee from their own inputs; outputs are
     *       buyer-side only.</li>
     *   <li>If no output goes to the buyer's address → {@link #RESCUE}
     *       (admin path) is the most likely classification.</li>
     *   <li>If the fulfill heuristic identifies multiple distinct
     *       counterparties (rare but possible if the tx batches multiple
     *       fulfills) → action = {@link #FULFILL} but fulfiller_pkh = null
     *       (we'd misattribute if we picked the first).</li>
     * </ul>
     */
    private ClassifiedSpend classifySpend(WantedListingEventEntity row,
                                          List<AddressUtxo> txOutputs,
                                          Set<String> wantedAddresses,
                                          Set<String> treasuryAddresses) {
        if (txOutputs == null || txOutputs.isEmpty()) {
            return new ClassifiedSpend(SPENT_UNKNOWN, null);
        }
        String buyerAddr = row.getBuyerAddressBech32();
        Set<String> skip = new HashSet<>(wantedAddresses);
        skip.addAll(treasuryAddresses);
        if (buyerAddr != null) skip.add(buyerAddr);

        boolean buyerOutput = false;
        String counterparty = null;
        boolean counterpartyAmbiguous = false;
        for (AddressUtxo out : txOutputs) {
            if (out == null) continue;
            String addr = out.getOwnerAddr();
            if (addr == null) continue;
            if (buyerAddr != null && buyerAddr.equals(addr)) {
                buyerOutput = true;
                continue;
            }
            if (skip.contains(addr)) continue;
            String cred = out.getOwnerPaymentCredential();
            if (cred == null || cred.isBlank()) continue;
            String credLc = cred.toLowerCase(Locale.ROOT);
            if (counterparty == null) {
                counterparty = credLc;
            } else if (!counterparty.equals(credLc)) {
                counterpartyAmbiguous = true;
            }
        }

        if (buyerOutput && counterparty != null) {
            byte[] pkh = counterpartyAmbiguous ? null : hexToBytesSafe(counterparty);
            return new ClassifiedSpend(FULFILL, pkh);
        }
        if (buyerOutput) {
            return new ClassifiedSpend(RECLAIM, null);
        }
        // No buyer-bound output. Could be admin Rescue, an unrecognised
        // pattern, or a tx where buyer's bech32 differs from the on-chain
        // expected bech32 (shouldn't happen — contract enforces full Address
        // equality on Fulfill — but be defensive).
        return new ClassifiedSpend(RESCUE, null);
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

    /** Outcome of spend classification. {@code fulfillerPkh} may be null even on fulfill if ambiguous. */
    private record ClassifiedSpend(String action, byte[] fulfillerPkh) {
    }

    /* ------------------------------------------------------------------
     * Redeemer-driven refinement of spent_action.
     *
     * The AddressUtxoEvent handler above runs the output heuristic
     * (fulfill / reclaim / rescue / spent_unknown). This handler reads
     * the actual Spend redeemer from the witness set and overrides the
     * classification authoritatively. Conway/Plutus V3 redeemers carry
     * (tag, index) where index = position in the SORTED inputs set.
     * We sort canonically (lex by tx_hash then output_index) and pull
     * the matching redeemer.
     *
     * Either firing order is fine:
     *   - AUE first → heuristic stamps action. TX event overrides.
     *   - TX event first → redeemer stamps action. AUE's
     *     findActiveByTxHashAndOutputIndex sees spent_action != null,
     *     returns empty, AUE skips the spend update path.
     * ------------------------------------------------------------------ */

    @EventListener
    @Transactional
    public void onTransactionEvent(TransactionEvent event) {
        if (event == null || event.getTransactions() == null) return;
        if (registry.allWantedAddresses().isEmpty()) return;

        for (Transaction tx : event.getTransactions()) {
            try {
                refineSpendsFromRedeemer(tx);
            } catch (RuntimeException e) {
                log.error("p2p indexer (redeemer): error on tx {}: {}",
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
            Optional<WantedListingEventEntity> rowOpt = wantedListingEventRepository
                    .findById(new WantedListingEventId(prevTxHash, in.getIndex()));
            if (rowOpt.isEmpty()) continue;
            WantedListingEventEntity row = rowOpt.get();

            int sortedIdx = SpendRedeemerExtractor.indexOfInput(sorted, in.getTransactionId(), in.getIndex());
            Optional<Redeemer> redeemerOpt = SpendRedeemerExtractor.spendRedeemerAt(tx.getWitnesses(), sortedIdx);
            if (redeemerOpt.isEmpty()) continue;
            Redeemer r = redeemerOpt.get();
            if (r.getData() == null || r.getData().getCbor() == null) continue;

            String action;
            try {
                WantedRedeemer red = wantedRedeemerConverter.deserialize(r.getData().getCbor());
                if (red instanceof Fulfill) action = FULFILL;
                else if (red instanceof Reclaim) action = RECLAIM;
                else if (red instanceof Rescue) action = RESCUE;
                else action = SPENT_UNKNOWN;
            } catch (RuntimeException e) {
                log.warn("p2p indexer (redeemer): failed to decode redeemer for {}#{}: {}",
                        in.getTransactionId(), in.getIndex(), e.getMessage());
                continue;
            }

            String previous = row.getSpentAction();
            if (action.equals(previous)) continue; // already classified the same way

            row.setSpentAction(action);
            // Reclaim / rescue have no fulfiller; clear any stamp the
            // heuristic may have left.
            if (!FULFILL.equals(action)) {
                row.setFulfillerPkh(null);
            }
            wantedListingEventRepository.save(row);
            log.info("p2p indexer (redeemer): refined {}#{} {} -> {}",
                    in.getTransactionId(), in.getIndex(),
                    previous == null ? "<none>" : previous, action);
        }
    }
}
