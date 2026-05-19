package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Operator tool — mint 10 preprod NFTs with the EXACT asset_name bytes of
 * the first 10 mainnet Hosky CashGrab NFTs, so the wanted_listing merkle
 * proof + the wallet picker + the Fulfill / Reclaim flows can be exercised
 * end-to-end against the real on-chain merkle trees.
 *
 * <p><b>Why this is sound</b>: the wanted_listing validator pins to the
 * cfg's {@code collection_policy_id}, not the original mainnet policy. As
 * long as the asset_name BYTES match what's in the merkle leaf, the on-
 * chain {@code mt.is_member} check succeeds regardless of which policy
 * minted the asset. We mint under our own time-locked preprod policy, then
 * register a {@code POST /api/configs} pointing {@code collection_policy_id}
 * at that policy.
 *
 * <p>Policy: same shape as {@link MintCollectionTool}:
 * <pre>
 *   ScriptAll [
 *     ScriptPubkey(adminPaymentKeyHash),
 *     RequireTimeBefore(currentSlot + 10 min)
 *   ]
 * </pre>
 *
 * <p>Asset names: {@code HOSKYCashGrab000000001} .. {@code HOSKYCashGrab000000010}
 * (22 bytes ASCII). CIP-25 metadata mirrors the mainnet shape — same name,
 * image (IPFS URI), and traits list — read from
 * {@code .local/hosky-cashgrab-mainnet.json}.
 *
 * <p>Run:
 * <pre>
 *   set -a; source api/.env.preprod; set +a
 *   cd api && ./gradlew preprodMintHoskyMimic
 * </pre>
 */
public final class MintHoskyMimicTool {

    private MintHoskyMimicTool() {
    }

    /** Path is relative to the API module's working directory at task runtime. */
    private static final Path DEFAULT_FIXTURE =
            Path.of("../.local/hosky-cashgrab-mainnet.json");

    /** Mint deadline = current slot + 10 minutes. Mirror of MintCollectionTool. */
    private static final long MINT_WINDOW_SLOTS = 600;

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");
        Path fixturePath = Path.of(optional("HOSKY_FIXTURE", DEFAULT_FIXTURE.toString()));

        ObjectMapper json = new ObjectMapper();
        JsonNode fixture = json.readTree(Files.readAllBytes(fixturePath));
        JsonNode nftsNode = fixture.get("nfts");
        if (nftsNode == null || !nftsNode.isArray() || nftsNode.isEmpty()) {
            die("fixture " + fixturePath + " has no `nfts` array");
        }
        List<JsonNode> nfts = new ArrayList<>();
        nftsNode.forEach(nfts::add);
        System.out.println("loaded " + nfts.size() + " NFTs from " + fixturePath);

        Account account = new Account(Networks.preprod(), mnemonic);
        BackendService backend = new BFBackendService(
                Constants.BLOCKFROST_PREPROD_URL, projectId);

        long currentSlot = backend.getBlockService().getLatestBlock().getValue().getSlot();
        long mintDeadline = currentSlot + MINT_WINDOW_SLOTS;
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
        System.out.println();

        // 2. Build assets + CIP-25 metadata (label 721). Mirror mainnet shape
        //    exactly — same name, image, traits structure (list-of-single-key-
        //    dicts) — so the FE/wallet displays them identically.
        List<Asset> assets = new ArrayList<>(nfts.size());
        ObjectNode root = json.createObjectNode();
        ObjectNode label721 = json.createObjectNode();
        ObjectNode policyMap = json.createObjectNode();
        HexFormat hex = HexFormat.of();

        for (JsonNode nft : nfts) {
            String nameAscii = nft.get("asset_name").asText();
            String nameHex = nft.get("asset_name_hex").asText();
            // Sanity: the hex must encode the ascii. Catches a fixture-shape
            // drift before we commit funds to a malformed mint.
            String derivedHex = hex.formatHex(nameAscii.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            if (!derivedHex.equalsIgnoreCase(nameHex)) {
                die("fixture row name/hex mismatch: " + nameAscii + " → " + derivedHex
                        + " ≠ fixture hex " + nameHex);
            }

            assets.add(Asset.builder()
                    .name(nameAscii)
                    .value(BigInteger.ONE)
                    .build());

            ObjectNode meta = json.createObjectNode();
            meta.put("name", nft.get("display_name").asText());
            meta.put("image", nft.get("image").asText());
            meta.put("mediaType", "image/png");
            meta.put("description",
                    "Preprod mimic of a mainnet Hosky CashGrab for shithole v3 E2E. "
                            + "Asset_name bytes match the original; policy id differs.");

            // Preserve the mainnet traits structure verbatim (list of
            // single-key dicts). Wallets that auto-render CIP-25 traits will
            // show the same shape.
            JsonNode traits = nft.get("traits");
            if (traits != null && traits.isArray()) {
                ArrayNode out = json.createArrayNode();
                traits.forEach(out::add);
                meta.set("traits", out);
            }
            policyMap.set(nameAscii, meta);
        }
        label721.set(policyId, policyMap);
        label721.put("version", 2);
        root.set("721", label721);

        Metadata metadata = MetadataBuilder.metadataFromJson(json.writeValueAsString(root));

        // 3. Compose the tx: mint everything to admin's base address.
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
        if (!result.isSuccessful()) {
            System.err.println("mint failed: " + result.getResponse());
            System.exit(1);
        }

        System.out.println("tx hash      : " + result.getValue());
        System.out.println();
        System.out.println("==============================================================");
        System.out.println("CONFIG REGISTRATION INPUTS — paste into POST /api/configs:");
        System.out.println("  collection_policy_id = " + policyId);
        System.out.println("  admin pkh            = " + adminPkhHex);
        System.out.println("  admin address        = " + adminAddress);
        System.out.println();
        System.out.println("Minted asset_name_hex's (now in admin wallet):");
        for (JsonNode nft : nfts) {
            System.out.println("  " + nft.get("asset_name_hex").asText()
                    + "  (" + nft.get("asset_name").asText() + ")");
        }
        System.out.println("==============================================================");
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            System.err.println("Missing env var " + name + ". Source api/.env.preprod first.");
            System.exit(2);
        }
        return v;
    }

    private static String optional(String name, String defaultValue) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? defaultValue : v;
    }

    private static void die(String msg) {
        System.err.println("ERROR: " + msg);
        System.exit(1);
    }
}
