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
import com.bloxbean.cardano.yaci.store.utxo.domain.UtxoRollbackEvent;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ListingRedeemer;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ListingRedeemerConverter;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.listingredeemer.Cancel;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.listingredeemer.Recover;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.listingredeemer.Swap;
import com.easy1staking.shithole.entity.ListingEventEntity;
import com.easy1staking.shithole.entity.ListingEventId;
import com.easy1staking.shithole.indexer.WatchAddressRegistry.WatchedCollection;
import com.easy1staking.shithole.indexer.ListingDatumDecoder.DecodedListingDatum;
import com.easy1staking.shithole.repository.ListingEventRepository;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Populates the {@code listing_events} lineage table per
 * {@code docs/BACKEND.md} §"Swap-history lineage tracking".
 *
 * <p>Listens for {@link AddressUtxoEvent} (every block, after Yaci Store has
 * already persisted the underlying utxo rows) and {@link UtxoRollbackEvent}
 * (during chain reorgs).
 *
 * <p>Per-tx reconciliation logic (matches the doc):
 * <ul>
 *   <li><b>Swap</b> = spent listing input + new listing output at the same
 *       watched address in the same tx. Marks old row {@code spent_action='swap'};
 *       inserts successor row with {@code swap_index = prev+1},
 *       {@code update_ref_hash} from the new datum.</li>
 *   <li><b>Cancel/Recover</b> = listing input spent with no successor output
 *       at the watched address. Marks old row {@code spent_action='cancel_or_recover'}
 *       (redeemer-based classification deferred — see brief task 3).</li>
 *   <li><b>Genesis</b> = a new output at a watched address with no
 *       corresponding listing input being spent in this tx. Inserts row with
 *       {@code (initial_tx_hash, initial_output_index) == (tx_hash, output_index)},
 *       {@code swap_index = 0}, {@code update_ref_hash = NULL}.</li>
 * </ul>
 *
 * <p>"Junk" outputs (well-formed UTxOs at the watched address that fail the
 * strict {@code ListingDatum} decode, or that carry no inline datum) are
 * observed but not curated — see SPEC §10.2 strict listing-shape filter.
 */
