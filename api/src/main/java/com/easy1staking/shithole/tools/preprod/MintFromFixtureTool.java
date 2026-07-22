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
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Operator tool — mint a realistic preprod NFT collection from a mainnet
 * fixture built by {@code scripts/mint/build-mainnet-fixture.py}.
 *
 * <p>This is the generalized successor to {@link MintHoskyMimicTool}. Instead
 * of reconstructing CIP-25 metadata, it embeds each asset's <b>raw CIP-25
 * inner object verbatim</b> (the fixture's {@code cip25} field) under a fresh
 * time-locked preprod policy. Names, IPFS images, {@code files[]},
 * {@code attributes}/{@code -----Traits-----}, website, description — all
 * preserved byte-for-byte, so wallets/marketplaces render the preprod assets
 * identically to mainnet. Falls back to a reconstructed shape for older
 * fixtures that predate the {@code cip25} field (e.g. hosky-cashgrab-mainnet.json).
 *
 * <p>Mints in <b>batches</b> ({@code BATCH_SIZE}, default 12) across multiple
 * txs so a few-dozen-asset collection stays under the 16 KB tx-size limit.
 * All batches share one policy id (bound to the admin pkh + a 10-minute
 * deadline computed at start), so a single run == a single preprod collection
 * policy. Run once per collection to get distinct policy ids.
 *
 * <p>Policy shape (mirrors the other preprod mint tools):
 * <pre>
 *   ScriptAll [ ScriptPubkey(adminPkh), RequireTimeBefore(currentSlot + 10 min) ]
 * </pre>
 *
 * <p>Env:
 * <ul>
 *   <li>{@code ADMIN_SEED} — preprod wallet mnemonic (required)</li>
 *   <li>{@code BLOCKFROST_PROJECT_ID} — preprod Blockfrost project (required)</li>
 *   <li>{@code FIXTURE} — path to the {@code .local/<slug>-mainnet.json} (required)</li>
 *   <li>{@code BATCH_SIZE} — assets per tx (optional, default 12)</li>
 * </ul>
 *
 * <p>Run:
 * <pre>
 *   set -a; source api/.env.preprod; set +a
 *   cd api && FIXTURE=../.local/gnomeskies-mainnet.json ./gradlew preprodMintFromFixture
 * </pre>
 */
public final class MintFromFixtureTool {

    private MintFromFixtureTool() {
    }

    /** Mint deadline = current slot + 10 minutes. Mirror of the other mint tools. */
    private static final long MINT_WINDOW_SLOTS = 600;
    private static final int DEFAULT_BATCH_SIZE = 12;
    /** Retry a batch that hit a stale-UTxO submit race (Blockfrost index lag). */
    private static final int SUBMIT_ATTEMPTS = 4;
    private static final Duration SUBMIT_RETRY_SLEEP = Duration.ofSeconds(15);
    private static final Duration INTER_BATCH_SLEEP = Duration.ofSeconds(8);

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");
        Path fixturePath = Path.of(require("FIXTURE"));
        int batchSize = parsePositiveInt(optional("BATCH_SIZE", String.valueOf(DEFAULT_BATCH_SIZE)));

        ObjectMapper json = new ObjectMapper();
        JsonNode fixture = json.readTree(Files.readAllBytes(fixturePath));
        String slug = fixture.path("slug").asText(stripExt(fixturePath.getFileName().toString()));
        JsonNode nftsNode = fixture.get("nfts");
        if (nftsNode == null || !nftsNode.isArray() || nftsNode.isEmpty()) {
            die("fixture " + fixturePath + " has no `nfts` array");
        }
        List<JsonNode> nfts = new ArrayList<>();
        nftsNode.forEach(nfts::add);
        System.out.println("slug         : " + slug);
        System.out.println("loaded       : " + nfts.size() + " NFTs from " + fixturePath);
        System.out.println("batch size   : " + batchSize);

        Account account = new Account(Networks.preprod(), mnemonic);
        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);
        String adminAddress = account.baseAddress();

        long currentSlot = backend.getBlockService().getLatestBlock().getValue().getSlot();
        long mintDeadline = currentSlot + MINT_WINDOW_SLOTS;
        long txValidTo = currentSlot + MINT_WINDOW_SLOTS - 60;

        String adminPkhHex = HexUtil.encodeHexString(account.hdKeyPair().getPublicKey().getKeyHash());
        ScriptAll policy = new ScriptAll();
        policy.addScript(new ScriptPubkey(adminPkhHex));
        policy.addScript(new RequireTimeBefore(mintDeadline));
        String policyId = policy.getPolicyId();

        System.out.println("admin pkh    : " + adminPkhHex);
        System.out.println("policy id    : " + policyId);
        System.out.println("mint deadline: slot " + mintDeadline + " (~10 min from now)");
        System.out.println();

        HexFormat hex = HexFormat.of();
        int nBatches = (nfts.size() + batchSize - 1) / batchSize;
        List<String> txHashes = new ArrayList<>();

        for (int b = 0; b < nBatches; b++) {
            int from = b * batchSize;
            int to = Math.min(from + batchSize, nfts.size());
            List<JsonNode> batch = nfts.subList(from, to);

            List<Asset> assets = new ArrayList<>(batch.size());
            ObjectNode root = json.createObjectNode();
            ObjectNode label721 = json.createObjectNode();
            ObjectNode policyMap = json.createObjectNode();

            for (JsonNode nft : batch) {
                String nameAscii = nft.get("asset_name").asText();
                String nameHex = nft.get("asset_name_hex").asText();
                // Sanity: hex must encode the ascii name — catches fixture drift
                // before we commit funds to a malformed mint.
                String derivedHex = hex.formatHex(nameAscii.getBytes(StandardCharsets.UTF_8));
                if (!derivedHex.equalsIgnoreCase(nameHex)) {
                    die("fixture row name/hex mismatch: " + nameAscii + " → " + derivedHex
                            + " ≠ fixture hex " + nameHex);
                }

                assets.add(Asset.builder().name(nameAscii).value(BigInteger.ONE).build());
                policyMap.set(nameAscii, buildMeta(json, nft));
            }
            label721.set(policyId, policyMap);
            label721.put("version", 1);
            root.set("721", label721);

            Metadata metadata = MetadataBuilder.metadataFromJson(json.writeValueAsString(root));

            System.out.printf("[batch %d/%d] minting %d assets (%s .. %s)%n",
                    b + 1, nBatches, batch.size(),
                    batch.get(0).get("asset_name").asText(),
                    batch.get(batch.size() - 1).get("asset_name").asText());

            // Blockfrost's UTxO index lags a few seconds behind confirmation, so
            // a freshly-built next batch can re-select the input the previous
            // batch just spent ("All inputs are spent"). Re-compose (which
            // re-queries UTxOs) with backoff until it lands.
            String txHash = null;
            for (int attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt++) {
                Tx tx = new Tx()
                        .mintAssets(policy, assets, adminAddress)
                        .attachMetadata(metadata)
                        .from(adminAddress);
                var result = new QuickTxBuilder(backend).compose(tx)
                        .feePayer(adminAddress)
                        .validTo(txValidTo)
                        .withSigner(SignerProviders.signerFrom(account))
                        .completeAndWait(Duration.ofMinutes(3),
                                msg -> System.out.println("  [wait] " + msg));
                if (result.isSuccessful()) {
                    txHash = result.getValue();
                    break;
                }
                String resp = String.valueOf(result.getResponse());
                boolean staleUtxo = resp.contains("All inputs are spent")
                        || resp.contains("BadInputsUTxO")
                        || resp.contains("ValueNotConserved");
                if (staleUtxo && attempt < SUBMIT_ATTEMPTS) {
                    System.out.println("  [retry] stale UTxO set (attempt " + attempt
                            + "), waiting " + SUBMIT_RETRY_SLEEP.toSeconds() + "s for the index to catch up…");
                    Thread.sleep(SUBMIT_RETRY_SLEEP.toMillis());
                    continue;
                }
                System.err.println("batch " + (b + 1) + " mint failed: " + resp);
                System.exit(1);
            }
            System.out.println("  tx hash: " + txHash);
            txHashes.add(txHash);

            // Give the index a head start before the next batch builds.
            if (b + 1 < nBatches) {
                Thread.sleep(INTER_BATCH_SLEEP.toMillis());
            }
        }

        System.out.println();
        System.out.println("==============================================================");
        System.out.println("MARKETPLACE COLLECTION SEED — add a row to api/marketplace_collections.csv:");
        System.out.println();
        System.out.println("  slug                 = " + slug);
        System.out.println("  collection_policy_id = " + policyId);
        System.out.println("  display_name         = " + slug);
        System.out.println("  admin pkh            = " + adminPkhHex);
        System.out.println("  minted assets        = " + nfts.size() + " across " + nBatches + " tx(s)");
        System.out.println();
        System.out.println("FE whitelist — add to PREPROD_COLLECTIONS in supportedCollections.ts:");
        System.out.println("  { label: \"" + slug + "\", policyId: \"" + policyId + "\" },");
        System.out.println();
        System.out.println("tx hashes:");
        txHashes.forEach(h -> System.out.println("  " + h));
        System.out.println("==============================================================");
    }

    /**
     * Prefer the raw CIP-25 object (embeds names/images/files/attributes/traits
     * verbatim). Fall back to a reconstructed shape for legacy fixtures.
     */
    private static JsonNode buildMeta(ObjectMapper json, JsonNode nft) {
        JsonNode raw = nft.get("cip25");
        if (raw != null && raw.isObject()) {
            return raw.deepCopy();
        }
        ObjectNode meta = json.createObjectNode();
        meta.put("name", nft.path("display_name").asText(nft.get("asset_name").asText()));
        if (nft.hasNonNull("image")) {
            meta.put("image", nft.get("image").asText());
        }
        meta.put("mediaType", "image/png");
        JsonNode traits = nft.get("traits");
        if (traits != null && traits.isArray()) {
            ArrayNode out = json.createArrayNode();
            traits.forEach(out::add);
            meta.set("traits", out);
        }
        return meta;
    }

    private static String stripExt(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot > 0 ? fileName.substring(0, dot) : fileName;
    }

    private static int parsePositiveInt(String v) {
        int n = Integer.parseInt(v.trim());
        if (n <= 0) {
            die("BATCH_SIZE must be > 0");
        }
        return n;
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            System.err.println("Missing env var " + name + ". Source api/.env.preprod and set FIXTURE.");
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
