package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusData;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.matcher.MatcherHotWallet;
import com.easy1staking.shithole.matcher.OutputTags;
import com.easy1staking.shithole.matcher.P2pMatcherDetector;
import com.easy1staking.shithole.matcher.P2pMatcherTxBuilder;
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
 * Builds + submits a single-Fulfill tx that consumes ONE wanted-listing UTxO
 * using one of the bot's hot-wallet NFTs as the deposit. Mirrors
 * {@link com.easy1staking.shithole.tools.preprod.PreprodFulfillP2pTool}'s
 * structure (which is the proven preprod-tested encoder) and reuses the
 * {@link P2pMatcherTxBuilder#buildFulfillRedeemer} helper for the redeemer
 * encoding (Constr 0 [List&lt;Constr alt [Constr 0 [bytes]]&gt;, Option&lt;Int&gt;]).
 *
 * <p>Bot economics per submitted tx:
 * <pre>
 *   bot wallet outflow = tx_fee + buyer_output_min_utxo (+ treasury if fee>0)
 *   bot wallet inflow  = listing's bounty (lovelace) + buyer's offered NFT
 *                        (which goes BACK to the bot's same hot wallet as
 *                        change since the bot is the change recipient)
 * </pre>
 *
 * <p>The user's economic argument: any well-formed listing has bounty &gt;
 * (protocol_fee + tx_fee + buyer_output_min_utxo). The bot blindly submits
 * regardless of profit; the detector's {@code estimateNet} is only used for
 * ranking among multiple candidates.
 */
@Service
@ConditionalOnProperty(name = "shithole.p2p.auto-fulfill.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class P2pAutoFulfillerTxBuilder {

    private static final int MAX_UTXO_PAGES = 50;
    private static final int UTXO_PAGE_SIZE = 100;

    private final BackendService backendService;
    private final ConfigRepository configRepository;
    private final PoolMerkleService poolMerkleService;
    private final WantedListingScriptAddressDeriver wantedListingScriptAddressDeriver;
    private final MatcherHotWallet hotWallet;
    private final Network network;

    /**
     * Ogmios URL. Required when auto-fulfiller is enabled. Falls back to the
     * matcher's URL (same secret in practice; both loops talk to the same
     * Ogmios for tx eval). Boot fails fast if neither is set when a tx is
     * built.
     */
    @Value("${shithole.p2p.auto-fulfill.ogmios-url:${shithole.p2p.matcher.ogmios-url:${OGMIOS_URL:}}}")
    private String ogmiosUrl;

    /**
     * Build + sign + evaluate + submit a single Fulfill tx for the given
     * candidate. Returns the on-chain tx hash on success, or an empty result +
     * a message on failure. One-shot, idempotent at the caller level (the
     * coordinator owns the in-flight tracking).
     */
    public BuildResult buildAndSubmit(FulfillCandidate candidate) throws Exception {
        WantedListingEventEntity listing = candidate.listing();
        byte[] assetName = candidate.depositAssetName();
        Utxo depositUtxo = candidate.depositUtxo();

        String configPolicyHex = HexUtil.encodeHexString(listing.getConfigNftPolicy())
                .toLowerCase(Locale.ROOT);

        // ---- 1. cfg + treasury -------------------------------------------------
        Optional<ConfigEntity> cfgOpt = configRepository.findById(configPolicyHex);
        if (cfgOpt.isEmpty()) {
            return BuildResult.failure("config not found for policy " + configPolicyHex);
        }
        ConfigEntity cfg = cfgOpt.get();
        long protocolFee = cfg.getProtocolFee() == null ? 0L : cfg.getProtocolFee();
        String treasuryBech32 = cfg.getTreasuryAddrBech32();
        if (protocolFee > 0 && (treasuryBech32 == null || treasuryBech32.isBlank())) {
            return BuildResult.failure(
                    "protocol_fee>0 but treasury_addr_bech32 missing for " + configPolicyHex);
        }

        // ---- 2. merkle proof for our deposit ----------------------------------
        Optional<List<ProofItem>> proofOpt =
                poolMerkleService.getProof(listing.getAcceptedMerkleRoot(), assetName);
        if (proofOpt.isEmpty()) {
            return BuildResult.failure(
                    "merkle proof generation failed for asset "
                            + HexUtil.encodeHexString(assetName));
        }

        // ---- 3. listing UTxO + config UTxO ------------------------------------
        Utxo listingUtxo = fetchUtxoOrFail(listing);
        if (listingUtxo == null) {
            return BuildResult.failure("listing UTxO no longer on-chain (race lost)");
        }
        String configScriptAddress = deriveConfigScriptAddress(configPolicyHex);
        Utxo configUtxo = findConfigUtxo(configScriptAddress, configPolicyHex);
        if (configUtxo == null) {
            return BuildResult.failure("config UTxO not found at " + configScriptAddress);
        }

        // ---- 4. compute output tag for buyer output --------------------------
        byte[] outputTag = OutputTags.computeOutputTag(listing.getTxHash(), listing.getOutputIndex());
        PlutusData buyerOutDatum = BytesPlutusData.of(outputTag);

        // ---- 5. redeemer -------------------------------------------------------
        // Output layout: buyer @ 0, treasury @ 1 (if fee>0). Bot's change goes
        // last (auto-routed by QuickTx via .from(botAddress)).
        boolean hasTreasury = protocolFee > 0;
        Integer treasuryOutputIndex = hasTreasury ? 1 : null;
        PlutusData fulfillRedeemer =
                P2pMatcherTxBuilder.buildFulfillRedeemer(proofOpt.get(), treasuryOutputIndex);

        // ---- 6. applied validator + script address ---------------------------
        AppliedWantedListing applied = wantedListingScriptAddressDeriver.deriveApplied(configPolicyHex);

        // ---- 7. asset unit (collection_policy || asset_name) -----------------
        String collectionPolicyHex = collectionPolicyHex(listing);
        if (collectionPolicyHex == null) {
            return BuildResult.failure("could not derive collection_policy_id from listing");
        }
        String depositUnit = collectionPolicyHex + HexUtil.encodeHexString(assetName)
                .toLowerCase(Locale.ROOT);
        String botAddress = hotWallet.getAddress();

        // Buyer-output (NFT carrier): nominal 1 lovelace, CCL bumps to
        // chain min for an NFT + inline-datum output (~1.3 ADA). The
        // on-chain validator's W3 enforces address + datum equality,
        // not a lovelace floor; the contract's W2 floor on the listing
        // (bounty >= protocol_fee + 2 ADA) covers the chain min comfortably.
        final long buyerOutLovelace = 1L;
        // Treasury output: pass the literal protocol_fee; CCL's QuickTx
        // MinAdaChecker bumps to chain min if needed. Same reasoning as
        // P2pMatcherTxBuilder — the contract's W2 floor (bounty >=
        // protocol_fee + 2 ADA) absorbs any small bump.
        final long treasuryOutLovelace = protocolFee;

        // ---- 8. compose tx ----------------------------------------------------
        Tx tx = new Tx()
                .readFrom(configUtxo)
                .collectFrom(listingUtxo, fulfillRedeemer)
                // Force the bot's deposit UTxO into the inputs — defends
                // against the balancer leaving negative multi-asset change.
                // Same trick as PreprodFulfillP2pTool. The buyer's offered
                // NFT (carried into the bot's input as part of the listing
                // UTxO's value) flows to the bot's change automatically.
                .collectFrom(List.of(depositUtxo))
                .payToContract(listing.getBuyerAddressBech32(),
                        List.of(
                                Amount.asset(depositUnit, BigInteger.ONE),
                                Amount.lovelace(BigInteger.valueOf(buyerOutLovelace))),
                        buyerOutDatum);
        if (hasTreasury) {
            tx = tx.payToContract(treasuryBech32,
                    List.of(Amount.lovelace(BigInteger.valueOf(treasuryOutLovelace))),
                    buyerOutDatum);
        }
        tx = tx.attachSpendingValidator(applied.script())
                .from(botAddress);

        // ---- 9. evaluator + submit -------------------------------------------
        if (ogmiosUrl == null || ogmiosUrl.isBlank()) {
            return BuildResult.failure(
                    "shithole.p2p.auto-fulfill.ogmios-url (or .matcher.ogmios-url, or OGMIOS_URL) "
                            + "is required when auto-fulfiller is enabled");
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
                msg -> log.info("[auto-fulfill tx] {}", msg));
        if (!result.isSuccessful()) {
            return BuildResult.failure("submit failed: " + result.getResponse());
        }
        log.info("P2pAutoFulfillerTxBuilder submitted listing={} txHash={}",
                candidate.listingOutrefKey(), result.getValue());
        return BuildResult.success(result.getValue(), candidate.estimatedNetLovelace());
    }

    /* ---------------------------------------------------------------------- */

    private Utxo fetchUtxoOrFail(WantedListingEventEntity row) {
        try {
            Result<Utxo> result = backendService.getUtxoService()
                    .getTxOutput(HexUtil.encodeHexString(row.getTxHash()), row.getOutputIndex());
            if (result == null || !result.isSuccessful()) return null;
            return result.getValue();
        } catch (Exception e) {
            log.warn("fetchUtxoOrFail: error reading {}#{}: {}",
                    HexUtil.encodeHexString(row.getTxHash()), row.getOutputIndex(), e.getMessage());
            return null;
        }
    }

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

    private static String collectionPolicyHex(WantedListingEventEntity row) {
        byte[] unit = row.getOfferedNftUnit();
        if (unit == null || unit.length < 28) return null;
        return HexUtil.encodeHexString(Arrays.copyOfRange(unit, 0, 28)).toLowerCase(Locale.ROOT);
    }

    /**
     * Outcome of a build-and-submit attempt. {@code success=true} carries the
     * on-chain tx hash + the estimated net lovelace; failure carries a
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
