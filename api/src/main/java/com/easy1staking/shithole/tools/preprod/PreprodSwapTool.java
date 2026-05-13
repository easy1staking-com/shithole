package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.aiken.AikenTransactionEvaluator;
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
import com.bloxbean.cardano.client.common.cbor.CborSerializationUtil;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusScript;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.spec.Era;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ConfigDatum;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ConfigDatumConverter;
import com.easy1staking.shithole.service.ListingScriptAddressDeriver;
import com.easy1staking.shithole.service.ListingScriptAddressDeriver.AppliedListing;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Operator tool: execute a real on-chain Swap against the deployed Shithole
 * protocol on preprod.
 *
 * <p>The swap pattern (SPEC §5.4 + §6.3):
 * <ul>
 *   <li>spend ONE existing listing UTxO at {@code LISTING_SCRIPT_ADDRESS}
 *       (the "NB" listing) with the {@code Swap} redeemer;</li>
 *   <li>recreate a successor listing at the same address holding an NFT from
 *       the swapper's wallet ("NA") + the consumed listing's accrued
 *       lovelace + {@code cfg.lister_fee}, plus an inline {@code ListingDatum}
 *       with the original lister's pkh and
 *       {@code update_ref = Some(compute_output_tag(consumed.outRef))};</li>
 *   <li>output to {@code config.treasury_addr_bech32} carrying
 *       {@code cfg.protocol_fee} + min-UTxO ADA, with the SAME
 *       {@code compute_output_tag(consumed.outRef)} as the inline datum (raw
 *       bytes — no wrapper);</li>
 *   <li>read the config UTxO at
 *       {@code Address(ScriptCredential(CONFIG_NFT_POLICY))} as a CIP-31
 *       reference input.</li>
 * </ul>
 *
 * <p>The validator's bucket equation (SPEC §7) requires:
 * <pre>
 *   blake2b_256(collection_policy ‖ NA_name) % M
 *     == blake2b_256(collection_policy ‖ NB_name ‖ cbor.serialise(consumed.outRef)) % M
 * </pre>
 * This tool enumerates (NA candidate, NB candidate) pairs across the
 * wallet × the pool and submits the first match. If no pair matches it
 * aborts loudly — the operator must mint more NFTs or wait for the pool to
 * grow (M ≈ N/3 is the SPEC §7.4 recommended ratio so coverage approaches
 * ~95%).
 *
 * <p>Required env (source api/.env.preprod first):
 * <ul>
 *   <li>{@code ADMIN_SEED} — wallet seed (signer + NA provider + fee payer).</li>
 *   <li>{@code BLOCKFROST_PROJECT_ID} — preprod project.</li>
 *   <li>{@code COLLECTION_POLICY_ID} — 56-hex policy id of the dead-collection
 *       NFT policy (= config NFT's asset name per SPEC §3.1 M3).</li>
 *   <li>{@code LISTING_SCRIPT_ADDRESS} — bech32 of the listing-script address
 *       for this collection's config (read from
 *       {@code curated_collections.listing_script_address}).</li>
 *   <li>{@code CONFIG_NFT_POLICY} — 56-hex policy id of the config NFT (=
 *       script hash of the config validator under SPEC §3.1; same as
 *       {@code configs.config_nft_policy}). Used to derive the config-UTxO
 *       script address + locate the config ref input.</li>
 * </ul>
 *
 * <p>Run:
 * <pre>
 *   set -a; source api/.env.preprod; set +a
 *   cd api && ./gradlew preprodSwap
 * </pre>
 */
public final class PreprodSwapTool {

    private PreprodSwapTool() {}

    /** Conservative min-UTxO lovelace for the treasury output (ADA + a tiny inline-datum tag). */
    private static final BigInteger TREASURY_MIN_UTXO_LOVELACE = BigInteger.valueOf(1_200_000L);

    /** Defensive page cap on each UTxO-list iteration. */
    private static final int MAX_UTXO_PAGES = 50;
    /** Blockfrost page size. */
    private static final int UTXO_PAGE_SIZE = 100;

    public static void main(String[] args) throws Exception {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");
        String collectionPolicyHex = require("COLLECTION_POLICY_ID").toLowerCase(Locale.ROOT);
        String listingScriptAddress = require("LISTING_SCRIPT_ADDRESS");
        String configNftPolicyHex = require("CONFIG_NFT_POLICY").toLowerCase(Locale.ROOT);

        if (!collectionPolicyHex.matches("^[0-9a-f]{56}$")) {
            die("COLLECTION_POLICY_ID must be 56 hex chars; got " + collectionPolicyHex);
        }
        if (!configNftPolicyHex.matches("^[0-9a-f]{56}$")) {
            die("CONFIG_NFT_POLICY must be 56 hex chars; got " + configNftPolicyHex);
        }

        Account account = new Account(Networks.preprod(), mnemonic);
        String swapperAddress = account.baseAddress();
        byte[] swapperPkh = account.hdKeyPair().getPublicKey().getKeyHash();

        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);
        UtxoSupplier utxoSupplier = new DefaultUtxoSupplier(backend.getUtxoService());
        ProtocolParamsSupplier protocolParamsSupplier = new DefaultProtocolParamsSupplier(backend.getEpochService());

