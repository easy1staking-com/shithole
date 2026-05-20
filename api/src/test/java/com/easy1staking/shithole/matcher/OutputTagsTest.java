package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.util.HexUtil;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Byte-equality tests for {@link OutputTags}. The load-bearing invariant
 * is that the Java encoder produces the EXACT same CBOR bytes as the FE's
 * {@code bucketMath.ts:serialiseOutputReference} — same as Aiken's
 * {@code cbor.serialise(OutputReference)} — so the {@code blake2b_256}
 * tag matches what the validator computes for {@code own_ref}.
 *
 * <p>Expected wire shape (from the FE's hand-built encoder):
 * <pre>
 *   D8 79                     -- CBOR tag 121 (Plutus Data Constr alt 0)
 *   9F                        -- indefinite-length array start
 *     58 20 &lt;32 bytes&gt;        -- ByteString(32) - tx_id
 *     &lt;int&gt;                   -- Integer - output_index
 *   FF                        -- break (close indef-len array)
 * </pre>
 */
class OutputTagsTest {

    /**
     * Test vector 1: tx_id = 32 zero bytes, output_index = 0 (single-byte
     * CBOR uint, just 0x00). Total bytes: D8 79 9F 58 20 [32x00] 00 FF.
     */
    @Test
    void serializeOutRef_zeroTxHashZeroIndex_matchesFeWireShape() {
        byte[] txHash = new byte[32];
        byte[] expected = concat(
                new byte[]{(byte) 0xd8, (byte) 0x79},   // tag 121
                new byte[]{(byte) 0x9f},                // indef array
                new byte[]{(byte) 0x58, 0x20},          // ByteString(32)
                new byte[32],                            // 32 zero bytes
                new byte[]{0x00},                        // uint 0 (single byte)
                new byte[]{(byte) 0xff}                  // break
        );
        byte[] actual = OutputTags.serializeOutRef(txHash, 0);
        assertThat(HexUtil.encodeHexString(actual))
                .isEqualTo(HexUtil.encodeHexString(expected));
    }

    /**
     * Test vector 2: tx_id = 32x AA, output_index = 5 (single byte 0x05,
     * since CBOR uint < 24 is direct). Anchors the small-int branch of
     * the FE encoder.
     */
    @Test
    void serializeOutRef_aaTxHashIndexFive_matchesFeWireShape() {
        byte[] txHash = new byte[32];
        java.util.Arrays.fill(txHash, (byte) 0xaa);
        byte[] expected = concat(
                new byte[]{(byte) 0xd8, (byte) 0x79},
                new byte[]{(byte) 0x9f},
                new byte[]{(byte) 0x58, 0x20},
                txHash,
                new byte[]{0x05},
                new byte[]{(byte) 0xff}
        );
        byte[] actual = OutputTags.serializeOutRef(txHash, 5);
        assertThat(HexUtil.encodeHexString(actual))
                .isEqualTo(HexUtil.encodeHexString(expected));
    }

    /**
     * Test vector 3: output_index = 24 (the boundary where CBOR uint
     * switches from one-byte direct encoding to {@code 0x18 nn}).
     * Catches off-by-one bugs in the int encoder.
     */
    @Test
    void serializeOutRef_indexTwentyFour_usesTwoByteCborUint() {
        byte[] txHash = new byte[32];
        byte[] expected = concat(
                new byte[]{(byte) 0xd8, (byte) 0x79},
                new byte[]{(byte) 0x9f},
                new byte[]{(byte) 0x58, 0x20},
                new byte[32],
                new byte[]{0x18, 0x18},  // CBOR uint 24 = 0x18 0x18
                new byte[]{(byte) 0xff}
        );
        byte[] actual = OutputTags.serializeOutRef(txHash, 24);
        assertThat(HexUtil.encodeHexString(actual))
                .isEqualTo(HexUtil.encodeHexString(expected));
    }

    /**
     * FE {@code encodeCborUInt} writes multi-byte indexes big-endian. This
     * catches little-endian drift in the Java path for non-trivial output
     * indexes even though real listing indexes are usually small.
     */
    @Test
    void serializeOutRef_largeIndex_usesBigEndianCborUint() {
        byte[] txHash = new byte[32];
        java.util.Arrays.fill(txHash, (byte) 0x11);
        byte[] expected = concat(
                new byte[]{(byte) 0xd8, (byte) 0x79},
                new byte[]{(byte) 0x9f},
                new byte[]{(byte) 0x58, 0x20},
                txHash,
                new byte[]{0x1a, 0x01, 0x02, 0x03, 0x04},
                new byte[]{(byte) 0xff}
        );
        byte[] actual = OutputTags.serializeOutRef(txHash, 0x01020304);
        assertThat(HexUtil.encodeHexString(actual))
                .isEqualTo(HexUtil.encodeHexString(expected));
    }

    /**
     * compute_output_tag = blake2b_256 of the CBOR bytes. Computed
     * independently via Blake2bUtil to anchor that the helper invokes
     * the right hash function (32-byte digest, not 28-byte).
     */
    @Test
    void computeOutputTag_isBlake2b256OfSerializedOutRef() {
        byte[] txHash = new byte[32];
        java.util.Arrays.fill(txHash, (byte) 0x42);
        byte[] cbor = OutputTags.serializeOutRef(txHash, 7);
        byte[] expected = Blake2bUtil.blake2bHash256(cbor);
        byte[] actual = OutputTags.computeOutputTag(txHash, 7);
        assertThat(actual).hasSize(32);
        assertThat(HexUtil.encodeHexString(actual))
                .isEqualTo(HexUtil.encodeHexString(expected));
    }

    @Test
    void serializeOutRef_rejectsNullTxHash() {
        assertThatThrownBy(() -> OutputTags.serializeOutRef(null, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void serializeOutRef_rejectsWrongLengthTxHash() {
        assertThatThrownBy(() -> OutputTags.serializeOutRef(new byte[28], 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void serializeOutRef_rejectsNegativeIndex() {
        assertThatThrownBy(() -> OutputTags.serializeOutRef(new byte[32], -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("non-negative");
    }

    private static byte[] concat(byte[]... arrays) {
        int n = 0;
        for (byte[] a : arrays) n += a.length;
        byte[] out = new byte[n];
        int p = 0;
        for (byte[] a : arrays) {
            System.arraycopy(a, 0, out, p, a.length);
            p += a.length;
        }
        return out;
    }
}
