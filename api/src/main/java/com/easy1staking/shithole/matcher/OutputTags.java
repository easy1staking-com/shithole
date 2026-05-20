package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;

import java.math.BigInteger;

/**
 * Byte-exact port of the {@code compute_output_tag(oref)} construction
 * shared between Aiken's {@code utils.compute_output_tag}, the FE's
 * {@code bucketMath.ts:serialiseOutputReference}, and
 * {@link com.easy1staking.shithole.tools.preprod.PreprodSwapTool#computeOutputTag}.
 *
 * <pre>
 *   compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))
 *   cbor.serialise(OutputReference) = Plutus-Data CBOR of Constr 0 [tx_id, idx]
 *       — indefinite-length array via tag 121 (compact alt 0) + 0x9f / 0xff.
 * </pre>
 *
 * <p>CCL's {@link ListPlutusData} serialiser defaults to {@code isChunked=true}
 * (= indefinite length), which matches Aiken's encoder. That property is
 * what makes the hashes line up across all three implementations; the test
 * vector in {@code OutputTagsTest} pins it.
 */
public final class OutputTags {

    private OutputTags() {}

    /**
     * CBOR-serialise an OutputReference exactly as Aiken's
     * {@code cbor.serialise} would. Used both as the input to
     * {@code blake2b_256} and on its own when callers need the raw
     * encoded bytes.
     */
    public static byte[] serializeOutRef(byte[] txHash, int outputIndex) {
        if (txHash == null || txHash.length != 32) {
            throw new IllegalArgumentException("txHash must be 32 bytes, got "
                    + (txHash == null ? "null" : Integer.toString(txHash.length)));
        }
        if (outputIndex < 0) {
            throw new IllegalArgumentException("outputIndex must be non-negative, got " + outputIndex);
        }
        ConstrPlutusData oref = ConstrPlutusData.of(0L,
                BytesPlutusData.of(txHash),
                BigIntPlutusData.of(BigInteger.valueOf(outputIndex)));
        return oref.serializeToBytes();
    }

    /** compute_output_tag(oref) = blake2b_256(cbor.serialise(oref)). */
    public static byte[] computeOutputTag(byte[] txHash, int outputIndex) {
        return Blake2bUtil.blake2bHash256(serializeOutRef(txHash, outputIndex));
    }
}
