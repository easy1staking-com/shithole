package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.common.cbor.CborSerializationUtil;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.util.HexUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Partial decoder for the on-chain {@code WantedDatum} (v3 wanted-listing).
 *
 * <p>Shape (from {@code contracts/lib/shithole/types.ak}):
 * <pre>
 *   WantedDatum = Constr 0 [
 *     buyer_pkh:            ByteArray (28 bytes),
 *     buyer_address:        Address,
 *     accepted_merkle_root: ByteArray (32 bytes),
 *   ]
 *   Address = Constr 0 [payment_cred, stake_option]
 *     payment_cred = Constr 0 [bytes]  (VerificationKey) |
 *                    Constr 1 [bytes]  (Script)
 *     stake_option = Constr 0 [Constr 0 [cred]]  (Some(Inline(cred))) |
 *                    Constr 1 []                  (None)
 * </pre>
 *
 * <p>Bech32 re-encoding of {@code buyer_address} is done via
 * {@link AddressProvider} so the FE stores the canonical string form
 * (independent of how the on-chain datum chose to spell out the fields).
 *
 * <p>Mirrors the strict-shape-filter approach of
 * {@link ListingDatumDecoder}: any malformed input returns
 * {@link Optional#empty()} rather than throwing — the caller treats it as
 * "not a wanted-listing UTxO" and moves on.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WantedDatumDecoder {

    /** Inject the active network so bech32 re-encoding uses the right HRP. */
    private final Network appNetwork;

    public Optional<DecodedWantedDatum> decode(String inlineDatumHex) {
        if (inlineDatumHex == null || inlineDatumHex.isBlank()) {
            return Optional.empty();
        }
        ConstrPlutusData root;
        try {
            byte[] bytes = HexUtil.decodeHexString(inlineDatumHex);
            var di = CborSerializationUtil.deserialize(bytes);
            root = ConstrPlutusData.deserialize(di);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (root.getAlternative() != 0) return Optional.empty();
        ListPlutusData fields = root.getData();
        if (fields == null || fields.getPlutusDataList() == null
                || fields.getPlutusDataList().size() < 3) {
            return Optional.empty();
        }

        // Field 0: buyer_pkh.
        PlutusData pkhField = fields.getPlutusDataList().get(0);
        if (!(pkhField instanceof BytesPlutusData pkhBytes)) return Optional.empty();
        byte[] buyerPkh = pkhBytes.getValue();
        if (buyerPkh == null || buyerPkh.length != 28) return Optional.empty();

        // Field 1: buyer_address (Constr 0 [payment_cred, stake_option]).
        PlutusData addrField = fields.getPlutusDataList().get(1);
        if (!(addrField instanceof ConstrPlutusData addrConstr)
                || addrConstr.getAlternative() != 0) return Optional.empty();
        ListPlutusData addrFields = addrConstr.getData();
        if (addrFields == null || addrFields.getPlutusDataList() == null
                || addrFields.getPlutusDataList().size() < 2) return Optional.empty();
        String buyerBech32;
        try {
            Credential payment = decodeCredential(addrFields.getPlutusDataList().get(0));
            Credential stake = decodeStakeOption(addrFields.getPlutusDataList().get(1));
            Address addr = stake == null
                    ? AddressProvider.getEntAddress(payment, appNetwork)
                    : AddressProvider.getBaseAddress(payment, stake, appNetwork);
            buyerBech32 = addr.toBech32();
        } catch (Exception e) {
            // Malformed Address shape → skip the row.
            return Optional.empty();
        }

        // Field 2: accepted_merkle_root.
        PlutusData rootField = fields.getPlutusDataList().get(2);
        if (!(rootField instanceof BytesPlutusData rootBytes)) return Optional.empty();
        byte[] acceptedRoot = rootBytes.getValue();
        if (acceptedRoot == null || acceptedRoot.length != 32) return Optional.empty();

        return Optional.of(new DecodedWantedDatum(buyerPkh, buyerBech32, acceptedRoot));
    }

    /**
     * Decode an Aiken {@code Credential} (Constr 0 [bytes] = VerificationKey,
     * Constr 1 [bytes] = Script) into a CCL {@link Credential}.
     */
    private static Credential decodeCredential(PlutusData pd) {
        if (!(pd instanceof ConstrPlutusData c)) {
            throw new IllegalArgumentException("credential is not a Constr");
        }
        ListPlutusData inner = c.getData();
        if (inner == null || inner.getPlutusDataList() == null
                || inner.getPlutusDataList().isEmpty()) {
            throw new IllegalArgumentException("credential has no payload");
        }
        PlutusData hashField = inner.getPlutusDataList().get(0);
        if (!(hashField instanceof BytesPlutusData hashBytes)) {
            throw new IllegalArgumentException("credential hash is not bytes");
        }
        byte[] hash = hashBytes.getValue();
        if (c.getAlternative() == 0) {
            return Credential.fromKey(hash);
        } else if (c.getAlternative() == 1) {
            return Credential.fromScript(hash);
        }
        throw new IllegalArgumentException("unknown credential variant " + c.getAlternative());
    }

    /**
     * Decode the {@code Option<Referenced<Credential>>} stake field. Returns
     * the credential when {@code Some(Inline(cred))}; null when {@code None};
     * throws on any other shape ({@code Pointer} is unsupported — addresses
     * built off a Pointer ref are virtually unused on Cardano in practice).
     */
    private static Credential decodeStakeOption(PlutusData pd) {
        if (!(pd instanceof ConstrPlutusData opt)) {
            throw new IllegalArgumentException("stake option is not a Constr");
        }
        if (opt.getAlternative() == 1) {
            // None
            return null;
        }
        if (opt.getAlternative() != 0) {
            throw new IllegalArgumentException("unknown Option variant " + opt.getAlternative());
        }
        // Some(Inline(cred)) → Constr 0 [Constr 0 [cred]]
        ListPlutusData inner = opt.getData();
        if (inner == null || inner.getPlutusDataList() == null
                || inner.getPlutusDataList().isEmpty()) {
            throw new IllegalArgumentException("Some has no payload");
        }
        PlutusData refField = inner.getPlutusDataList().get(0);
        if (!(refField instanceof ConstrPlutusData refConstr)) {
            throw new IllegalArgumentException("Referenced is not a Constr");
        }
        if (refConstr.getAlternative() != 0) {
            // Pointer variant — unsupported.
            throw new IllegalArgumentException(
                    "unsupported stake Referenced variant " + refConstr.getAlternative());
        }
        ListPlutusData refInner = refConstr.getData();
        if (refInner == null || refInner.getPlutusDataList() == null
                || refInner.getPlutusDataList().isEmpty()) {
            throw new IllegalArgumentException("Inline has no credential");
        }
        return decodeCredential(refInner.getPlutusDataList().get(0));
    }

    /**
     * Successfully-decoded {@code WantedDatum}.
     * {@code buyerAddressBech32} is the re-encoded canonical bech32 form
     * (network HRP picked from the injected {@link Network} bean).
     */
    public record DecodedWantedDatum(
            byte[] buyerPkh,
            String buyerAddressBech32,
            byte[] acceptedMerkleRoot) {
    }
}
