package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.yaci.core.model.Datum;
import com.bloxbean.cardano.yaci.core.model.Redeemer;
import com.bloxbean.cardano.yaci.core.model.RedeemerTag;
import com.bloxbean.cardano.yaci.core.model.TransactionInput;
import com.bloxbean.cardano.yaci.core.model.Witnesses;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class SpendRedeemerExtractorTest {

    private static TransactionInput in(String txHash, int index) {
        return TransactionInput.builder().transactionId(txHash).index(index).build();
    }

    @Test
    void sortInputs_canonicalOrdering() {
        TransactionInput a = in("ab".repeat(32), 1);
        TransactionInput b = in("aa".repeat(32), 5);
        TransactionInput c = in("ab".repeat(32), 0);
        TransactionInput d = in("aa".repeat(32), 0);

        List<TransactionInput> sorted = SpendRedeemerExtractor.sortInputs(Set.of(a, b, c, d));

        assertThat(sorted).containsExactly(d, b, c, a);
    }

    @Test
    void indexOfInput_findsByCanonicalIndex() {
        List<TransactionInput> sorted = SpendRedeemerExtractor.sortInputs(Set.of(
                in("aa".repeat(32), 0),
                in("aa".repeat(32), 5),
                in("ab".repeat(32), 0),
                in("ab".repeat(32), 1)));

        assertThat(SpendRedeemerExtractor.indexOfInput(sorted, "aa".repeat(32), 0)).isZero();
        assertThat(SpendRedeemerExtractor.indexOfInput(sorted, "AB".repeat(32), 0)).isEqualTo(2);
        assertThat(SpendRedeemerExtractor.indexOfInput(sorted, "ff".repeat(32), 0)).isEqualTo(-1);
    }

    @Test
    void spendRedeemerAt_returnsMatchingRedeemerOrEmpty() {
        Redeemer spend0 = Redeemer.builder()
                .tag(RedeemerTag.Spend).index(0).data(Datum.builder().cbor("aa").build()).build();
        Redeemer mint0 = Redeemer.builder()
                .tag(RedeemerTag.Mint).index(0).data(Datum.builder().cbor("bb").build()).build();
        Redeemer spend1 = Redeemer.builder()
                .tag(RedeemerTag.Spend).index(1).data(Datum.builder().cbor("cc").build()).build();
        Witnesses w = Witnesses.builder().redeemers(List.of(spend0, mint0, spend1)).build();

        assertThat(SpendRedeemerExtractor.spendRedeemerAt(w, 0))
                .hasValueSatisfying(r -> assertThat(r.getData().getCbor()).isEqualTo("aa"));
        assertThat(SpendRedeemerExtractor.spendRedeemerAt(w, 1))
                .hasValueSatisfying(r -> assertThat(r.getData().getCbor()).isEqualTo("cc"));
        assertThat(SpendRedeemerExtractor.spendRedeemerAt(w, 2)).isEmpty();
        // Mint redeemer at the same index must not be returned for a Spend query.
        Witnesses onlyMint = Witnesses.builder().redeemers(List.of(mint0)).build();
        assertThat(SpendRedeemerExtractor.spendRedeemerAt(onlyMint, 0)).isEmpty();
    }
}
