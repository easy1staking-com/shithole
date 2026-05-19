package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.api.ProtocolParamsSupplier;
import com.bloxbean.cardano.client.api.UtxoSupplier;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.api.DefaultProtocolParamsSupplier;
import com.bloxbean.cardano.client.backend.api.DefaultUtxoSupplier;
import com.bloxbean.cardano.client.backend.blockfrost.common.Constants;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ConfigDatum;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ConfigDatumConverter;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver.AppliedWantedListing;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.vavr.collection.List;
import org.cardanofoundation.merkle.MerkleTree;
import org.cardanofoundation.merkle.ProofItem;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Locale;
import java.util.zip.GZIPInputStream;

/**
 * Operator tool — exercise the v3 Fulfill path on preprod end-to-end with
 * MAXIMUM diagnostic logging. Mirrors {@link PreprodSwapTool}'s structure
 * but for the v3 wanted_listing validator.
 *
 * <p>What it does, in order:
 * <ol>
 *   <li>Auto-discovers the registered v3 collection via {@code GET
 *       /api/curated}. Picks the first (or the slug from
 *       {@code FULFILL_SLUG} env).</li>
 *   <li>Derives the v3 wanted_listing script address via UPLC apply.</li>
 *   <li>Queries the BE for active p2p listings filtered by the target
 *       pool (env {@code FULFILL_POOL_TICKER}, default {@code EASY1}).
 *       Or by {@code FULFILL_LISTING}={@code tx_hash#index} when set.</li>
 *   <li>Reads the on-chain listing UTxO via Blockfrost — proves the BE
 *       and chain agree on the datum + bounty.</li>
 *   <li>Reads pools.json.gz from the classpath, builds the target pool's
 *       merkle tree LOCALLY, picks an asset_name from the wallet that's
 *       in that tree, generates a proof, and INDEPENDENTLY verifies
 *       it via {@link MerkleTree#verifyProof}. If the local proof fails
 *       to verify locally, we know the merkle pipeline is broken.</li>
 *   <li>Builds the Fulfill tx using CCL's QuickTx (proven for v2 swaps).
 *       compute_output_tag uses CCL's {@code ConstrPlutusData
 *       .serializeToBytes} which emits indefinite-length CBOR matching
 *       Aiken's {@code cbor.serialise}. Reuses
 *       {@link PreprodSwapTool#computeOutputTag} verbatim.</li>
 *   <li>Pre/post-balance hooks dump every output's value + flag negative
 *       multi-asset quantities — the tell-tale sign that input ≠ output
 *       on any asset, which breaks every evaluator.</li>
 *   <li>Submits via Ogmios for evaluation (same path swap uses;
 *       Blockfrost + Aiken JNI both choke on Conway-era CBOR shape).
 *       Failure mode at evaluation surfaces the exact validator branch
 *       that rejected.</li>
 * </ol>
 *
 * <p>Required env:
 * <pre>
 *   ADMIN_SEED               wallet seed (same one minted Hosky mimics)
 *   BLOCKFROST_PROJECT_ID    preprod blockfrost
 *   OGMIOS_URL               preprod ogmios endpoint
 *   BE_URL                   default http://localhost:8080
 *   FULFILL_POOL_TICKER      default EASY1
 *   FULFILL_SLUG             default = first curated
 *   FULFILL_LISTING          optional, "tx_hash#index" to target a specific listing
 *   FULFILL_DRY_RUN          default false — set "true" to skip submit
 * </pre>
 */
public final class PreprodFulfillP2pTool {

    private PreprodFulfillP2pTool() {
    }

    private static final String DEFAULT_BE_URL = "http://localhost:8080";
    private static final int MAX_UTXO_PAGES = 50;
    private static final int UTXO_PAGE_SIZE = 100;
    /** Buyer-output min-utxo floor; chain min is ~1.3 ADA, 1.5 ADA gives headroom. */
    private static final long BUYER_OUTPUT_MIN_LOVELACE = 1_500_000L;

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");
        String ogmiosUrl = require("OGMIOS_URL");
        String beUrl = envOrDefault("BE_URL", DEFAULT_BE_URL);
        String targetPoolTicker = envOrDefault("FULFILL_POOL_TICKER", "EASY1");
        String slugOverride = System.getenv("FULFILL_SLUG");
        String listingOverride = System.getenv("FULFILL_LISTING");
        boolean dryRun = "true".equalsIgnoreCase(envOrDefault("FULFILL_DRY_RUN", "false"));