        // ------------------------------------------------------------------
        // 1. Derive the listing script (applied) — same logic as the BE web flow.
        // ------------------------------------------------------------------
        ListingScriptAddressDeriver deriver = new ListingScriptAddressDeriver(Networks.preprod());
        AppliedListing applied = deriver.deriveApplied(configNftPolicyHex);
        if (!applied.address().equals(listingScriptAddress)) {
            die("LISTING_SCRIPT_ADDRESS env mismatches deriveApplied() output.\n"
                    + "  env       : " + listingScriptAddress + "\n"
                    + "  derived   : " + applied.address() + "\n"
                    + "Check CONFIG_NFT_POLICY corresponds to the registered config.");
        }
        System.out.println("swapper address  : " + swapperAddress);
        System.out.println("swapper pkh      : " + HexUtil.encodeHexString(swapperPkh));
        System.out.println("listing script   : " + listingScriptAddress);
        System.out.println("config nft policy: " + configNftPolicyHex);
        System.out.println("collection policy: " + collectionPolicyHex);
        System.out.println();

        // ------------------------------------------------------------------
        // 2. Locate the config UTxO at Address(ScriptCredential(CONFIG_NFT_POLICY)).
        //    Decode its ConfigDatum to learn M / fees / treasury address.
        // ------------------------------------------------------------------
        String configAddress = AddressProvider
                .getEntAddress(Credential.fromScript(configNftPolicyHex), Networks.preprod())
                .toBech32();
        Utxo configUtxo = findConfigUtxo(backend, configAddress, configNftPolicyHex);
        ConfigDatum cfg = new ConfigDatumConverter().deserialize(configUtxo.getInlineDatum());
        long m = cfg.getM().longValueExact();
        long protocolFee = cfg.getProtocolFee().longValueExact();
        long listerFee = cfg.getListerFee().longValueExact();
        String treasuryAddress = decodeTreasuryBech32(cfg);

        System.out.println("config utxo      : " + configUtxo.getTxHash() + "#" + configUtxo.getOutputIndex());
        System.out.println("config M         : " + m);
        System.out.println("protocol_fee     : " + protocolFee + " lovelace");
        System.out.println("lister_fee       : " + listerFee + " lovelace");
        System.out.println("treasury addr    : " + treasuryAddress);
        System.out.println();

        // ------------------------------------------------------------------
        // 3. Fetch the listing pool (well-formed listings at the listing
        //    address). Each pool entry yields an (assetName, outRef, lovelace,
        //    listerPkh) for bucket-target computation.
        // ------------------------------------------------------------------
        List<Listing> pool = fetchListingPool(backend, listingScriptAddress, collectionPolicyHex);
        if (pool.isEmpty()) {
            die("No well-formed listings at " + listingScriptAddress + " — "
                    + "run preprodListNft first to seed the pool.");
        }
        System.out.println("pool size N=" + pool.size() + " at M=" + m);

        // ------------------------------------------------------------------
        // 4. Fetch the swapper's wallet UTxOs that hold an NFT of the
        //    collection. Exclude assets already in the pool (NA must be in
        //    the wallet, not yet listed by us — though the validator does
        //    not enforce this, the swap would be silly).
        // ------------------------------------------------------------------
        Set<String> poolAssetNames = new HashSet<>();
        for (Listing l : pool) {
            poolAssetNames.add(l.assetNameHex.toLowerCase(Locale.ROOT));
        }
        List<NaCandidate> candidates = fetchNaCandidates(
                backend, swapperAddress, collectionPolicyHex, poolAssetNames);
        if (candidates.isEmpty()) {
            die("No NA candidates in wallet for collection " + collectionPolicyHex + ". "
                    + "Mint more NFTs (or unlist some) so the wallet holds an NFT "
                    + "of the collection that is NOT already in the pool.");
        }
        System.out.println("wallet candidates: " + candidates.size());
        System.out.println();

