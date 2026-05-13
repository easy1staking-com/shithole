package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.api.exception.ApiException;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.blockfrost.common.Constants;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.metadata.Metadata;
import com.bloxbean.cardano.client.metadata.MetadataBuilder;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.transaction.spec.Asset;
import com.bloxbean.cardano.client.transaction.spec.script.RequireTimeBefore;
import com.bloxbean.cardano.client.transaction.spec.script.ScriptAll;
import com.bloxbean.cardano.client.transaction.spec.script.ScriptPubkey;
import com.bloxbean.cardano.client.util.HexUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.math.BigInteger;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Operator tool: mint a 10-NFT "fake dead collection" under a time-locked
 * one-shot native-script policy, with CIP-25 tx-metadata at label 721 so the
 * metadata indexers / wallets surface a name + image.
 *
 * <p>The policy:
 * <pre>
 *   ScriptAll [
 *     ScriptPubkey(adminPaymentKeyHash),
 *     RequireTimeBefore(currentSlot + 10 min)
 *   ]
 * </pre>
 *
 * <p>The 10-minute time-lock turns this into an effective one-shot — after the
 * deadline nobody can mint under this policy ever again, matching the
 * "dead collection" model the swap protocol targets.
 *
 * <p>Asset names: {@code Shitter000} .. {@code Shitter009}.
 *
 * <p>After the tx confirms, prints the policy id — copy it into the
 * curation form's {@code collection_policy_id} field. The asset name of the
 * config NFT will be this 28-byte policy id (per SPEC §3.1).
 *
 * <p>Run:
 * <pre>
 *   set -a; source api/.env.preprod; set +a
 *   cd api && ./gradlew preprodMintCollection
 * </pre>
 */
public final class MintCollectionTool {

    private MintCollectionTool() {}

    /** Asset name prefix. Collection-specific; change per run if you want a fresh policy. */
    private static final String ASSET_NAME_PREFIX = "Shitter";

    /** How many NFTs to mint. */
    private static final int COLLECTION_SIZE = 10;

    /** Mint deadline = current slot + 10 minutes. After this slot the policy is permanently locked. */
    private static final long MINT_WINDOW_SLOTS = 600;

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");

        Account account = new Account(Networks.preprod(), mnemonic);
        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);

        long currentSlot = backend.getBlockService().getLatestBlock().getValue().getSlot();
        long mintDeadline = currentSlot + MINT_WINDOW_SLOTS;
        // The mint tx itself must be valid before the deadline. Give ourselves a small
        // buffer so block timing doesn't push the tx past the policy's time-lock.
        long txValidTo = currentSlot + MINT_WINDOW_SLOTS - 60;

        // 1. Build the policy: requires admin sig + must be minted before deadline.
        String adminPkhHex = HexUtil.encodeHexString(
                account.hdKeyPair().getPublicKey().getKeyHash());
        ScriptAll policy = new ScriptAll();
        policy.addScript(new ScriptPubkey(adminPkhHex));
        policy.addScript(new RequireTimeBefore(mintDeadline));
        String policyId = policy.getPolicyId();

        System.out.println("admin pkh    : " + adminPkhHex);
        System.out.println("policy id    : " + policyId);
        System.out.println("mint deadline: slot " + mintDeadline + " (~10 min from now)");
        System.out.println("collection   : " + COLLECTION_SIZE + " NFTs, " + ASSET_NAME_PREFIX + "000..");
        System.out.println();

        // 2. Build assets + CIP-25 metadata (label 721).
        List<Asset> assets = new ArrayList<>(COLLECTION_SIZE);
        ObjectMapper jsonMapper = new ObjectMapper();
        ObjectNode root = jsonMapper.createObjectNode();
        ObjectNode label721 = jsonMapper.createObjectNode();
        ObjectNode policyMap = jsonMapper.createObjectNode();
        for (int i = 0; i < COLLECTION_SIZE; i++) {
            String name = ASSET_NAME_PREFIX + String.format("%03d", i);
            assets.add(Asset.builder()
                    .name(name)
                    .value(BigInteger.ONE)
                    .build());

            ObjectNode meta = jsonMapper.createObjectNode();
            meta.put("name", ASSET_NAME_PREFIX + " #" + i);
            meta.put("image",
                    "https://placehold.co/256x256/9C5F1F/FFF.png?text=" + ASSET_NAME_PREFIX + "+%23" + i);
            meta.put("mediaType", "image/png");
            meta.put("description", "A dead-collection test NFT for shithole preprod E2E.");
            policyMap.set(name, meta);
        }
        label721.set(policyId, policyMap);
        label721.put("version", 2);
        root.set("721", label721);

        Metadata metadata = MetadataBuilder.metadataFromJson(jsonMapper.writeValueAsString(root));

        // 3. Compose the tx: mint all 10 to the admin's base address, attach
        //    metadata, sign + submit.
        String adminAddress = account.baseAddress();
        Tx tx = new Tx()
                .mintAssets(policy, assets, adminAddress)
                .attachMetadata(metadata)
                .from(adminAddress);

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backend);
        var result = qtxBuilder.compose(tx)
                .feePayer(adminAddress)
                .validTo(txValidTo)
                .withSigner(SignerProviders.signerFrom(account))
                .completeAndWait(Duration.ofMinutes(3),
                        msg -> System.out.println("[wait] " + msg));

        System.out.println();
        if (result.isSuccessful()) {
            System.out.println("tx hash      : " + result.getValue());
            System.out.println();
            System.out.println("==============================================================");
            System.out.println("PASTE THIS INTO THE CURATION FORM'S collection_policy_id FIELD:");
            System.out.println("  " + policyId);
            System.out.println("==============================================================");
        } else {
            System.err.println("mint failed: " + result.getResponse());
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