        Account account = new Account(Networks.preprod(), mnemonic);
        String sellerAddress = account.baseAddress();
        byte[] sellerPkh = account.hdKeyPair().getPublicKey().getKeyHash();
        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);
        UtxoSupplier utxoSupplier = new DefaultUtxoSupplier(backend.getUtxoService());
        ProtocolParamsSupplier protocolParamsSupplier = new DefaultProtocolParamsSupplier(backend.getEpochService());

        System.out.println("=== preprod fulfill diagnostic ===");
        System.out.println("seller address   : " + sellerAddress);
        System.out.println("seller pkh       : " + HexUtil.encodeHexString(sellerPkh));
        System.out.println("BE               : " + beUrl);
        System.out.println("target pool      : " + targetPoolTicker);
        System.out.println("dry run          : " + dryRun);
        System.out.println();

        // 1. Pick the curated collection.
        JsonNode curated = httpGetJson(beUrl + "/api/curated");
        if (!curated.isArray() || curated.size() == 0) {
            die("no curated collections at " + beUrl);
        }
        String slug = slugOverride != null ? slugOverride : curated.get(0).path("slug").asText();
        System.out.println("slug             : " + slug);

        JsonNode collection = httpGetJson(beUrl + "/api/collections/" + urlEncode(slug));
        String configNftPolicy = collection.path("config_nft_policy").asText();
        String collectionPolicy = collection.path("collection_policy_id").asText();
        long protocolFee = collection.path("config").path("protocol_fee").asLong();
        System.out.println("config nft policy: " + configNftPolicy);
        System.out.println("collection policy: " + collectionPolicy);
        System.out.println("protocol_fee     : " + protocolFee + " lovelace");
        System.out.println();

        // 2. Derive wanted_listing script address.
        WantedListingScriptAddressDeriver deriver =
                new WantedListingScriptAddressDeriver(Networks.preprod());
        AppliedWantedListing applied = deriver.deriveApplied(configNftPolicy);
        System.out.println("wanted script    : " + applied.address());

        // 3. Get target pool's merkle_root_hex via BE.
        JsonNode poolJson = httpGetJson(beUrl + "/api/p2p/pools/" + urlEncode(targetPoolTicker));
        String targetRootHex = poolJson.path("merkle_root_hex").asText();
        System.out.println("target root      : " + targetRootHex);
        System.out.println();

        // 4. Pick the listing.
        JsonNode listing;
        if (listingOverride != null) {
            String[] parts = listingOverride.split("#");
            if (parts.length != 2) die("FULFILL_LISTING must be tx_hash#index");
            int idx = Integer.parseInt(parts[1]);
            // Have to fetch active list; no /by-outref endpoint yet.
            JsonNode all = httpGetJson(beUrl + "/api/p2p/listings?size=100");
            listing = streamFindListing(all, parts[0], idx);
            if (listing == null) die("listing not found in /api/p2p/listings: " + listingOverride);
        } else {
            JsonNode results = httpGetJson(
                    beUrl + "/api/p2p/listings?size=50&root=" + urlEncode(targetRootHex));
            if (!results.isArray() || results.size() == 0) {
                die("no active listings targeting " + targetPoolTicker + " — create one first");
            }
            listing = results.get(0);
        }
        String listingTx = listing.path("tx_hash").asText();
        int listingIdx = listing.path("output_index").asInt();
        String buyerBech32 = listing.path("buyer_address_bech32").asText();
        long bountyLovelace = listing.path("lovelace").asLong();
        String listingRoot = listing.path("accepted_merkle_root").asText();
        String offeredUnit = listing.path("offered_nft_unit").asText();

        System.out.println("listing outref   : " + listingTx + "#" + listingIdx);
        System.out.println("buyer bech32     : " + buyerBech32);
        System.out.println("bounty lovelace  : " + bountyLovelace + " (floor protocol_fee+2 ADA = "
                + (protocolFee + 2_000_000L) + ")");
        System.out.println("listing root     : " + listingRoot);
        System.out.println("offered unit     : " + offeredUnit);
        if (!listingRoot.equalsIgnoreCase(targetRootHex)) {
            die("listing's accepted_merkle_root != target pool's root; mismatch!");
        }
        System.out.println();

        // 5. Confirm the listing UTxO actually exists on-chain.
        Utxo listingUtxo = backend.getUtxoService()
                .getTxOutput(listingTx, listingIdx)
                .getValue();
        if (listingUtxo == null) {
            die("listing UTxO not found on-chain: " + listingTx + "#" + listingIdx);
        }
        System.out.println("on-chain listing : address=" + listingUtxo.getAddress()
                + " inline_datum_len=" + (listingUtxo.getInlineDatum() == null ? 0
                        : listingUtxo.getInlineDatum().length()));
        long onChainLovelace = listingUtxo.getAmount().stream()
                .filter(a -> "lovelace".equals(a.getUnit()))
                .map(Amount::getQuantity)
                .findFirst().orElse(BigInteger.ZERO).longValueExact();
        System.out.println("on-chain lovelace: " + onChainLovelace);
        if (onChainLovelace != bountyLovelace) {
            System.out.println("WARN: BE-indexed bounty != on-chain lovelace");
        }
        System.out.println();

        // 6. Pick a matching NFT in the wallet — load the target pool's
        //    asset_name set from pools.json.gz so we can pick locally.
        java.util.Set<String> poolAssetNames = loadPoolAssetNames(targetPoolTicker);
        System.out.println("pool asset count : " + poolAssetNames.size());

        SellerNft matched = findMatchingNftInWallet(
                backend, sellerAddress, collectionPolicy, poolAssetNames);
        if (matched == null) {
            die("no NFT in seller wallet from collection " + collectionPolicy
                    + " that matches the " + targetPoolTicker + " pool. wallet may need more NFTs.");
        }
        System.out.println("matched deposit  : " + matched.utf8Name() + " (hex "
                + matched.assetNameHex + ")");
        System.out.println("deposit utxo     : " + matched.utxo.getTxHash() + "#"
                + matched.utxo.getOutputIndex());
        System.out.println();

        // 7. Generate + locally verify the merkle proof.
        java.util.List<String> sortedNames = new ArrayList<>(poolAssetNames);
        java.util.Collections.sort(sortedNames);
        java.util.List<byte[]> leafBytes = sortedNames.stream()
                .map(HexUtil::decodeHexString)
                .toList();
        var tree = MerkleTree.fromList(leafBytes, b -> b);
        byte[] computedRoot = tree.itemHash();
        System.out.println("computed root    : " + HexUtil.encodeHexString(computedRoot));
        if (!HexUtil.encodeHexString(computedRoot).equalsIgnoreCase(targetRootHex)) {
            die("LOCAL ROOT MISMATCH with target pool's root — pools.json.gz drift");
        }

        byte[] assetNameBytes = HexUtil.decodeHexString(matched.assetNameHex);
        var proofOpt = MerkleTree.getProof(tree, assetNameBytes, b -> b);
        if (proofOpt.isEmpty()) {
            die("local getProof returned empty for asset " + matched.assetNameHex);
        }
        List<ProofItem> localProof = proofOpt.get();
        boolean localVerify = MerkleTree.verifyProof(
                computedRoot, assetNameBytes, localProof, b -> b);
        System.out.println("local proof len  : " + localProof.size());
        System.out.println("local verify     : " + localVerify);
        if (!localVerify) {
            die("local proof FAILED to verify — merkle library is broken or asset_name wrong");
        }

        // ALSO fetch BE's proof and verify byte-equality with local.
        JsonNode beProofJson = httpGetJson(beUrl + "/api/p2p/pools/"
                + urlEncode(targetRootHex) + "/proofs/" + urlEncode(matched.assetNameHex));
        java.util.List<ProofItem> beProof = parseProofFromJson(beProofJson);
        System.out.println("BE proof len     : " + beProof.size());
        boolean beVerify = MerkleTree.verifyProof(
                computedRoot, assetNameBytes, List.ofAll(beProof), b -> b);
        System.out.println("BE proof verify  : " + beVerify);
        if (!beVerify) {
            die("BE-served proof FAILED to verify locally — BE proof generation bug");
        }
        if (!proofByteEqual(localProof.toJavaList(), beProof)) {
            System.out.println("WARN: BE proof and local proof differ byte-for-byte (both verify though)");
        }
        System.out.println();

        // 8. Compute output tag for this listing.
        byte[] outputTag = PreprodSwapTool.computeOutputTag(
                HexUtil.decodeHexString(listingTx), listingIdx);
        System.out.println("output tag       : " + HexUtil.encodeHexString(outputTag));
        System.out.println();

        // 9. Build Fulfill redeemer = Constr 0 [List<ProofItem>, Option<Int>].
        //    Option<Int>: None when protocol_fee=0, Some(1) otherwise.
        ListPlutusData proofItems = ListPlutusData.of();
        for (ProofItem pi : beProof) {
            // aiken_merkle_tree library:
            //   ProofItem<a> = Left(Root) | Right(Root)
            //   Root = { inner: ByteArray }   (record → Constr 0 [bytes])
            // So wire shape per step is: Constr alt [Constr 0 [bytes]].
            // A bare Constr alt [bytes] fails validator decode at runtime
            // with "Expected the Constr constructor but got a different one".
            long alt = (pi instanceof ProofItem.Left) ? 0L : 1L;
            byte[] hash = (pi instanceof ProofItem.Left l) ? l.getHash()
                    : ((ProofItem.Right) pi).getHash();
            ConstrPlutusData rootWrap = ConstrPlutusData.of(0L, BytesPlutusData.of(hash));
            proofItems.add(ConstrPlutusData.of(alt, rootWrap));
        }
        PlutusData fulfillRedeemer;
        Integer treasuryOutputIndex;
        if (protocolFee > 0) {
            treasuryOutputIndex = 1; // buyer_output #0, treasury #1
            fulfillRedeemer = ConstrPlutusData.of(0L /* Fulfill */, proofItems,
                    ConstrPlutusData.of(0L /* Some */,
                            com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData.of(
                                    BigInteger.valueOf(treasuryOutputIndex))));
        } else {
            treasuryOutputIndex = null;
            fulfillRedeemer = ConstrPlutusData.of(0L /* Fulfill */, proofItems,
                    ConstrPlutusData.of(1L /* None */));
        }
        System.out.println("redeemer built (treasury_output_index="
                + (treasuryOutputIndex == null ? "None" : "Some(" + treasuryOutputIndex + ")") + ")");

        // 10. Buyer output inline datum = raw BytesPlutusData(outputTag).
        PlutusData buyerOutDatum = BytesPlutusData.of(outputTag);

        // 11. Find config UTxO for ref input.
        String configAddress = AddressProvider
                .getEntAddress(Credential.fromScript(configNftPolicy), Networks.preprod())
                .toBech32();
        Utxo configUtxo = findConfigUtxo(backend, configAddress, configNftPolicy);
        System.out.println("config utxo      : " + configUtxo.getTxHash() + "#"
                + configUtxo.getOutputIndex());
        ConfigDatum cfg = new ConfigDatumConverter().deserialize(configUtxo.getInlineDatum());
        System.out.println("config M         : " + cfg.getM().longValueExact());

        // 12. Build + submit.
        String depositUnit = collectionPolicy + matched.assetNameHex;
        Tx tx = new Tx()
                .readFrom(configUtxo)
                .collectFrom(listingUtxo, fulfillRedeemer)
                // Force the seller's deposit UTxO into the inputs so the
                // balancer doesn't pick an ADA-only one and leave change
                // with negative qty — same defense the v2 swap tool has.
                .collectFrom(java.util.List.of(matched.utxo))
                .payToContract(buyerBech32,
                        java.util.List.of(
                                Amount.asset(depositUnit, BigInteger.ONE),
                                Amount.lovelace(BigInteger.valueOf(BUYER_OUTPUT_MIN_LOVELACE))),
                        buyerOutDatum);
        if (treasuryOutputIndex != null) {
            String treasuryBech32 = invokeTreasuryDecode(cfg);
            tx = tx.payToContract(treasuryBech32,
                    java.util.List.of(Amount.lovelace(BigInteger.valueOf(protocolFee))),
                    buyerOutDatum);
        }
        tx = tx.attachSpendingValidator(applied.script())
                .from(sellerAddress);

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backend);
        // Ogmios evaluator (the v2-proven path; Blockfrost/Aiken choke on Conway CBOR).
        var ogmiosBackend = new com.bloxbean.cardano.client.backend.ogmios.http
                .OgmiosBackendService(ogmiosUrl);
        com.bloxbean.cardano.client.api.TransactionEvaluator innerEval =
                (cbor, inputUtxos) -> ogmiosBackend.getTransactionService().evaluateTx(cbor);

        var ctx = qtxBuilder.compose(tx)
                .feePayer(sellerAddress)
                .collateralPayer(sellerAddress)
                .withRequiredSigners(new Address(sellerAddress))
                .withSigner(SignerProviders.signerFrom(account))
                .mergeOutputs(false)
                .preBalanceTx((c, t) -> dumpOutputs("PRE-BALANCE", t))
                .postBalanceTx((c, t) -> dumpOutputs("POST-BALANCE", t));
        final var fixedInnerEval = innerEval;
        ctx = ctx.withTxEvaluator((cbor, inputUtxos) -> {
            System.out.println();
            System.out.println("EVAL tx cbor hex : " + HexUtil.encodeHexString(cbor));
            return fixedInnerEval.evaluateTx(cbor, inputUtxos);
        });

        if (dryRun) {
            // Build only, no submit. completeAndWait(...) is the submit path;
            // call .complete() and stop right after eval.
            System.out.println();
            System.out.println("DRY_RUN=true — eval only, will NOT submit");
            try {
                ctx.complete();
                System.out.println("eval+build SUCCESS");
            } catch (Exception e) {
                System.err.println("eval+build FAILED: " + e.getMessage());
                e.printStackTrace();
                System.exit(1);
            }
            return;
        }

        var result = ctx.completeAndWait(Duration.ofMinutes(3),
                msg -> System.out.println("[wait] " + msg));

        System.out.println();
        if (!result.isSuccessful()) {
            System.err.println("FULFILL FAILED: " + result.getResponse());
            System.exit(1);
        }
        System.out.println("tx hash          : " + result.getValue());
        System.out.println("FULFILL OK");
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers                                                                */
    /* ---------------------------------------------------------------------- */

    private static JsonNode httpGetJson(String url) throws Exception {
        HttpResponse<byte[]> resp = HTTP.send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        if (resp.statusCode() / 100 != 2) {
            throw new RuntimeException("GET " + url + " → " + resp.statusCode()
                    + ": " + new String(resp.body(), StandardCharsets.UTF_8));
        }
        return JSON.readTree(resp.body());
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static JsonNode streamFindListing(JsonNode arr, String tx, int idx) {
        if (!arr.isArray()) return null;
        for (JsonNode n : arr) {
            if (n.path("tx_hash").asText().equalsIgnoreCase(tx)
                    && n.path("output_index").asInt() == idx) {
                return n;
            }
        }
        return null;
    }

    private static java.util.List<ProofItem> parseProofFromJson(JsonNode root) {
        java.util.List<ProofItem> out = new ArrayList<>();
        JsonNode arr = root.path("proof");
        if (!arr.isArray()) return out;
        for (JsonNode step : arr) {
            String side = step.path("side").asText();
            byte[] hash = HexUtil.decodeHexString(step.path("hash_hex").asText());
            if ("left".equals(side)) {
                out.add(new ProofItem.Left(hash));
            } else if ("right".equals(side)) {
                out.add(new ProofItem.Right(hash));
            } else {
                throw new IllegalStateException("unknown proof side: " + side);
            }
        }
        return out;
    }

    private static boolean proofByteEqual(java.util.List<ProofItem> a, java.util.List<ProofItem> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            ProofItem x = a.get(i), y = b.get(i);
            if (x.getClass() != y.getClass()) return false;
            byte[] xh = (x instanceof ProofItem.Left l) ? l.getHash() : ((ProofItem.Right) x).getHash();
            byte[] yh = (y instanceof ProofItem.Left l) ? l.getHash() : ((ProofItem.Right) y).getHash();
            if (!java.util.Arrays.equals(xh, yh)) return false;
        }
        return true;
    }

    private static java.util.Set<String> loadPoolAssetNames(String ticker) throws IOException {
        ObjectMapper m = new ObjectMapper();
        java.util.Set<String> out = new java.util.HashSet<>();
        try (InputStream raw = Thread.currentThread().getContextClassLoader()
                .getResourceAsStream("p2p/pools.json.gz");
             InputStream in = new GZIPInputStream(raw)) {
            JsonNode root = m.readTree(in);
            for (JsonNode pool : root.path("pools")) {
                if (!ticker.equalsIgnoreCase(pool.path("ticker").asText())) continue;
                for (JsonNode name : pool.path("asset_names_hex")) {
                    out.add(name.asText().toLowerCase(Locale.ROOT));
                }
                return out;
            }
        }
        throw new RuntimeException("pool " + ticker + " not found in pools.json.gz");
    }

    private static SellerNft findMatchingNftInWallet(
            BackendService backend, String walletAddress, String collectionPolicy,
            java.util.Set<String> poolAssetNames) throws Exception {
        int page = 1;
        while (page <= MAX_UTXO_PAGES) {
            Result<java.util.List<Utxo>> result = backend.getUtxoService()
                    .getUtxos(walletAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            if (!result.isSuccessful()) {
                if (result.code() == 404) return null;
                throw new RuntimeException("blockfrost: " + result.code() + " " + result.getResponse());
            }
            java.util.List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) return null;
            for (Utxo u : batch) {
                if (u.getAmount() == null) continue;
                for (Amount a : u.getAmount()) {
                    if (a.getUnit() == null || a.getUnit().length() < 56) continue;
                    if (!a.getUnit().regionMatches(true, 0, collectionPolicy, 0, 56)) continue;
                    if (!BigInteger.ONE.equals(a.getQuantity())) continue;
                    String name = a.getUnit().substring(56).toLowerCase(Locale.ROOT);
                    if (!poolAssetNames.contains(name)) continue;
                    return new SellerNft(name, u);
                }
            }
            if (batch.size() < UTXO_PAGE_SIZE) return null;
            page++;
        }
        return null;
    }

    private static Utxo findConfigUtxo(BackendService backend, String configAddress, String policyHex)
            throws Exception {
        int page = 1;
        while (page <= MAX_UTXO_PAGES) {
            Result<java.util.List<Utxo>> result = backend.getUtxoService()
                    .getUtxos(configAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            if (!result.isSuccessful()) {
                if (result.code() == 404) break;
                throw new RuntimeException("blockfrost: " + result.code() + " " + result.getResponse());
            }
            java.util.List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) break;
            for (Utxo u : batch) {
                if (u.getInlineDatum() == null || u.getInlineDatum().isBlank()) continue;
                if (u.getAmount() == null) continue;
                for (Amount a : u.getAmount()) {
                    if (a.getUnit() == null || a.getUnit().length() < 56) continue;
                    if (a.getUnit().regionMatches(true, 0, policyHex, 0, 56)
                            && BigInteger.ONE.equals(a.getQuantity())) {
                        return u;
                    }
                }
            }
            if (batch.size() < UTXO_PAGE_SIZE) break;
            page++;
        }
        throw new RuntimeException("config UTxO not found at " + configAddress);
    }

    /** Reflectively call the package-private decodeTreasuryBech32 in PreprodSwapTool. */
    private static String invokeTreasuryDecode(ConfigDatum cfg) {
        try {
            var m = PreprodSwapTool.class.getDeclaredMethod("decodeTreasuryBech32", ConfigDatum.class);
            m.setAccessible(true);
            return (String) m.invoke(null, cfg);
        } catch (Exception e) {
            throw new RuntimeException("treasury decode failed", e);
        }
    }

    private static void dumpOutputs(String label,
            com.bloxbean.cardano.client.transaction.spec.Transaction txn) {
        System.out.println("---- " + label + " outputs (" + txn.getBody().getOutputs().size() + ") ----");
        int i = 0;
        for (var out : txn.getBody().getOutputs()) {
            var v = out.getValue();
            System.out.printf("  [%d] addr=%s coin=%s%n", i, out.getAddress(), v.getCoin());
            if (v.getMultiAssets() != null) {
                for (var ma : v.getMultiAssets()) {
                    for (var a : ma.getAssets()) {
                        BigInteger q = a.getValue();
                        String flag = (q != null && q.signum() < 0) ? "  <-- NEGATIVE!" : "";
                        System.out.printf("        policy=%s name=%s qty=%s%s%n",
                                ma.getPolicyId(), a.getName(), q, flag);
                    }
                }
            }
            if (out.getInlineDatum() != null) {
                System.out.println("        inline_datum: present");
            }
            i++;
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

    private static String envOrDefault(String name, String d) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? d : v;
    }

    private static void die(String msg) {
        System.err.println("ERROR: " + msg);
        System.exit(1);
    }

    private record SellerNft(String assetNameHex, Utxo utxo) {
        String utf8Name() {
            try {
                return new String(HexUtil.decodeHexString(assetNameHex), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "(hex)";
            }
        }
    }
}
