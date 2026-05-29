package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.common.cbor.CborSerializationUtil;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.util.HexUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigInteger;
import java.util.Optional;

/**
 * Partial decoder for the on-chain {@code MarketDatum}.
 *
 * <p>Shape (from {@code contracts/validators/marketplace.ak}):
 * <pre>
 *   MarketDatum = Constr 0 [
 *     seller_pkh:            ByteArray (28 bytes),
 *     seller_address:        Address,
 *     price_policy:          PolicyId  (28 bytes or empty for ADA),
 *     price_name:            AssetName (0..32 bytes),
 *     price_qty:             Int       (> 0),
 *     accompanying_lovelace: Int       (>= 0),
 *   ]
 *   Address = Constr 0 [payment_cred, stake_option]
 * </pre>
 *
 * <p>Mirrors {@link WantedDatumDecoder} — Address re-encoded to bech32
 * via {@link AddressProvider} on the injected {@link Network} so the FE
 * sees the canonical string form regardless of how the on-chain payload
 * spelled out the credentials.
 *
 * <p>Strict-shape filter: any malformed input returns
 * {@link Optional#empty()} so the caller can treat it as "not a market
 * listing" and skip the row.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MarketplaceDatumDecoder {

    private final Network appNetwork;

    public Optional<DecodedMarketDatum> decode(String inlineDatumHex) {
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
                || fields.getPlutusDataList().size() < 6) {
            return Optional.empty();
        }

        // Field 0: seller_pkh.
        PlutusData pkhField = fields.getPlutusDataList().get(0);
        if (!(pkhField instanceof BytesPlutusData pkhBytes)) return Optional.empty();
        byte[] sellerPkh = pkhBytes.getValue();
        if (sellerPkh == null || sellerPkh.length != 28) return Optional.empty();

        // Field 1: seller_address.
        PlutusData addrField = fields.getPlutusDataList().get(1);
        String sellerBech32 = decodeAddress(addrField);
        if (sellerBech32 == null) return Optional.empty();

        // Field 2: price_policy.
        PlutusData policyField = fields.getPlutusDataList().get(2);
        if (!(policyField instanceof BytesPlutusData policyBytes)) return Optional.empty();
        byte[] pricePolicy = policyBytes.getValue();
        if (pricePolicy == null) pricePolicy = new byte[0];

        // Field 3: price_name.
        PlutusData nameField = fields.getPlutusDataList().get(3);
        if (!(nameField instanceof BytesPlutusData nameBytes)) return Optional.empty();
        byte[] priceName = nameBytes.getValue();
        if (priceName == null) priceName = new byte[0];

        // Field 4: price_qty.
        PlutusData qtyField = fields.getPlutusDataList().get(4);
        if (!(qtyField instanceof BigIntPlutusData qtyData)) return Optional.empty();
        BigInteger priceQty = qtyData.getValue();
        if (priceQty == null || priceQty.signum() <= 0) return Optional.empty();

        // Field 5: accompanying_lovelace.
        PlutusData lvField = fields.getPlutusDataList().get(5);
        if (!(lvField instanceof BigIntPlutusData lvData)) return Optional.empty();
        BigInteger accompanying = lvData.getValue();
        if (accompanying == null || accompanying.signum() < 0) return Optional.empty();
        long accompanyingLong;
        try {
            accompanyingLong = accompanying.longValueExact();
        } catch (ArithmeticException e) {
            return Optional.empty();
        }

        return Optional.of(new DecodedMarketDatum(
                sellerPkh,
                sellerBech32,
                pricePolicy,
                priceName,
                priceQty,
                accompanyingLong));
    }

    /**
     * Decode an Aiken {@code Address} Constr into a bech32 string on the
     * injected network. Returns null on any malformed shape.
     */
    private String decodeAddress(PlutusData pd) {
        try {
            if (!(pd instanceof ConstrPlutusData addrConstr) || addrConstr.getAlternative() != 0) {
                return null;
            }
            ListPlutusData addrFields = addrConstr.getData();
            if (addrFields == null || addrFields.getPlutusDataList() == null
                    || addrFields.getPlutusDataList().size() < 2) {
                return null;
            }
            Credential payment = decodeCredential(addrFields.getPlutusDataList().get(0));
            Credential stake = decodeStakeOption(addrFields.getPlutusDataList().get(1));
            Address addr = stake == null
                    ? AddressProvider.getEntAddress(payment, appNetwork)
                    : AddressProvider.getBaseAddress(payment, stake, appNetwork);
            return addr.toBech32();
        } catch (Exception e) {
            return null;
        }
    }

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

    private static Credential decodeStakeOption(PlutusData pd) {
        if (!(pd instanceof ConstrPlutusData opt)) {
            throw new IllegalArgumentException("stake option is not a Constr");
        }
        if (opt.getAlternative() == 1) {
            return null; // None
        }
        if (opt.getAlternative() != 0) {
            throw new IllegalArgumentException("unknown Option variant " + opt.getAlternative());
        }
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
     * Successfully-decoded {@code MarketDatum}.
     * {@code sellerAddressBech32} is the re-encoded canonical bech32.
     * Both {@code pricePolicy} and {@code priceName} are empty byte
     * arrays for ADA-priced listings.
     */
    public record DecodedMarketDatum(
            byte[] sellerPkh,
            String sellerAddressBech32,
            byte[] pricePolicy,
            byte[] priceName,
            BigInteger priceQty,
            long accompanyingLovelace) {
    }
}
