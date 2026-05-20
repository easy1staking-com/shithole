package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.yaci.core.model.Redeemer;
import com.bloxbean.cardano.yaci.core.model.RedeemerTag;
import com.bloxbean.cardano.yaci.core.model.TransactionInput;
import com.bloxbean.cardano.yaci.core.model.Witnesses;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Helpers for matching a (tx_hash, output_index) reference against a
 * transaction's inputs in canonical Conway order, and pulling the
 * Spend-tagged redeemer whose index points at that input.
 *
 * <p>Conway / Plutus V3 redeemer indexing: redeemers in the witness set
 * carry {@code (tag, index)} where {@code tag = Spend} and {@code index}
 * is the position of the input in the SORTED inputs collection.
 * Lexicographic sort by serialized output reference = (tx_hash bytes,
 * output_index). Yaci's {@code TransactionBody.inputs} is a {@link Set}
 * (no guaranteed order), so we sort ourselves before matching.
 */
public final class SpendRedeemerExtractor {

    private static final Comparator<TransactionInput> CANONICAL_ORDER =
            Comparator.<TransactionInput, String>comparing(
                    in -> in.getTransactionId() == null
                            ? ""
                            : in.getTransactionId().toLowerCase(Locale.ROOT))
                    .thenComparingInt(TransactionInput::getIndex);

    private SpendRedeemerExtractor() {
    }

    /**
     * Sort inputs by canonical Conway order: (tx_hash hex ascending,
     * output_index ascending). Hex string lex order on lowercase hex is
     * equivalent to byte-lex order for fixed-length 32-byte hashes.
     */
    public static List<TransactionInput> sortInputs(Set<TransactionInput> inputs) {
        if (inputs == null || inputs.isEmpty()) return List.of();
        List<TransactionInput> sorted = new ArrayList<>(inputs);
        sorted.sort(CANONICAL_ORDER);
        return sorted;
    }

    /**
     * Position of an outref in the canonical input ordering, or {@code -1}
     * if not present. Used as the redeemer's {@code index} field.
     */
    public static int indexOfInput(List<TransactionInput> sorted, String txHashHex, int outputIndex) {
        if (sorted == null || txHashHex == null) return -1;
        String needle = txHashHex.toLowerCase(Locale.ROOT);
        for (int i = 0; i < sorted.size(); i++) {
            TransactionInput in = sorted.get(i);
            if (in == null || in.getTransactionId() == null) continue;
            if (in.getIndex() == outputIndex
                    && in.getTransactionId().toLowerCase(Locale.ROOT).equals(needle)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Return the Spend redeemer for the given sorted-input position, if
     * one exists in this transaction's witness set.
     */
    public static Optional<Redeemer> spendRedeemerAt(Witnesses witnesses, int sortedIndex) {
        if (witnesses == null || sortedIndex < 0) return Optional.empty();
        List<Redeemer> redeemers = witnesses.getRedeemers();
        if (redeemers == null || redeemers.isEmpty()) return Optional.empty();
        for (Redeemer r : redeemers) {
            if (r == null) continue;
            if (r.getTag() != RedeemerTag.Spend) continue;
            if (r.getIndex() == sortedIndex) return Optional.of(r);
        }
        return Optional.empty();
    }
}