        // ------------------------------------------------------------------
        // 5. Find a (NA, NB) pair whose buckets match modulo M.
        // ------------------------------------------------------------------
        BucketMatch match = findBucketMatch(candidates, pool, collectionPolicyHex, m);
        if (match == null) {
            // Dump all buckets so the operator can see the distribution.
            byte[] policyBytes = HexUtil.decodeHexString(collectionPolicyHex);
            System.err.println("--- NA buckets (wallet) ---");
            for (NaCandidate c : candidates) {
                long b = bucketSelfMod(policyBytes, HexUtil.decodeHexString(c.assetNameHex), m);
                System.err.println("  " + c.assetName + " (hex " + c.assetNameHex + ") -> bucket " + b);
            }
            System.err.println("--- NB target buckets (pool) ---");
            for (Listing nb : pool) {
                byte[] outRefCbor = serializeOutRef(HexUtil.decodeHexString(nb.txHash), nb.outputIndex);
                long b = bucketTargetMod(policyBytes,
                        HexUtil.decodeHexString(nb.assetNameHex), outRefCbor, m);
                System.err.println("  " + nb.assetName + " (outref " + nb.txHash + "#" + nb.outputIndex
                        + ", cbor " + HexUtil.encodeHexString(outRefCbor) + ") -> bucket " + b);
            }
            die("No bucket match in M=" + m + " pool of N=" + pool.size()
                    + " with " + candidates.size() + " wallet candidates. "
                    + "Try a different M (admin re-config) or larger pool/wallet.");
        }
        System.out.println("=== bucket match (SPEC labels) ===");
        // SPEC §6.3: NA = consumed listing's asset name; NB = swapper's deposit
        // (= successor listing's asset name = redeemer.nb_asset_name).
        System.out.println("NA (consumed)    : " + match.nb.assetName + " (hex " + match.nb.assetNameHex + ")");
        System.out.println("NB (deposit)     : " + match.na.assetName + " (hex " + match.na.assetNameHex + ")");
        System.out.println("consumed outref  : " + match.nb.txHash + "#" + match.nb.outputIndex);
        System.out.println("bucket           : " + match.bucket + " / M=" + m);
        System.out.println();

        // ------------------------------------------------------------------
        // 6. Build the swap transaction.
        //   - ScriptTx: collectFrom(listing_NB, Swap redeemer) + the listing-
        //     successor output (idx 0) + treasury output (idx 1) +
        //     attachSpendingValidator(applied.script) + readFrom(config_utxo).
        //   - Tx: from(swapperAddress) — supplies NA + ADA fees, receives
        //     change (which includes the NB->NA swap delivery via change).
        //     Actually NA leaves the wallet; the consumed NB is REPLACED by
        //     NA in the successor listing. The swapper's wallet ends up with
        //     ONE LESS NA (now in successor listing) and the consumed
        //     listing's ADA minus protocol_fee minus lister_fee (since the
        //     successor carries input.lovelace + lister_fee, the swapper's
        //     net ADA contribution is: tx_fee + protocol_fee + lister_fee +
        //     min-UTxO bumps; nothing flowing back as NB).
        // ------------------------------------------------------------------
        byte[] consumedTxBytes = HexUtil.decodeHexString(match.nb.txHash);
        int consumedIdx = match.nb.outputIndex;
        byte[] outputTag = computeOutputTag(consumedTxBytes, consumedIdx);
        System.out.println("output tag       : " + HexUtil.encodeHexString(outputTag));

        // Successor listing's inline datum = ListingDatum {
        //     lister_pkh: <copied from consumed>,
        //     update_ref: Some(outputTag),
        // }
        // Constr 0 [bytes, Constr 0 [bytes]]
        PlutusData successorDatum = ConstrPlutusData.of(0L,
                BytesPlutusData.of(match.nb.listerPkh),
                ConstrPlutusData.of(0L /* Some */, BytesPlutusData.of(outputTag)));

        // Treasury inline datum = RAW BytesPlutusData(outputTag). On-chain
        // expects `InlineDatum(own_tag)` where own_tag is a ByteArray (not
        // wrapped in a Constr) — SPEC §4 + listing.ak S8.
        PlutusData treasuryDatum = BytesPlutusData.of(outputTag);

        // Swap redeemer via the CCL-generated SwapData/SwapConverter classes
        // (auto-emitted from plutus.json by the annotation processor). Strict
        // typing — no risk of swapping the Constr alternative or putting
        // fields in the wrong order. Byte-equivalent to a hand-built
        // ConstrPlutusData.of(0L, BytesPlutusData(...), BigIntPlutusData(0),
        // BigIntPlutusData(1)) but more refactor-safe if the Aiken type
        // changes shape.
        //
        // Per SPEC §6.3 S5: nb_asset_name = name of the asset in the successor
        // listing output = the swapper's deposit (= match.na in this tool's
        // legacy naming; see findBucketMatch for the inversion note).
        var swap = new com.easy1staking.shithole.blueprint.generated.shithole.types.model.listingredeemer.impl.SwapData();
        swap.setNbAssetName(HexUtil.decodeHexString(match.na.assetNameHex));
        swap.setListingOutputIndex(BigInteger.ZERO);
        swap.setTreasuryOutputIndex(BigInteger.ONE);
        PlutusData swapRedeemer =
                new com.easy1staking.shithole.blueprint.generated.shithole.types.model.listingredeemer.converter.SwapConverter()
                        .toPlutusData(swap);

