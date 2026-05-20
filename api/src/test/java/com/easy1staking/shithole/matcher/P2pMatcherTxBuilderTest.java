package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.util.HexUtil;
import org.cardanofoundation.merkle.ProofItem;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the {@link P2pMatcherTxBuilder#buildFulfillRedeemer}
 * helper. The full builder requires a Blockfrost + Ogmios harness so it
 * stays as an integration TODO; the redeemer encoder is pure and pinned
 * here against the FE's expected wire shape (cross-check with
 * {@code web/src/lib/tx/__tests__/p2p.test.ts}).
 *
 * <p>Wire shape:
 * <pre>
 *   Fulfill = Constr 0 [List&lt;ProofItem&gt;, Option&lt;Int&gt;]
 *   ProofItem = Constr 0|1 [Root]
 *   Root = Constr 0 [bytes]    -- the aiken_merkle_tree Root record
 *   Option Some(idx) = Constr 0 [Int]
 *   Option None      = Constr 1 []
 * </pre>
 */
class P2pMatcherTxBuilderTest {

    private static final byte[] HASH_A = repeat((byte) 0x44, 32);
    private static final byte[] HASH_B = repeat((byte) 0x55, 32);

    @Test
    void buildFulfillRedeemer_someTreasury_leftProofStep() {
        PlutusData actual = P2pMatcherTxBuilder.buildFulfillRedeemer(
                List.of(new ProofItem.Left(HASH_A)), 1);

        // Expected: Constr 0 [ List [ Constr 0 [ Constr 0 [bytes] ] ], Constr 0 [Int 1] ]
        ListPlutusData proofList = ListPlutusData.of();
        proofList.add(ConstrPlutusData.of(0L,
                ConstrPlutusData.of(0L, BytesPlutusData.of(HASH_A))));
        PlutusData expected = ConstrPlutusData.of(0L,
                proofList,
                ConstrPlutusData.of(0L, BigIntPlutusData.of(BigInteger.ONE)));

        assertThat(HexUtil.encodeHexString(actual.serializeToBytes()))
                .isEqualTo(HexUtil.encodeHexString(expected.serializeToBytes()));
    }

    @Test
    void buildFulfillRedeemer_noneTreasury_rightProofStep() {
        PlutusData actual = P2pMatcherTxBuilder.buildFulfillRedeemer(
                List.of(new ProofItem.Right(HASH_B)), null);

        ListPlutusData proofList = ListPlutusData.of();
        proofList.add(ConstrPlutusData.of(1L,
                ConstrPlutusData.of(0L, BytesPlutusData.of(HASH_B))));
        PlutusData expected = ConstrPlutusData.of(0L,
                proofList,
                ConstrPlutusData.of(1L)); // None

        assertThat(HexUtil.encodeHexString(actual.serializeToBytes()))
                .isEqualTo(HexUtil.encodeHexString(expected.serializeToBytes()));
    }

    @Test
    void buildFulfillRedeemer_emptyProof_singleLeafTree() {
        PlutusData actual = P2pMatcherTxBuilder.buildFulfillRedeemer(List.of(), 3);

        ListPlutusData proofList = ListPlutusData.of();
        PlutusData expected = ConstrPlutusData.of(0L,
                proofList,
                ConstrPlutusData.of(0L, BigIntPlutusData.of(BigInteger.valueOf(3))));

        assertThat(HexUtil.encodeHexString(actual.serializeToBytes()))
                .isEqualTo(HexUtil.encodeHexString(expected.serializeToBytes()));
    }

    @Test
    void buildFulfillRedeemer_multiStepMixedProof_preservesOrder() {
        // (Right(A), Left(B)) — order matters in merkle proofs.
        PlutusData actual = P2pMatcherTxBuilder.buildFulfillRedeemer(
                List.of(new ProofItem.Right(HASH_A), new ProofItem.Left(HASH_B)), 0);

        ListPlutusData proofList = ListPlutusData.of();
        proofList.add(ConstrPlutusData.of(1L,
                ConstrPlutusData.of(0L, BytesPlutusData.of(HASH_A))));
        proofList.add(ConstrPlutusData.of(0L,
                ConstrPlutusData.of(0L, BytesPlutusData.of(HASH_B))));
        PlutusData expected = ConstrPlutusData.of(0L,
                proofList,
                ConstrPlutusData.of(0L, BigIntPlutusData.of(BigInteger.ZERO)));

        assertThat(HexUtil.encodeHexString(actual.serializeToBytes()))
                .isEqualTo(HexUtil.encodeHexString(expected.serializeToBytes()));
    }

    private static byte[] repeat(byte b, int n) {
        byte[] out = new byte[n];
        java.util.Arrays.fill(out, b);
        return out;
    }
}
