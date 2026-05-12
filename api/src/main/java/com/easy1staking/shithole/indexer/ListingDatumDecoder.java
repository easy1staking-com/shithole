package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.common.cbor.CborSerializationUtil;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.util.HexUtil;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Partial decoder for the on-chain {@code ListingDatum} (SPEC §3.2).
 *
 * <p>The Aiken {@code listing} spend handler declares its datum as
 * {@code Option<Data>} so that the {@code Cancel} branch can recover the
 * lister's pkh via partial decode even when the rest of the datum is corrupt.
 * Aiken auto-wraps the value in {@code Option}, but on the wire the inline
 * datum is the raw {@code Data} value itself — present (= {@code Some(_)})
 * or absent (= {@code None}). Therefore on the BE we treat:
 *
 * <ul>
 *   <li>{@code inline_datum == null && data_hash == null} → datum is {@code None}
 *       (admin-recover candidate). NOT a listing — skip.</li>
 *   <li>{@code inline_datum != null} → try to decode as the inner
 *       {@code ListingDatum = Constr 0 [bytestring, Option<ByteArray>]}.
 *       If decode fails or shape is off, classify as junk and skip.</li>
 * </ul>
 *
 * <p>SPEC §10.2 calls this the "strict listing-shape filter" — only
 * well-shaped listings ever land in {@code listing_events}, so the table is
 * directly query-able as the live-curated view.
 *
 * <p>This class intentionally does not depend on the CCL-generated
 * {@code ListingDatum} model — that model does not exist (the listing
 * validator's datum schema in {@code plutus.json} is the raw {@code Data}
 * type, so the annotation processor emits no Java mirror). Decoding goes
 * through {@link ConstrPlutusData#deserialize} directly.
 */
@Component
public class ListingDatumDecoder {

    /**
     * Decode a hex-encoded inline datum as a {@code ListingDatum}.
     *
     * @param inlineDatumHex {@code AddressUtxo.inlineDatum} from yaci-store
     *                       (hex-encoded CBOR). May be null/blank.
     * @return decoded fields if the datum is a well-formed {@code ListingDatum};
     *         empty otherwise (null/blank input, decode failure, wrong shape).
     */
    public Optional<DecodedListingDatum> decode(String inlineDatumHex) {
        if (inlineDatumHex == null || inlineDatumHex.isBlank()) {
            return Optional.empty();
        }
        ConstrPlutusData constr;
        try {
            byte[] bytes = HexUtil.decodeHexString(inlineDatumHex);
            var di = CborSerializationUtil.deserialize(bytes);
            constr = ConstrPlutusData.deserialize(di);
        } catch (Exception e) {
            // Junk shape — not a Constr at all, or malformed CBOR.
            return Optional.empty();
        }

        if (constr.getAlternative() != 0) {
            return Optional.empty();
        }
        ListPlutusData fields = constr.getData();
        if (fields == null || fields.getPlutusDataList() == null || fields.getPlutusDataList().size() < 2) {
            return Optional.empty();
        }

        // Field 0: lister_pkh (ByteArray).
        PlutusData listerField = fields.getPlutusDataList().get(0);
        if (!(listerField instanceof BytesPlutusData listerBytes)) {
            return Optional.empty();
        }
        byte[] listerPkh = listerBytes.getValue();
        if (listerPkh == null) {
            return Optional.empty();
        }

        // Field 1: update_ref (Option<ByteArray>) — Constr 0 [bytes] = Some;
        // Constr 1 [] = None. Anything else is junk.
        PlutusData updateRefField = fields.getPlutusDataList().get(1);
        if (!(updateRefField instanceof ConstrPlutusData optConstr)) {
            return Optional.empty();
        }
        byte[] updateRefHash;
        if (optConstr.getAlternative() == 0) {
            // Some(bytes)
            ListPlutusData inner = optConstr.getData();
            if (inner == null || inner.getPlutusDataList() == null || inner.getPlutusDataList().isEmpty()) {
                return Optional.empty();
            }
            PlutusData hashField = inner.getPlutusDataList().get(0);
            if (!(hashField instanceof BytesPlutusData hashBytes)) {
                return Optional.empty();
            }
            updateRefHash = hashBytes.getValue();
            if (updateRefHash == null) {
                return Optional.empty();
            }
        } else if (optConstr.getAlternative() == 1) {
            // None
            updateRefHash = null;
        } else {
            return Optional.empty();
        }

        return Optional.of(new DecodedListingDatum(listerPkh, updateRefHash));
    }

    /**
     * Successfully-decoded {@code ListingDatum}. {@code updateRefHash} is null
     * when the datum's {@code update_ref} field is {@code None} (genesis
     * listing); otherwise it is the 32-byte
     * {@code compute_output_tag(prev_outref)} hash from a prior swap.
     */
    public record DecodedListingDatum(byte[] listerPkh, byte[] updateRefHash) {
    }
}