@Component
@ConditionalOnProperty(name = "shithole.indexer.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class ListingEventsIndexer {

    /**
     * Sentinel for a spend that we know is terminal (no successor at the same
     * address in the same tx) but we couldn't pin to a known counterparty
     * (lister cancel or admin recover) via output inspection. Must fit
     * within the {@code VARCHAR(16)} {@code spent_action} column (see V1_0_1).
     *
     * <p>v1 marked every terminal spend as this sentinel. v2 (V1_0_6) refines
     * to {@code 'cancel'} or {@code 'recover'} when the heuristic in
     * {@link #applyCancelOrRecover} pins down the counterparty; falls back
     * to the sentinel when ambiguous.
     */
    static final String SPENT_UNKNOWN = "spent_unknown";

    private final WatchAddressRegistry registry;
    private final ListingDatumDecoder datumDecoder;
    private final ListingEventRepository listingEventRepository;
    private final ListingRedeemerConverter listingRedeemerConverter = new ListingRedeemerConverter();

    /**
     * One transaction per block event so partial application can't leave the
     * lineage table in an inconsistent state mid-block. Block sizes are
     * bounded (~100kB) so the unit of work is small.
     */
    @EventListener
    @Transactional
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) {
            return;
        }
        if (registry.size() == 0) {
            // Fast path: no curated collections yet → indexer is a no-op.
            return;
        }
        List<TxInputOutput> txs = event.getTxInputOutputs();
        if (txs == null || txs.isEmpty()) {
            return;
        }
        EventMetadata meta = event.getMetadata();
        long slot = meta != null ? meta.getSlot() : 0L;
        OffsetDateTime at = meta != null && meta.getBlockTime() > 0
                ? OffsetDateTime.ofInstant(Instant.ofEpochSecond(meta.getBlockTime()), ZoneOffset.UTC)
                : OffsetDateTime.now(ZoneOffset.UTC);

        for (TxInputOutput tx : txs) {
            try {
                processTx(tx, slot, at);
            } catch (RuntimeException e) {
                // One bad tx must not poison the whole block. Log and continue;
                // re-indexing the same slot is idempotent (PK = (tx_hash, output_index)
                // and we always look up existing rows before inserting).
                log.error("ListingEventsIndexer: error processing tx {}: {}",
                        tx != null ? tx.getTxHash() : "<null>", e.getMessage(), e);
            }
        }
    }

    private void processTx(TxInputOutput tx, long slot, OffsetDateTime at) {
        if (tx == null || tx.getTxHash() == null) {
            return;
        }
        String txHash = tx.getTxHash();

        // ---- 1. Identify listing inputs being spent at any watched address.
        // Group by watched address so we can match same-address create+spend
        // in step 3 (the "swap" case).
        Map<String, List<ListingEventEntity>> spentByAddress = new HashMap<>();
        List<TxInput> inputs = tx.getInputs() == null ? List.of() : tx.getInputs();
        for (TxInput in : inputs) {
            if (in == null || in.getTxHash() == null || in.getOutputIndex() == null) {
                continue;
            }
            byte[] prevTxBytes = hexToBytesSafe(in.getTxHash());
            if (prevTxBytes == null) continue;
            Optional<ListingEventEntity> active =
                    listingEventRepository.findActiveByTxHashAndOutputIndex(prevTxBytes, in.getOutputIndex());
            if (active.isEmpty()) {
                continue;
            }
            ListingEventEntity prev = active.get();
            // Reconstruct the address via reverse lookup on configNftPolicy,
            // because TxInput doesn't carry the source address. The
            // watch-registry exposes only address→curated; we need
            // policy→address for this branch. Find the matching watched entry.
            WatchedCollection wc = findWatchedByConfigPolicy(prev.getConfigNftPolicy());
            if (wc == null) {
                // Row exists but its config policy is no longer in the watch
                // set — should never happen in v1 (entries don't drop).
                // Treat as same-tx cancel/recover keyed under a sentinel.
                spentByAddress.computeIfAbsent("", k -> new ArrayList<>()).add(prev);
                continue;
            }
            spentByAddress.computeIfAbsent(wc.listingScriptAddress(), k -> new ArrayList<>()).add(prev);
        }

        // ---- 2. Identify watched outputs in this tx + decode datum.
        // Group by address so we can match same-address spend+create in step 3.
        Map<String, List<PendingCreate>> createsByAddress = new HashMap<>();
        List<AddressUtxo> outputs = tx.getOutputs() == null ? List.of() : tx.getOutputs();
        for (AddressUtxo out : outputs) {
            if (out == null) continue;
            String addr = out.getOwnerAddr();
            if (addr == null) continue;
            WatchedCollection wc = registry.get(addr);
            if (wc == null) continue;

            Optional<DecodedListingDatum> decoded = datumDecoder.decode(out.getInlineDatum());
            if (decoded.isEmpty()) {
                // Junk (no datum, decode failed, wrong shape). SPEC §10.2: observe but don't curate.
                log.debug("ListingEventsIndexer: skipping junk output at {}#{} of tx {} (address {})",
                        out.getTxHash(), out.getOutputIndex(), txHash, addr);
                continue;
            }
            DecodedListingDatum d = decoded.get();

            // The NFT-unit lookup is keyed on the collection_policy_id from
            // the curated row. SPEC enforces "exactly one NFT under the
            // collection policy + ADA"; we trust the strict shape on-chain.
            byte[] nftUnit = findCollectionNftUnit(out, wc.collectionPolicyId());
            if (nftUnit == null) {
                // No NFT under the configured policy → this isn't a listing
                // even though the datum decoded. Skip.
                log.debug("ListingEventsIndexer: output at {}#{} decodes ListingDatum but carries no NFT under policy {}; skipping",
                        out.getTxHash(), out.getOutputIndex(), wc.collectionPolicyId());
                continue;
            }

            BigInteger lovelace = out.getLovelaceAmount() != null
                    ? out.getLovelaceAmount() : BigInteger.ZERO;

            PendingCreate pc = new PendingCreate(out, d, nftUnit, lovelace, wc);
            createsByAddress.computeIfAbsent(addr, k -> new ArrayList<>()).add(pc);
        }

        if (spentByAddress.isEmpty() && createsByAddress.isEmpty()) {
            return;
        }

        byte[] txHashBytes = hexToBytesSafe(txHash);
        if (txHashBytes == null) {
            log.warn("ListingEventsIndexer: tx hash {} not decodable as hex; skipping", txHash);
            return;
        }

        // Pre-compute the set of script + treasury addresses for the
        // counterparty classifier. Everything else in the outputs is fair
        // game as a possible counterparty (= swapper for swap rows, lister
        // for cancel rows, admin for recover rows).
        Set<String> skipAddresses = new HashSet<>(registry.all());
        skipAddresses.addAll(registry.allTreasuryAddresses());

        // ---- 3. Per-address reconciliation. Swap = co-tx spend+create at the
        // same address; we pair them up. Pairing strategy: zip in order. If
        // the indexer ever sees a tx with multiple spends + multiple creates
        // at one address (e.g. batched swaps from multiple listings), the
        // pairing-by-position will misattribute lineages — but SPEC §6.3 S4's
        // unique-binding via compute_output_tag(own_ref) ensures the
        // validator forces a 1-to-1 pairing anyway. The DB representation
        // still satisfies the lineage invariant because we resolve each
        // successor's `update_ref_hash` independently at history-read time
        // via the by-update-ref index.
        for (Map.Entry<String, List<PendingCreate>> ce : createsByAddress.entrySet()) {
            String addr = ce.getKey();
            List<PendingCreate> creates = ce.getValue();
            List<ListingEventEntity> spends = spentByAddress.getOrDefault(addr, new ArrayList<>());

            int pairCount = Math.min(creates.size(), spends.size());
            for (int i = 0; i < pairCount; i++) {
                applySwap(spends.get(i), creates.get(i), outputs, skipAddresses, txHashBytes, slot, at);
            }
            for (int i = pairCount; i < creates.size(); i++) {
                applyGenesis(creates.get(i), txHashBytes, slot, at);
            }
            // Any leftover spends at this address (i.e. pairCount < spends)
            // are cancel/recover. They drop through to the "no matching
            // create" loop below (we strip the consumed ones now).
            if (pairCount > 0) {
                spends.subList(0, pairCount).clear();
            }
        }
        // ---- 4. Spends at addresses with no co-tx create at the SAME address
        // → cancel/recover. Includes the address-keyed leftovers above plus
        // any addresses present only in spends.
        for (Map.Entry<String, List<ListingEventEntity>> se : spentByAddress.entrySet()) {
            List<ListingEventEntity> remaining = se.getValue();
            if (remaining.isEmpty()) continue;
            // If the address has been consumed by pairing above the list is
            // already empty; otherwise these are terminal.
            for (ListingEventEntity row : remaining) {
                applyCancelOrRecover(row, outputs, skipAddresses, txHashBytes, slot, at);
            }
        }
    }

    // ---- helpers ----------------------------------------------------------

    private void applyGenesis(PendingCreate pc, byte[] txHashBytes, long slot, OffsetDateTime at) {
        AddressUtxo out = pc.out();
        byte[] outTxBytes = hexToBytesSafe(out.getTxHash());
        if (outTxBytes == null) {
            log.warn("ListingEventsIndexer: output txHash {} not hex; skipping genesis", out.getTxHash());
            return;
        }
        Integer outIdx = out.getOutputIndex();
        // Idempotency: skip if a row at this outref already exists.
        if (listingEventRepository.existsById(new ListingEventId(outTxBytes, outIdx))) {
            return;
        }
        ListingEventEntity row = ListingEventEntity.builder()
                .txHash(outTxBytes)
                .outputIndex(outIdx)
                .initialTxHash(outTxBytes)
                .initialOutputIndex(outIdx)
                .swapIndex(0)
                .configNftPolicy(hexToBytesSafe(pc.watched().configNftPolicy()))
                .listerPkh(pc.decoded().listerPkh())
                .nftUnit(pc.nftUnit())
                .lovelace(pc.lovelace().longValueExact())
                .updateRefHash(pc.decoded().updateRefHash()) // typically null for genesis
                .createdAtSlot(slot)
                .createdAt(at)
                .build();
        listingEventRepository.save(row);
        log.info("listing_events +genesis tx={} idx={} slug={}",
                hex(outTxBytes), outIdx, pc.watched().slug());
    }

    private void applySwap(ListingEventEntity prev, PendingCreate pc,
                           List<AddressUtxo> txOutputs, Set<String> skipAddresses,
                           byte[] txHashBytes,
                           long slot, OffsetDateTime at) {
        AddressUtxo out = pc.out();
        byte[] outTxBytes = hexToBytesSafe(out.getTxHash());
        if (outTxBytes == null) {
            log.warn("ListingEventsIndexer: output txHash {} not hex; skipping swap", out.getTxHash());
            return;
        }
        Integer outIdx = out.getOutputIndex();

        // Idempotency: if the successor row is already present, just ensure
        // the predecessor is marked spent and exit.
        boolean successorExists = listingEventRepository.existsById(new ListingEventId(outTxBytes, outIdx));

        if (!successorExists) {
            ListingEventEntity successor = ListingEventEntity.builder()
                    .txHash(outTxBytes)
                    .outputIndex(outIdx)
                    .initialTxHash(prev.getInitialTxHash())
                    .initialOutputIndex(prev.getInitialOutputIndex())
                    .swapIndex(prev.getSwapIndex() + 1)
                    .configNftPolicy(prev.getConfigNftPolicy())
                    .listerPkh(pc.decoded().listerPkh())
                    .nftUnit(pc.nftUnit())
                    .lovelace(pc.lovelace().longValueExact())
                    .updateRefHash(pc.decoded().updateRefHash())
                    .createdAtSlot(slot)
                    .createdAt(at)
                    .build();
            listingEventRepository.save(successor);
        }

        // The swapper is whoever owns the non-script, non-treasury outputs of
        // this tx — typically the wallet that submitted the swap. Strict
        // mode: only stamp when exactly one distinct payment credential
        // remains after skipping script + treasury outputs. Ambiguous tx
        // (split between two wallets, batchers, etc.) → NULL.
        byte[] swapperPkh = pickCounterpartyPkh(txOutputs, skipAddresses);

        prev.setSpentAction("swap");
        prev.setSpentAtSlot(slot);
        prev.setSpentAt(at);
        prev.setSpentByTxHash(txHashBytes);
        prev.setSwapperPkh(swapperPkh);
        listingEventRepository.save(prev);

        log.info("listing_events swap prev={}#{} succ={}#{} slug={} swapper={}",
                hex(prev.getTxHash()), prev.getOutputIndex(),
                hex(outTxBytes), outIdx, pc.watched().slug(),
                swapperPkh == null ? "<unknown>" : hex(swapperPkh));
    }

    private void applyCancelOrRecover(ListingEventEntity prev,
                                      List<AddressUtxo> txOutputs, Set<String> skipAddresses,
                                      byte[] txHashBytes,
                                      long slot, OffsetDateTime at) {
        // Classification heuristic (no redeemer access in AddressUtxoEvent):
        //   - any non-script/treasury output whose payment cred == listerPkh
        //     → 'cancel'. (Cancel sends ADA + NFT back to the lister.)
        //   - else any output whose payment cred == config.adminPkh
        //     → 'recover'. (Admin Rescue path.)
        //   - else → spent_unknown.
        // This is best-effort; ambiguous txes fall through to the sentinel.
        String listerPkhHex = HexUtil.encodeHexString(prev.getListerPkh()).toLowerCase(Locale.ROOT);
        WatchedCollection wc = findWatchedByConfigPolicy(prev.getConfigNftPolicy());
        String adminPkhHex = wc == null || wc.adminPkhHex() == null
                ? null : wc.adminPkhHex().toLowerCase(Locale.ROOT);

        String action = SPENT_UNKNOWN;
        boolean sawAdmin = false;
        if (txOutputs != null) {
            for (AddressUtxo out : txOutputs) {
                if (out == null) continue;
                if (skipAddresses.contains(out.getOwnerAddr())) continue;
                String cred = out.getOwnerPaymentCredential();
                if (cred == null) continue;
                String credLc = cred.toLowerCase(Locale.ROOT);
                if (credLc.equals(listerPkhHex)) {
                    action = "cancel";
                    break;
                }
                if (adminPkhHex != null && credLc.equals(adminPkhHex)) {
                    sawAdmin = true;
                }
            }
        }
        if (SPENT_UNKNOWN.equals(action) && sawAdmin) {
            action = "recover";
        }

        prev.setSpentAction(action);
        prev.setSpentAtSlot(slot);
        prev.setSpentAt(at);
        prev.setSpentByTxHash(txHashBytes);
        listingEventRepository.save(prev);
        log.info("listing_events {} prev={}#{}",
                action, hex(prev.getTxHash()), prev.getOutputIndex());
    }

    /**
     * Pick the single payment-credential hex string shared by all non-skip
     * outputs in the tx. Returns {@code null} if zero or >1 distinct
     * credentials remain — i.e., refuses to attribute on ambiguity.
     *
     * <p>Skip set = watched script addresses + treasury addresses (per
     * collection). Caller-supplied so we compute it once per tx.
     */
    private byte[] pickCounterpartyPkh(List<AddressUtxo> txOutputs, Set<String> skipAddresses) {
        if (txOutputs == null || txOutputs.isEmpty()) return null;
        String found = null;
        for (AddressUtxo out : txOutputs) {
            if (out == null) continue;
            if (out.getOwnerAddr() != null && skipAddresses.contains(out.getOwnerAddr())) continue;
            String cred = out.getOwnerPaymentCredential();
            if (cred == null || cred.isBlank()) continue;
            String credLc = cred.toLowerCase(Locale.ROOT);
            if (found == null) {
                found = credLc;
            } else if (!found.equals(credLc)) {
                return null; // ambiguous
            }
        }
        return found == null ? null : hexToBytesSafe(found);
    }

    /**
     * Find a WatchedCollection whose {@code configNftPolicy} matches the row.
     * Linear scan over the watch set; in v1 the set is small (handful of
     * curated collections) so this is cheap.
     */
    private WatchedCollection findWatchedByConfigPolicy(byte[] configNftPolicy) {
        if (configNftPolicy == null) return null;
        String policyHex = HexUtil.encodeHexString(configNftPolicy).toLowerCase(Locale.ROOT);
        for (String addr : registry.all()) {
            WatchedCollection wc = registry.get(addr);
            if (wc != null && policyHex.equalsIgnoreCase(wc.configNftPolicy())) {
                return wc;
            }
        }
        return null;
    }

    /**
     * Find the NFT (single 1-quantity asset under {@code collectionPolicyId})
     * in the output's value. Returns the {@code policy_id || asset_name} bytes
     * for the {@code listing_events.nft_unit} column, or null if the UTxO
     * fails the strict listing-shape filter from SPEC §10.2.
     *
     * <p>Strict filter (per SPEC §10.2):
     * <ul>
     *   <li>Exactly ONE non-ADA asset under {@code collection_policy_id}.</li>
     *   <li>That asset's quantity is exactly 1.</li>
     *   <li>That asset's name is non-empty and bounded (Cardano caps asset
     *       names at 32 bytes = 64 hex chars).</li>
     *   <li>No other non-ADA assets in the UTxO (no co-tenant tokens).</li>
     *   <li>Lovelace ≥ Cardano min-UTxO floor (we use a conservative 1 ADA
     *       — actual minUTxO depends on the output shape, so this is a lower
     *       bound; a Babbage-era listing carrying a single NFT + small datum
     *       can't go below ~1.5 ADA in practice).</li>
     * </ul>
     */
    private byte[] findCollectionNftUnit(AddressUtxo out, String collectionPolicyId) {
        if (out.getAmounts() == null || collectionPolicyId == null) return null;

        // Lovelace floor — defends against zero-ADA-quirk junk outputs.
        BigInteger lovelace = out.getLovelaceAmount() != null
                ? out.getLovelaceAmount() : BigInteger.ZERO;
        if (lovelace.compareTo(MIN_UTXO_LOVELACE) < 0) {
            return null;
        }

        Amt match = null;
        for (Amt a : out.getAmounts()) {
            if (a == null) continue;
            if (a.getPolicyId() == null) continue;
            // Skip the lovelace row (some yaci-store versions include it in amounts).
            if (a.getPolicyId().isEmpty()
                    || "lovelace".equalsIgnoreCase(a.getUnit())) continue;

            if (collectionPolicyId.equalsIgnoreCase(a.getPolicyId())) {
                // Quantity exactly 1.
                if (a.getQuantity() == null
                        || a.getQuantity().compareTo(BigInteger.ONE) != 0) {
                    return null;
                }
                // Asset name non-empty and within the 32-byte cap.
                String name = a.getAssetName();
                if (name == null || name.isEmpty() || name.length() > 64) {
                    return null;
                }
                // No co-tenant under the same policy.
                if (match != null) {
                    return null;
                }
                match = a;
            } else {
                // No other non-ADA assets allowed (no co-tenant of any other policy).
                return null;
            }
        }
        if (match == null) return null;

        String unit = match.getUnit();
        if (unit == null) {
            unit = match.getPolicyId() + (match.getAssetName() == null ? "" : match.getAssetName());
        }
        return hexToBytesSafe(unit);
    }

    /** Conservative lower bound on a listing UTxO's lovelace (~1 ADA). */
    private static final BigInteger MIN_UTXO_LOVELACE = BigInteger.valueOf(1_000_000L);

    private static byte[] hexToBytesSafe(String hex) {
        if (hex == null || hex.isEmpty()) return null;
        try {
            // Some yaci-store fields prepend `0x` historically; defensive strip.
            String h = hex.startsWith("0x") ? hex.substring(2) : hex;
            return HexUtil.decodeHexString(h);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String hex(byte[] b) {
        return b == null ? "<null>" : HexUtil.encodeHexString(b);
    }

    // ---- rollback ----------------------------------------------------------

    /**
     * Chain reorg handler. Yaci Store 2.x publishes {@link UtxoRollbackEvent}
     * when the upstream chain rolls back; the embedded
     * {@link com.bloxbean.cardano.yaci.store.events.RollbackEvent#getRollbackTo()}
     * point carries the slot to roll back to.
     *
     * <p>Behavior (per brief task 4):
     * <ul>
     *   <li>delete listing_events rows where {@code created_at_slot > rollbackSlot};</li>
     *   <li>reset {@code spent_*} columns to null where
     *       {@code spent_at_slot > rollbackSlot} on rows that survive the delete.</li>
     * </ul>
     *
     * <p>Correctness over speed — rollbacks are rare; we iterate in-app rather
     * than crafting bulk SQL.
     */
    @EventListener
    @Transactional
    public void onRollback(UtxoRollbackEvent event) {
        if (event == null || event.getRollbackEvent() == null
                || event.getRollbackEvent().getRollbackTo() == null) {
            return;
        }
        long rollbackSlot = event.getRollbackEvent().getRollbackTo().getSlot();
        log.warn("ListingEventsIndexer: rollback to slot {}; reconciling listing_events", rollbackSlot);

        List<ListingEventEntity> all = listingEventRepository.findAll();
        List<ListingEventEntity> toDelete = new ArrayList<>();
        List<ListingEventEntity> toUpdate = new ArrayList<>();
        for (ListingEventEntity row : all) {
            if (row.getCreatedAtSlot() != null && row.getCreatedAtSlot() > rollbackSlot) {
                toDelete.add(row);
                continue;
            }
            if (row.getSpentAtSlot() != null && row.getSpentAtSlot() > rollbackSlot) {
                row.setSpentAction(null);
                row.setSpentAtSlot(null);
                row.setSpentAt(null);
                row.setSpentByTxHash(null);
                toUpdate.add(row);
            }
        }
        if (!toDelete.isEmpty()) {
            listingEventRepository.deleteAll(toDelete);
            log.info("ListingEventsIndexer rollback: deleted {} rows", toDelete.size());
        }
        if (!toUpdate.isEmpty()) {
            listingEventRepository.saveAll(toUpdate);
            log.info("ListingEventsIndexer rollback: reset spent_* on {} rows", toUpdate.size());
        }
    }

    /** Output pending insertion. Bundled so we don't redo the work between the spend/create pair check and the actual insert. */
    private record PendingCreate(AddressUtxo out,
                                 DecodedListingDatum decoded,
                                 byte[] nftUnit,
                                 BigInteger lovelace,
                                 WatchedCollection watched) {
    }

    /* ------------------------------------------------------------------
     * Redeemer-driven refinement of spent_action.
     *
     * AddressUtxoEvent above handles lineage (genesis + swap pairing +
     * cancel/recover heuristic). This handler reads the actual Spend
     * redeemer from the witness set and overrides spent_action with the
     * authoritative value. Refines:
     *   - heuristic 'spent_unknown' → 'cancel' or 'recover' or 'swap'
     *   - heuristic mis-classification → corrected
     *
     * Per Conway/Plutus V3, redeemers reference inputs by their position
     * in the SORTED inputs set (lex by tx_hash, then output_index). We
     * sort yaci's Set<TransactionInput> canonically before matching.
     * ------------------------------------------------------------------ */

    @EventListener
    @Transactional
    public void onTransactionEvent(TransactionEvent event) {
        if (event == null || event.getTransactions() == null) return;
        if (registry.size() == 0) return;

        for (Transaction tx : event.getTransactions()) {
            try {
                refineSpendsFromRedeemer(tx);
            } catch (RuntimeException e) {
                log.error("listing_events (redeemer): error on tx {}: {}",
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
            byte[] prevTxHash = hexToBytesSafe(in.getTransactionId());
            if (prevTxHash == null) continue;
            Optional<ListingEventEntity> rowOpt = listingEventRepository
                    .findById(new ListingEventId(prevTxHash, in.getIndex()));
            if (rowOpt.isEmpty()) continue;
            ListingEventEntity row = rowOpt.get();

            int sortedIdx = SpendRedeemerExtractor.indexOfInput(sorted, in.getTransactionId(), in.getIndex());
            Optional<Redeemer> redeemerOpt = SpendRedeemerExtractor.spendRedeemerAt(tx.getWitnesses(), sortedIdx);
            if (redeemerOpt.isEmpty()) continue;
            Redeemer r = redeemerOpt.get();
            if (r.getData() == null || r.getData().getCbor() == null) continue;

            String action;
            try {
                ListingRedeemer red = listingRedeemerConverter.deserialize(r.getData().getCbor());
                if (red instanceof Swap) action = "swap";
                else if (red instanceof Cancel) action = "cancel";
                else if (red instanceof Recover) action = "recover";
                else action = SPENT_UNKNOWN;
            } catch (RuntimeException e) {
                // Not a listing redeemer (other script in this tx) — skip.
                log.debug("listing_events (redeemer): non-listing redeemer at {}#{}: {}",
                        in.getTransactionId(), in.getIndex(), e.getMessage());
                continue;
            }

            String previous = row.getSpentAction();
            if (action.equals(previous)) continue;

            row.setSpentAction(action);
            listingEventRepository.save(row);
            log.info("listing_events (redeemer): refined {}#{} {} -> {}",
                    in.getTransactionId(), in.getIndex(),
                    previous == null ? "<none>" : previous, action);
        }
    }
}
