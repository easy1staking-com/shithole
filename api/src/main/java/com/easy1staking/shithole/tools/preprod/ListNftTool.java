package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.blockfrost.common.Constants;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.util.HexUtil;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * Operator tool: list one NFT from the test "dead collection" at the
 * curated config's listing-script address.
 *
 * <p>Builds a pay-to-script tx that:
 * <ul>
 *   <li>spends the wallet's UTxO holding the NFT,</li>
 *   <li>outputs to the listing-script address with the NFT + min-ADA,</li>
 *   <li>attaches inline datum {@code ListingDatum { lister_pkh, update_ref: None }}.</li>
 * </ul>
 *
 * <p>Aiken auto-wraps the Option at the validator level — on the wire the
 * inline datum is the bare {@code ListingDatum} (Constr 0). The BE
 * {@code ListingDatumDecoder} reads it in that shape.
 *
 * <p>Required env (source api/.env.preprod first):
 * <ul>
 *   <li>{@code ADMIN_SEED} — wallet seed.</li>
 *   <li>{@code BLOCKFROST_PROJECT_ID} — preprod project.</li>
 *   <li>{@code COLLECTION_POLICY_ID} — 56-hex policy id of the dead collection
 *       (the minted Shitter policy, e.g. {@code ae99e7f4...}).</li>
 *   <li>{@code LISTING_SCRIPT_ADDRESS} — bech32 of the listing-script address
 *       for the registered config (read from {@code curated_collections.listing_script_address}
 *       after registration).</li>
 * </ul>
 *
 * <p>Optional arg 1: asset name (default {@code Shitter000}).
 *
 * <p>Run: {@code ./gradlew preprodListNft --args="Shitter003"}
 */
public final class ListNftTool {

    private ListNftTool() {}

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");
        String policyHex = require("COLLECTION_POLICY_ID").toLowerCase();
        String listingScriptAddress = require("LISTING_SCRIPT_ADDRESS");
        String assetName = args.length > 0 ? args[0] : "Shitter000";

        Account account = new Account(Networks.preprod(), mnemonic);
        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);

        // 1. Build the ListingDatum: Constr 0 [lister_pkh: bytes, update_ref: None].
        //    update_ref is Option<ByteArray> — None on a genesis listing.
        byte[] listerPkh = account.hdKeyPair().getPublicKey().getKeyHash();
        PlutusData updateRefNone = ConstrPlutusData.of(1L /* None */);
        PlutusData listingDatum = ConstrPlutusData.of(
                0L /* ListingDatum */,
                BytesPlutusData.of(listerPkh),
                updateRefNone);

        // 2. Compute the asset unit (= policy_id_hex + asset_name_hex).
        String assetNameHex = HexUtil.encodeHexString(assetName.getBytes(StandardCharsets.UTF_8));
        String unit = policyHex + assetNameHex;

        // 3. Output: NFT + min-ADA (use 2 ADA as a conservative bound for the
        //    output shape — single NFT + ~50-byte inline datum + ADA on a
        //    Babbage-era output).
        Amount nftAmount = Amount.asset(unit, BigInteger.ONE);
        Amount minAda = Amount.ada(2);

        System.out.println("address          : " + account.baseAddress());
        System.out.println("lister pkh       : " + HexUtil.encodeHexString(listerPkh));
        System.out.println("asset            : " + assetName + " (" + unit + ")");
        System.out.println("listing script   : " + listingScriptAddress);
        System.out.println();

        // 4. Build + submit tx.
        Tx tx = new Tx()
                .payToContract(listingScriptAddress, List.of(nftAmount, minAda), listingDatum)
                .from(account.baseAddress());

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backend);
        var result = qtxBuilder.compose(tx)
                .feePayer(account.baseAddress())
                .withSigner(SignerProviders.signerFrom(account))
                .completeAndWait(Duration.ofMinutes(3),
                        msg -> System.out.println("[wait] " + msg));

        System.out.println();
        if (result.isSuccessful()) {
            System.out.println("tx hash          : " + result.getValue());
            System.out.println();
            System.out.println("==============================================================");
            System.out.println("Listed " + assetName + " at " + listingScriptAddress);
            System.out.println("Once Yaci syncs past this slot, the indexer should write a");
            System.out.println("genesis row to listing_events for (" + result.getValue() + "#0).");
            System.out.println("==============================================================");
        } else {
            System.err.println("list failed: " + result.getResponse());
            System.exit(1);
        }
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            System.err.println("Missing env var " + name + ". Source api/.env.preprod first.");
            System.exit(2);
        }
        return v;
    }
}