        // Successor listing value: NA NFT + (consumed.lovelace + listerFee).
        long successorLovelace = match.nb.lovelace + listerFee;
        String naUnit = collectionPolicyHex + match.na.assetNameHex;
        String nbUnit = collectionPolicyHex + match.nb.assetNameHex;

        // Single-Tx pattern (the jpgstore-sniper recipe — simpler than
        // splitting into ScriptTx+Tx). The Plutus-locked listing input is
        // collected via `Tx.collectFrom(utxo, redeemer)`, the validator is
        // attached via `attachSpendingValidator`, and the two outputs are
        // payToContract calls in deterministic order: successor first (idx 0),
        // treasury second (idx 1). The Tx's `from()` provides the swapper's
        // NA + ADA inputs; CCL picks them.
        Tx tx = new Tx()
                // CIP-31 ref input: config UTxO. Never spent.
                .readFrom(configUtxo)
                // S2: consumed listing input (carries NB). Spend with Swap redeemer.
                .collectFrom(match.nb.utxo, swapRedeemer)
                // Force the swapper's NA-holding UTxO into the inputs. CCL's
                // auto-selector ranks by ADA value and won't reliably pick the
                // NFT-bearing UTxO; without this the change ends up with a
                // negative NA quantity (input has NA=0, output has NA=1, so
                // change = -1) which makes every evaluator reject the tx CBOR.
                .collectFrom(List.of(match.na.utxo))
                // S3+S4+S5+S6: successor listing at the same script address. Index 0.
                .payToContract(listingScriptAddress,
                        List.of(
                                Amount.asset(naUnit, BigInteger.ONE),
                                Amount.lovelace(BigInteger.valueOf(successorLovelace))),
                        successorDatum)
                // S7+S8+S9: treasury output. Index 1.
                .payToContract(treasuryAddress,
                        List.of(Amount.lovelace(
                                BigInteger.valueOf(protocolFee).max(TREASURY_MIN_UTXO_LOVELACE))),
                        treasuryDatum)
                .attachSpendingValidator(applied.script())
                .from(swapperAddress);

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backend);
        // Evaluator selection. Default: Ogmios at OGMIOS_URL — the local
        // aiken-java-binding evaluator + Blockfrost's /utils/txs/evaluate
        // both choke on the Conway-era CBOR shape CCL emits (hybrid set tags
        // + legacy redeemer-map). Ogmios v6 handles it cleanly. Switch via
        // PREPROD_SWAP_EVALUATOR=aiken|blockfrost|ogmios.
        String evaluatorChoice = System.getenv().getOrDefault("PREPROD_SWAP_EVALUATOR", "ogmios")
                .toLowerCase(Locale.ROOT);
        com.bloxbean.cardano.client.api.TransactionEvaluator inner;
        switch (evaluatorChoice) {
            case "aiken" -> {
                System.out.println("evaluator        : aiken (JNI, local)");
                inner = new AikenTransactionEvaluator(utxoSupplier, protocolParamsSupplier);
            }
            case "blockfrost" -> {
                System.out.println("evaluator        : blockfrost (remote)");
                inner = (cbor, inputUtxos) -> backend.getTransactionService().evaluateTx(cbor);
            }
            case "ogmios" -> {
                String ogmiosUrl = require("OGMIOS_URL");
                System.out.println("evaluator        : ogmios @ " + ogmiosUrl);
                var ogmiosBackend = new com.bloxbean.cardano.client.backend.ogmios.http.OgmiosBackendService(ogmiosUrl);
                inner = (cbor, inputUtxos) -> ogmiosBackend.getTransactionService().evaluateTx(cbor);
            }
            default -> {
                die("Unsupported PREPROD_SWAP_EVALUATOR=" + evaluatorChoice
                        + " (expected aiken | blockfrost | ogmios)");
                return; // unreachable; satisfies definite-assignment
            }
        }
        var ctx = qtxBuilder.compose(tx)
                .feePayer(swapperAddress)
                .collateralPayer(swapperAddress)
                .withRequiredSigners(new Address(swapperAddress))
                .withSigner(SignerProviders.signerFrom(account))
                .mergeOutputs(false)
                // Pre-balance hook: log every output's value (lovelace +
                // multiasset) and flag any negative quantity, which is the
                // tell-tale sign the tx builder thinks more of an asset went
                // out than in. The hook runs BEFORE the balancer fixes the
                // change, so seeing a negative here doesn't yet mean a bug —
                // but if a negative SURVIVES post-balance, that's a real
                // balance-calculation error.
                .preBalanceTx((txCtx, txn) -> dumpOutputs("PRE-BALANCE", txn))
                .postBalanceTx((txCtx, txn) -> dumpOutputs("POST-BALANCE", txn));
        final var innerEvaluator = inner;
        ctx = ctx.withTxEvaluator(new com.bloxbean.cardano.client.api.TransactionEvaluator() {
            @Override
            public com.bloxbean.cardano.client.api.model.Result<java.util.List<com.bloxbean.cardano.client.api.model.EvaluationResult>>
                    evaluateTx(byte[] cbor,
                            java.util.Set<com.bloxbean.cardano.client.api.model.Utxo> inputUtxos)
                    throws com.bloxbean.cardano.client.api.exception.ApiException {
                System.out.println("EVAL tx cbor hex : " + HexUtil.encodeHexString(cbor));
                return innerEvaluator.evaluateTx(cbor, inputUtxos);
            }
        });
        var result = ctx.completeAndWait(Duration.ofMinutes(3),
                msg -> System.out.println("[wait] " + msg));

        System.out.println();
        if (!result.isSuccessful()) {
            System.err.println("swap failed: " + result.getResponse());
            System.exit(1);
        }

        String txHash = result.getValue();
        System.out.println("tx hash          : " + txHash);
        System.out.println("successor outref : " + txHash + "#0");
        System.out.println();
        System.out.println("==============================================================");
        System.out.println("Swap landed. Tail the BE indexer log and look for:");
        System.out.println("  ListingEventsIndexer  ... +swap  (consumed=" + match.nb.txHash + "#" + match.nb.outputIndex + ")");
        System.out.println("  ListingEventsIndexer  ... +genesis-like row for the successor");
        System.out.println("  (BE writes BOTH rows: prev.spent_action='swap', successor.swap_index=prev.swap_index+1)");
        System.out.println("==============================================================");
    }

    // ---------------------------------------------------------------------
    // Config UTxO discovery
    // ---------------------------------------------------------------------

    private static Utxo findConfigUtxo(BackendService backend, String configAddress, String policyHex)
            throws Exception {
        // The config NFT has asset name = collection_policy_id (28 bytes per
        // SPEC §3.1 M3). Find the first UTxO at configAddress holding an
        // asset under our config_nft_policy with quantity 1 + an inline datum.
        List<Utxo> hits = new ArrayList<>();
        int page = 1;
        while (page <= MAX_UTXO_PAGES) {
            Result<List<Utxo>> result = backend.getUtxoService()
                    .getUtxos(configAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            if (!result.isSuccessful()) {
                if (result.code() == 404) break;
                throw new RuntimeException("blockfrost getUtxos failed for " + configAddress
                        + ": " + result.code() + " " + result.getResponse());
            }
            List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) break;
            for (Utxo u : batch) {
                if (u.getInlineDatum() == null || u.getInlineDatum().isBlank()) continue;
                if (u.getAmount() == null) continue;
                for (Amount a : u.getAmount()) {
                    if (a.getUnit() == null || a.getUnit().length() < 56) continue;
                    if (!a.getUnit().regionMatches(true, 0, policyHex, 0, 56)) continue;
                    if (BigInteger.ONE.equals(a.getQuantity())) {
                        hits.add(u);
                        break;
                    }
                }
            }
            if (batch.size() < UTXO_PAGE_SIZE) break;
            page++;
        }
        if (hits.isEmpty()) {
            die("Config UTxO not found at " + configAddress + " for policy " + policyHex
                    + ". Did the config get minted?");
        }
        if (hits.size() > 1) {
            die("Multiple UTxOs at config address carrying policy " + policyHex
                    + " — chain-impossible for a one-shot mint. Aborting.");
        }
        return hits.get(0);
    }

    // ---------------------------------------------------------------------
    // Listing pool fetch + decode
    // ---------------------------------------------------------------------

    /**
     * Page through Blockfrost at {@code listingScriptAddress}, return every
     * UTxO whose value carries exactly one NFT under {@code collectionPolicy}
     * + ADA and whose inline datum decodes as a {@code ListingDatum}.
     */
    private static List<Listing> fetchListingPool(
            BackendService backend, String listingScriptAddress, String collectionPolicy)
            throws Exception {
        List<Listing> pool = new ArrayList<>();
        int page = 1;
        while (page <= MAX_UTXO_PAGES) {
            Result<List<Utxo>> result = backend.getUtxoService()
                    .getUtxos(listingScriptAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            if (!result.isSuccessful()) {
                if (result.code() == 404) break;
                throw new RuntimeException("blockfrost getUtxos failed for " + listingScriptAddress
                        + ": " + result.code() + " " + result.getResponse());
            }
            List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) break;
            for (Utxo u : batch) {
                Listing l = tryDecodeListing(u, collectionPolicy);
                if (l != null) pool.add(l);
            }
            if (batch.size() < UTXO_PAGE_SIZE) break;
            page++;
        }
        return pool;
    }

    /**
     * Strict listing-shape filter (mirrors SPEC §10.2 + the BE's
     * {@code ListingDatumDecoder}). Returns null if the UTxO is junk.
     */
    private static Listing tryDecodeListing(Utxo u, String collectionPolicy) {
        if (u.getInlineDatum() == null || u.getInlineDatum().isBlank()) return null;
        if (u.getAmount() == null) return null;

        // Decode datum as Constr 0 [bytes (lister_pkh), Option<bytes> (update_ref)].
        ConstrPlutusData constr;
        try {
            var di = CborSerializationUtil.deserialize(HexUtil.decodeHexString(u.getInlineDatum()));
            constr = ConstrPlutusData.deserialize(di);
        } catch (Exception e) {
            return null;
        }
        if (constr.getAlternative() != 0) return null;
        ListPlutusData fields = constr.getData();
        if (fields == null || fields.getPlutusDataList() == null
                || fields.getPlutusDataList().size() < 2) return null;
        PlutusData listerField = fields.getPlutusDataList().get(0);
        if (!(listerField instanceof BytesPlutusData listerBytes)) return null;
        byte[] listerPkh = listerBytes.getValue();
        if (listerPkh == null) return null;

        // Find the NFT under collectionPolicy. Strict: exactly one such asset
        // + only ADA otherwise. (Looser than the on-chain check — we accept
        // any UTxO whose datum decodes; the on-chain validator will reject
        // multi-asset listings if we try to spend them. For pool selection
        // it's safer to filter junk out here so we don't burn fees.)
        String hitName = null;
        long lovelace = 0;
        int othersUnderSamePolicy = 0;
        int othersUnderOtherPolicies = 0;
        for (Amount a : u.getAmount()) {
            if (a.getUnit() == null) continue;
            if ("lovelace".equals(a.getUnit())) {
                lovelace = a.getQuantity().longValueExact();
                continue;
            }
            if (a.getUnit().length() < 56) continue;
            if (a.getUnit().regionMatches(true, 0, collectionPolicy, 0, 56)) {
                if (a.getQuantity() == null || !BigInteger.ONE.equals(a.getQuantity())) {
                    othersUnderSamePolicy++;
                    continue;
                }
                if (hitName == null) {
                    hitName = a.getUnit().substring(56);
                } else {
                    othersUnderSamePolicy++;
                }
            } else {
                othersUnderOtherPolicies++;
            }
        }
        if (hitName == null) return null;
        if (othersUnderSamePolicy > 0 || othersUnderOtherPolicies > 0) return null;
        if (lovelace <= 0) return null;

        String nameUtf8 = utf8OrHex(hitName);
        return new Listing(u, u.getTxHash(), u.getOutputIndex(),
                hitName.toLowerCase(Locale.ROOT), nameUtf8, listerPkh, lovelace);
    }

    // ---------------------------------------------------------------------
    // Wallet NA candidates
    // ---------------------------------------------------------------------

    private static List<NaCandidate> fetchNaCandidates(
            BackendService backend, String walletAddress, String collectionPolicy,
            Set<String> exclude) throws Exception {
        List<NaCandidate> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int page = 1;
        while (page <= MAX_UTXO_PAGES) {
            Result<List<Utxo>> result = backend.getUtxoService()
                    .getUtxos(walletAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
            if (!result.isSuccessful()) {
                if (result.code() == 404) break;
                throw new RuntimeException("blockfrost getUtxos failed for " + walletAddress
                        + ": " + result.code() + " " + result.getResponse());
            }
            List<Utxo> batch = result.getValue();
            if (batch == null || batch.isEmpty()) break;
            for (Utxo u : batch) {
                if (u.getAmount() == null) continue;
                for (Amount a : u.getAmount()) {
                    if (a.getUnit() == null || a.getUnit().length() < 56) continue;
                    if (!a.getUnit().regionMatches(true, 0, collectionPolicy, 0, 56)) continue;
                    if (a.getQuantity() == null || !BigInteger.ONE.equals(a.getQuantity())) continue;
                    String nameHex = a.getUnit().substring(56).toLowerCase(Locale.ROOT);
                    if (exclude.contains(nameHex)) continue;
                    if (!seen.add(nameHex)) continue;
                    // Track the UTxO that physically holds NA so the swap
                    // can explicitly collectFrom it. Without this CCL's
                    // auto-selector picks a different ADA-bearing UTxO
                    // and the change ends up with a negative NA quantity.
                    out.add(new NaCandidate(nameHex, utf8OrHex(nameHex), u));
                }
            }
            if (batch.size() < UTXO_PAGE_SIZE) break;
            page++;
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Bucket matching
    // ---------------------------------------------------------------------

    private static BucketMatch findBucketMatch(
            List<NaCandidate> candidates, List<Listing> pool,
            String collectionPolicyHex, long m) {
        byte[] policyBytes = HexUtil.decodeHexString(collectionPolicyHex);
        // SPEC §6.3 + §7.1 labels (DON'T rely on this tool's `na`/`nb` legacy
        // names — they're inverted relative to the validator's labels):
        //   - SPEC's "NA" = name of the asset in the consumed listing input
        //     (= `Listing.assetNameHex` here, originally called `nb` in this
        //     tool's records).
        //   - SPEC's "NB" = name of the asset the swapper deposits = name of
        //     the asset in the successor listing output
        //     (= `NaCandidate.assetNameHex` here, originally called `na`).
        // The validator's bucket equation is:
        //   bucket_self(NA_name) % M == bucket_target(NB_name ‖ consumed.outRef) % M
        // i.e. bucket_self runs over the LISTING'S name (no outref seed) and
        // bucket_target runs over the WALLET DEPOSIT'S name (with the consumed
        // listing's outref as the seed).
        long[] listingBucketSelf = new long[pool.size()];
        for (int i = 0; i < pool.size(); i++) {
            byte[] listingName = HexUtil.decodeHexString(pool.get(i).assetNameHex);
            listingBucketSelf[i] = bucketSelfMod(policyBytes, listingName, m);
        }
        for (int li = 0; li < pool.size(); li++) {
            Listing consumed = pool.get(li);
            byte[] outRefCbor = serializeOutRef(
                    HexUtil.decodeHexString(consumed.txHash), consumed.outputIndex);
            for (NaCandidate deposit : candidates) {
                byte[] depositName = HexUtil.decodeHexString(deposit.assetNameHex);
                long targetBucket = bucketTargetMod(
                        policyBytes, depositName, outRefCbor, m);
                if (listingBucketSelf[li] == targetBucket) {
                    return new BucketMatch(deposit, consumed, targetBucket);
                }
            }
        }
        return null;
    }

    /** bucket_self = from_bytearray_big_endian(blake2b_256(policy ‖ name)) mod M. */
    static long bucketSelfMod(byte[] policy, byte[] name, long m) {
        byte[] concat = new byte[policy.length + name.length];
        System.arraycopy(policy, 0, concat, 0, policy.length);
        System.arraycopy(name, 0, concat, policy.length, name.length);
        byte[] hash = Blake2bUtil.blake2bHash256(concat);
        return modPositive(new BigInteger(1, hash), m);
    }

    /** bucket_target = from_bytearray_big_endian(blake2b_256(policy ‖ nb_name ‖ cbor(oref))) mod M. */
    static long bucketTargetMod(byte[] policy, byte[] nbName, byte[] outRefCbor, long m) {
        byte[] concat = new byte[policy.length + nbName.length + outRefCbor.length];
        int p = 0;
        System.arraycopy(policy, 0, concat, p, policy.length); p += policy.length;
        System.arraycopy(nbName, 0, concat, p, nbName.length); p += nbName.length;
        System.arraycopy(outRefCbor, 0, concat, p, outRefCbor.length);
        byte[] hash = Blake2bUtil.blake2bHash256(concat);
        return modPositive(new BigInteger(1, hash), m);
    }

    private static long modPositive(BigInteger v, long m) {
        return v.mod(BigInteger.valueOf(m)).longValueExact();
    }

    // ---------------------------------------------------------------------
    // CBOR serialisation of OutputReference (matches Aiken's cbor.serialise).
    // ---------------------------------------------------------------------

    /**
     * Aiken's {@code OutputReference = Constr 0 [Hash<Blake2b_256> /bytes/, Int]}.
     * {@code cbor.serialise(oref)} = canonical Plutus-Data CBOR encoding:
     * tag 121 (compact constr alt 0) wrapping an indefinite-length list of
     * the field encodings. CCL's {@link ListPlutusData#serialize} defaults
     * {@code isChunked = true}, which produces an indefinite-length array —
     * matching Aiken's encoder.
     */
    static byte[] serializeOutRef(byte[] txHash, int outputIndex) {
        ConstrPlutusData oref = ConstrPlutusData.of(0L,
                BytesPlutusData.of(txHash),
                BigIntPlutusData.of(outputIndex));
        return oref.serializeToBytes();
    }

    /** compute_output_tag(oref) = blake2b_256(cbor.serialise(oref)). */
    static byte[] computeOutputTag(byte[] txHash, int outputIndex) {
        return Blake2bUtil.blake2bHash256(serializeOutRef(txHash, outputIndex));
    }

    // ---------------------------------------------------------------------
    // Treasury address decode (mirrors ConfigRegistrationService)
    // ---------------------------------------------------------------------

    private static String decodeTreasuryBech32(ConfigDatum cfg) {
        var pc = cfg.getTreasuryAddr().getPaymentCredential();
        Credential paymentCcl;
        if (pc instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.VerificationKey vk) {
            paymentCcl = Credential.fromKey(vk.getVerificationKeyHash().bytes());
        } else if (pc instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.Script sc) {
            paymentCcl = Credential.fromScript(sc.getScriptHash().bytes());
        } else {
            throw new RuntimeException("Unsupported payment credential: "
                    + (pc == null ? "null" : pc.getClass().getName()));
        }

        Optional<com.easy1staking.shithole.blueprint.generated.cardano.address.model.StakeCredential> sc =
                cfg.getTreasuryAddr().getStakeCredential();
        Credential stakeCcl = null;
        if (sc != null && sc.isPresent()) {
            var stake = sc.get();
            if (stake instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.stakecredential.Inline inline) {
                var inner = inline.getCredential();
                if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.VerificationKey vk) {
                    stakeCcl = Credential.fromKey(vk.getVerificationKeyHash().bytes());
                } else if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.Script s) {
                    stakeCcl = Credential.fromScript(s.getScriptHash().bytes());
                }
            }
        }
        Address addr = stakeCcl == null
                ? AddressProvider.getEntAddress(paymentCcl, Networks.preprod())
                : AddressProvider.getBaseAddress(paymentCcl, stakeCcl, Networks.preprod());
        return addr.toBech32();
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    private static String utf8OrHex(String hex) {
        try {
            String s = new String(HexUtil.decodeHexString(hex), StandardCharsets.UTF_8);
            // Reject anything with non-printable bytes — caller wants a label.
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c < 0x20 || c > 0x7e) return "0x" + hex;
            }
            return s;
        } catch (Exception e) {
            return "0x" + hex;
        }
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            die("Missing env var " + name + ". Source api/.env.preprod first.");
        }
        return v;
    }

    private static void die(String msg) {
        System.err.println(msg);
        System.exit(2);
    }

    /**
     * Hook for {@code preBalanceTx} / {@code postBalanceTx}: print every
     * output's address + coin + multi-asset entries. Flags any negative
     * quantity (CBOR major-type-1 in a value field) which would be the
     * smoking gun for "tx builder thinks more of an asset went out than in"
     * — a balance bug that produces a tx no evaluator can parse.
     */
    private static void dumpOutputs(String label,
            com.bloxbean.cardano.client.transaction.spec.Transaction txn) {
        System.out.println("---- " + label + " outputs (" + txn.getBody().getOutputs().size() + ") ----");
        int i = 0;
        for (var out : txn.getBody().getOutputs()) {
            var v = out.getValue();
            System.out.printf("  [%d] addr=%s coin=%s%n",
                    i, out.getAddress(), v.getCoin());
            if (v.getMultiAssets() != null) {
                for (var ma : v.getMultiAssets()) {
                    for (var a : ma.getAssets()) {
                        java.math.BigInteger q = a.getValue();
                        String flag = (q != null && q.signum() < 0) ? "  <-- NEGATIVE!" : "";
                        System.out.printf("        policy=%s name=%s qty=%s%s%n",
                                ma.getPolicyId(), a.getName(), q, flag);
                    }
                }
            }
            i++;
        }
        System.out.println("---- /" + label + " ----");
    }

    // ---- value classes ----------------------------------------------------

    private record Listing(
            Utxo utxo,
            String txHash,
            int outputIndex,
            String assetNameHex,
            String assetName,
            byte[] listerPkh,
            long lovelace) {}

    private record NaCandidate(String assetNameHex, String assetName, Utxo utxo) {}

    private record BucketMatch(NaCandidate na, Listing nb, long bucket) {}
}
