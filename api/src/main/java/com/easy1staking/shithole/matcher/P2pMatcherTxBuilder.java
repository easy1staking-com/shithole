package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.plutus.spec.BigIntPlutusData;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ConstrPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.p2p.PoolMerkleService;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver.AppliedWantedListing;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cardanofoundation.merkle.ProofItem;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.math.BigInteger;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Builds (and optionally submits) a single tx that fulfills both
 * sides of a 2-cycle wanted-listing match. Mirrors
 * {@link com.easy1staking.shithole.tools.preprod.PreprodFulfillP2pTool}
 * for the single-Fulfill case, doubled and merged.
 *
 * <p>Wired only when {@code shithole.p2p.matcher.enabled=true}.
 */
@Service
@ConditionalOnProperty(name = "shithole.p2p.matcher.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pMatcherTxBuilder {

    private static final int MAX_UTXO_PAGES = 50;
    private static final int UTXO_PAGE_SIZE = 100;

    private final BackendService backendService;
    private final ConfigRepository configRepository;
    private final PoolMerkleService poolMerkleService;
    private final WantedListingScriptAddressDeriver wantedListingScriptAddressDeriver;
    private final MatcherHotWallet hotWallet;
    private final Network network;

    /** Ogmios URL. Required when matcher is enabled — fail fast if missing. */
    @Value("${shithole.p2p.matcher.ogmios-url:${OGMIOS_URL:}}")
    private String ogmiosUrl;

    /**
     * Build, sign, evaluate, and submit a tx for the given pair. Returns
     * the on-chain tx hash on success, or an empty result + a message on
     * failure. Idempotent at the caller level (the coordinator tracks
     * in-flight hashes); this method is one-shot.
     */
    public BuildResult buildAndSubmit(MatchedPair pair) throws Exception {
        WantedListingEventEntity a = pair.a();
        WantedListingEventEntity b = pair.b();

        // Same-collection invariant (the detector groups by configNftPolicy
        // before pairing; we re-check here as a defensive guard).
        if (!Arrays.equals(a.getConfigNftPolicy(), b.getConfigNftPolicy())) {
            return BuildResult.failure(
                    "cross-collection match not supported in v1 (a.policy != b.policy)");
        }
        String configPolicyHex = HexUtil.encodeHexString(a.getConfigNftPolicy()).toLowerCase(Locale.ROOT);

        // ---- 1. cfg + treasury -------------------------------------------------
        Optional<ConfigEntity> cfgOpt = configRepository.findById(configPolicyHex);
        if (cfgOpt.isEmpty()) {
            return BuildResult.failure("config not found for policy " + configPolicyHex);
        }
        ConfigEntity cfg = cfgOpt.get();
        long protocolFee = cfg.getProtocolFee() == null ? 0L : cfg.getProtocolFee();
        String treasuryBech32 = cfg.getTreasuryAddrBech32();
        if (protocolFee > 0 && (treasuryBech32 == null || treasuryBech32.isBlank())) {
            return BuildResult.failure("protocol_fee>0 but treasury_addr_bech32 missing for " + configPolicyHex);
        }

        // ---- 2. asset names (for the OTHER side's merkle proof) ---------------
        byte[] assetNameA = P2pMatcherDetector.assetNameOf(a);
        byte[] assetNameB = P2pMatcherDetector.assetNameOf(b);
        if (assetNameA == null || assetNameB == null) {
            return BuildResult.failure("offered_nft_unit malformed on one of the listings");
        }

        // ---- 3. merkle proofs --------------------------------------------------
        // A's Fulfill needs a proof that B's offered asset_name is a member
        // of A's accepted_merkle_root. Vice versa for B.
        Optional<List<ProofItem>> proofForA =
                poolMerkleService.getProof(a.getAcceptedMerkleRoot(), assetNameB);
        Optional<List<ProofItem>> proofForB =
                poolMerkleService.getProof(b.getAcceptedMerkleRoot(), assetNameA);
        if (proofForA.isEmpty() || proofForB.isEmpty()) {
            return BuildResult.failure(
                    "merkle proof generation failed (A: " + proofForA.isPresent()
                            + ", B: " + proofForB.isPresent() + ")");
        }

        // ---- 4. on-chain listing UTxOs ----------------------------------------
        Utxo listingUtxoA = fetchUtxoOrFail(a);
        Utxo listingUtxoB = fetchUtxoOrFail(b);
        if (listingUtxoA == null || listingUtxoB == null) {
            return BuildResult.failure("listing UTxO no longer on-chain (race lost)");
        }

        // ---- 5. config ref UTxO -----------------------------------------------
        String configScriptAddress = deriveConfigScriptAddress(configPolicyHex);
        Utxo configUtxo = findConfigUtxo(configScriptAddress, configPolicyHex);
        if (configUtxo == null) {
            return BuildResult.failure("config UTxO not found at " + configScriptAddress);
        }

        // ---- 6. compute output tags + build redeemers -------------------------
        byte[] tagA = OutputTags.computeOutputTag(a.getTxHash(), a.getOutputIndex());
        byte[] tagB = OutputTags.computeOutputTag(b.getTxHash(), b.getOutputIndex());
        PlutusData buyerOutDatumA = BytesPlutusData.of(tagA);
        PlutusData buyerOutDatumB = BytesPlutusData.of(tagB);

        // Output layout: buyer_A @ 0, treasury_A @ 1 (if fee>0),
        //                buyer_B @ next, treasury_B @ next (if fee>0).
        // Indices are computed up-front so the redeemers point at the right slots.
        boolean hasTreasury = protocolFee > 0;
        int buyerAIdx = 0;
        Integer treasuryAIdx = hasTreasury ? 1 : null;
        int buyerBIdx = hasTreasury ? 2 : 1;
        Integer treasuryBIdx = hasTreasury ? 3 : null;

        PlutusData redeemerA = buildFulfillRedeemer(proofForA.get(), treasuryAIdx);
        PlutusData redeemerB = buildFulfillRedeemer(proofForB.get(), treasuryBIdx);

        // ---- 7. applied validator (same script for both inputs) ---------------
        AppliedWantedListing applied = wantedListingScriptAddressDeriver.deriveApplied(configPolicyHex);

        // ---- 8. compose tx ----------------------------------------------------
        String collectionPolicyHex = extractCollectionPolicyHex(a, b);
        if (collectionPolicyHex == null) {
            return BuildResult.failure("could not derive collection_policy_id from listings");
        }
        // The unit each buyer receives = the OTHER listing's offered NFT.
        String unitForBuyerA = collectionPolicyHex
                + HexUtil.encodeHexString(assetNameB).toLowerCase(Locale.ROOT);
        String unitForBuyerB = collectionPolicyHex
                + HexUtil.encodeHexString(assetNameA).toLowerCase(Locale.ROOT);

        String botAddress = hotWallet.getAddress();

        // Buyer-output (NFT carrier): the on-chain validator's W3 check
        // only enforces address + datum equality, not a lovelace floor.
        // Pass a nominal 1 lovelace and let CCL's MinAdaChecker bump to
        // the chain min for an NFT + inline-datum output (~1.3 ADA).
        // The contract's W2 floor (bounty >= protocol_fee + 2 ADA)
        // absorbs whatever the chain min comes out to be.
        final long buyerOutLovelace = 1L;
        // Treasury output: pass the literal protocol_fee. CCL's QuickTx
        // runs a MinAdaChecker as part of preBalanceTx and will bump
        // the lovelace up to the chain min (~1 ADA for an output with
        // a small inline tag datum) if protocol_fee is below it. The
        // contract's W2 floor (bounty >= protocol_fee + 2 ADA) absorbs
        // any small bump, so we don't need to pre-pad here.
        final long treasuryOutLovelace = protocolFee;

        Tx tx = new Tx()
                .readFrom(configUtxo)
                .collectFrom(listingUtxoA, redeemerA)
                .collectFrom(listingUtxoB, redeemerB)
                // Buyer A receives NFT_B (the OTHER listing's offered NFT)
                // routed to A.buyer_address with the A-tag inline datum.
                .payToContract(a.getBuyerAddressBech32(),
                        List.of(
                                Amount.asset(unitForBuyerA, BigInteger.ONE),
                                Amount.lovelace(BigInteger.valueOf(buyerOutLovelace))),
                        buyerOutDatumA);

        if (hasTreasury) {
            // Treasury output for A — same address, but inline datum carries
            // A's own_tag so the validator's W6 anti-double-sat check passes
            // separately for each Fulfill invocation.
            tx = tx.payToContract(treasuryBech32,
                    List.of(Amount.lovelace(BigInteger.valueOf(treasuryOutLovelace))),
                    buyerOutDatumA);
        }

        tx = tx.payToContract(b.getBuyerAddressBech32(),
                List.of(
                        Amount.asset(unitForBuyerB, BigInteger.ONE),
                        Amount.lovelace(BigInteger.valueOf(buyerOutLovelace))),
                buyerOutDatumB);

        if (hasTreasury) {
            tx = tx.payToContract(treasuryBech32,
                    List.of(Amount.lovelace(BigInteger.valueOf(treasuryOutLovelace))),
                    buyerOutDatumB);
        }

        tx = tx.attachSpendingValidator(applied.script())
                .from(botAddress);

        // ---- 9. evaluator + submit -------------------------------------------
        if (ogmiosUrl == null || ogmiosUrl.isBlank()) {
            return BuildResult.failure(
                    "shithole.p2p.matcher.ogmios-url (or OGMIOS_URL env) is required when matcher is enabled");
        }
        var ogmiosBackend = new com.bloxbean.cardano.client.backend.ogmios.http
                .OgmiosBackendService(ogmiosUrl);
        com.bloxbean.cardano.client.api.TransactionEvaluator evaluator =
                (cbor, inputUtxos) -> ogmiosBackend.getTransactionService().evaluateTx(cbor);

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backendService);
        var ctx = qtxBuilder.compose(tx)
                .feePayer(botAddress)
                .collateralPayer(botAddress)
                .withRequiredSigners(new Address(botAddress))
                .withSigner(SignerProviders.signerFrom(hotWallet.getAccount()))
                .withTxEvaluator(evaluator)
                .mergeOutputs(false);

        var result = ctx.completeAndWait(Duration.ofMinutes(3),
                msg -> log.info("[matcher tx] {}", msg));
        if (!result.isSuccessful()) {
            return BuildResult.failure("submit failed: " + result.getResponse());
        }
        log.info("P2pMatcherTxBuilder submitted pair={} txHash={}",
                pair.key(), result.getValue());
        return BuildResult.success(result.getValue(), pair.estimatedNetLovelace());
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers                                                                */
    /* ---------------------------------------------------------------------- */

    /**
     * Build a Fulfill redeemer: {@code Constr 0 [List<ProofItem>, Option<Int>]}.
     * Each {@link ProofItem} encodes to {@code Constr 0|1 [Constr 0 [bytes]]}
     * — the inner {@code Constr 0 [bytes]} is the Root record wrapper required
     * by the {@code aiken_merkle_tree} library. Mirrors the FE encoder in
     * {@code web/src/lib/tx/p2p.ts:buildFulfillRedeemer}.
     */
    public static PlutusData buildFulfillRedeemer(List<ProofItem> proof, Integer treasuryOutputIndex) {
        ListPlutusData proofItems = ListPlutusData.of();
        for (ProofItem pi : proof) {
            long alt = (pi instanceof ProofItem.Left) ? 0L : 1L;
            byte[] hash = (pi instanceof ProofItem.Left l)
                    ? l.getHash()
                    : ((ProofItem.Right) pi).getHash();
            ConstrPlutusData rootWrap = ConstrPlutusData.of(0L, BytesPlutusData.of(hash));
            proofItems.add(ConstrPlutusData.of(alt, rootWrap));
        }
        PlutusData treasuryOption;
        if (treasuryOutputIndex == null) {
            treasuryOption = ConstrPlutusData.of(1L); // None
        } else {
            treasuryOption = ConstrPlutusData.of(0L,
                    BigIntPlutusData.of(BigInteger.valueOf(treasuryOutputIndex))); // Some(idx)
        }
        return ConstrPlutusData.of(0L, proofItems, treasuryOption);
    }

    /**
     * Fetch the listing UTxO from chain. Returns null if it no longer
     * exists (i.e. another seller has already fulfilled / the buyer
     * reclaimed) — the caller drops the pair and moves on.
     */
    private Utxo fetchUtxoOrFail(WantedListingEventEntity row) {
        try {
            Result<Utxo> result = backendService.getUtxoService()
                    .getTxOutput(HexUtil.encodeHexString(row.getTxHash()), row.getOutputIndex());
            if (result == null || !result.isSuccessful()) {
                return null;
            }
            return result.getValue();
        } catch (Exception e) {
            log.warn("fetchUtxoOrFail: error reading {}#{}: {}",
                    HexUtil.encodeHexString(row.getTxHash()), row.getOutputIndex(), e.getMessage());
            return null;
        }
    }

    /**
     * Derive the config script address (enterprise, payment cred from the
     * script hash). Matches {@code ConfigRegistrationService.deriveConfigAddress}.
     */
    private String deriveConfigScriptAddress(String configPolicyHex) {
        var cred = com.bloxbean.cardano.client.address.Credential.fromScript(configPolicyHex);
        return com.bloxbean.cardano.client.address.AddressProvider
                .getEntAddress(cred, network).toBech32();
    }

    private Utxo findConfigUtxo(String configAddress, String policyHex) {
        try {
            int page = 1;
            while (page <= MAX_UTXO_PAGES) {
                Result<List<Utxo>> result = backendService.getUtxoService()
                        .getUtxos(configAddress, UTXO_PAGE_SIZE, page, OrderEnum.asc);
                if (result == null || !result.isSuccessful()) return null;
                List<Utxo> batch = result.getValue();
                if (batch == null || batch.isEmpty()) return null;
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
                if (batch.size() < UTXO_PAGE_SIZE) return null;
                page++;
            }
            return null;
        } catch (Exception e) {
            log.warn("findConfigUtxo error: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Both listings share the same collection (v1 invariant). Pull the
     * collection_policy_id (28-byte hex) by stripping the asset_name off
     * either listing's offered_nft_unit.
     */
    private String extractCollectionPolicyHex(WantedListingEventEntity a, WantedListingEventEntity b) {
        byte[] unit = a.getOfferedNftUnit();
        if (unit == null || unit.length < 28) return null;
        byte[] policy = Arrays.copyOfRange(unit, 0, 28);
        // Sanity: b should agree.
        byte[] unitB = b.getOfferedNftUnit();
        if (unitB == null || unitB.length < 28
                || !Arrays.equals(policy, Arrays.copyOfRange(unitB, 0, 28))) {
            return null;
        }
        return HexUtil.encodeHexString(policy).toLowerCase(Locale.ROOT);
    }

    /**
     * Outcome of a build-and-submit attempt. {@code success=true} carries
     * the on-chain tx hash + the estimated net lovelace; failure carries a
     * human-readable message for the coordinator to log.
     */
    public record BuildResult(boolean success, String txHash, long netLovelace, String errorMessage) {
        public static BuildResult success(String txHash, long netLovelace) {
            return new BuildResult(true, txHash, netLovelace, null);
        }
        public static BuildResult failure(String message) {
            return new BuildResult(false, null, 0L, message);
        }
    }
}
