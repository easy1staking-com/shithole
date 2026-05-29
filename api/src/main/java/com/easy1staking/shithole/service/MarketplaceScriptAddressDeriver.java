package com.easy1staking.shithole.service;

import com.bloxbean.cardano.aiken.AikenScriptUtil;
import com.bloxbean.cardano.aiken.exception.ApplyParamException;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.exception.CborSerializationException;
import com.bloxbean.cardano.client.plutus.blueprint.PlutusBlueprintUtil;
import com.bloxbean.cardano.client.plutus.blueprint.model.PlutusVersion;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusScript;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.blueprint.generated.jar.JarSpendValidator;
import com.easy1staking.shithole.blueprint.generated.marketplace.MarketplaceSpendValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Derives the singleton bech32 marketplace script address by chaining
 * two UPLC apply steps:
 *
 * <ol>
 *   <li>{@code jar.jar.spend} compiled with {@code admin_pkh} → applied
 *       jar script. Hash of that = {@code jar_script_hash}.</li>
 *   <li>{@code marketplace.marketplace.spend} compiled with
 *       {@code jar_script_hash} → applied marketplace script. Hash of
 *       that, address-encoded as an enterprise (script-only) bech32 →
 *       the address the indexer watches.</li>
 * </ol>
 *
 * <p>Unlike {@link ListingScriptAddressDeriver} and
 * {@link WantedListingScriptAddressDeriver} (per-collection — keyed by
 * {@code config_nft_policy}), there's exactly ONE marketplace address per
 * network: parameterized on the same admin pkh that owns the jars. The
 * pkh comes from {@code shithole.market.admin-pkh} (env var
 * {@code SHITHOLE_MARKET_ADMIN_PKH}). When unset / blank the deriver
 * returns {@code null} and the indexer is disabled — boot still succeeds
 * so non-marketplace flows aren't blocked by missing config.
 *
 * <p>Memoized per {@code (adminPkh, network)} since the apply chain is
 * deterministic but the UPLC step is not free.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MarketplaceScriptAddressDeriver {

    private final Network appNetwork;

    @Value("${shithole.market.admin-pkh:}")
    private String adminPkhHex;

    /** Memoize {@code (adminPkh_lowercase || network_id || magic) → full artifacts}. */
    private final ConcurrentHashMap<String, MarketplaceArtifacts> artifactsCache =
            new ConcurrentHashMap<>();

    /**
     * Full set of derived artifacts: applied script hashes for both the
     * jar and the marketplace validator, plus their bech32 enterprise
     * addresses on the active network, plus the admin pkh that drove the
     * derivation. Surfaced via {@link #deriveArtifacts()} so callers that
     * need more than just the marketplace bech32 (e.g. {@code
     * ChainAddressManifest}'s boot-time banner, or the future
     * {@code /api/market/manifest} endpoint) don't have to re-do the
     * UPLC apply chain.
     */
    public record MarketplaceArtifacts(
            String adminPkhHex,
            String jarScriptHashHex,
            String jarAddress,
            String marketplaceScriptHashHex,
            String marketplaceAddress) {
    }

    /**
     * Derive the full marketplace artifacts for the configured admin pkh.
     * Returns {@link Optional#empty()} when no admin pkh is configured
     * (env var unset / blank). Throws on a configured-but-malformed pkh
     * so the boot fails loudly rather than silently disabling the indexer.
     */
    public Optional<MarketplaceArtifacts> deriveArtifacts() {
        if (adminPkhHex == null || adminPkhHex.isBlank()) {
            return Optional.empty();
        }
        if (!adminPkhHex.matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalStateException(
                    "shithole.market.admin-pkh must be 56 hex chars (28-byte pkh); got '"
                            + adminPkhHex + "'");
        }
        String pkhLower = adminPkhHex.toLowerCase(Locale.ROOT);
        String cacheKey = pkhLower + ":" + appNetwork.getNetworkId()
                + ":" + appNetwork.getProtocolMagic();
        return Optional.of(artifactsCache.computeIfAbsent(cacheKey, k -> derive(pkhLower)));
    }

    /**
     * Convenience: just the marketplace bech32, or {@code null} when
     * marketplace indexing is disabled. Backwards-compatible with the
     * existing callers in {@link com.easy1staking.shithole.indexer.WatchAddressRegistry}.
     */
    public String deriveAddress() {
        return deriveArtifacts().map(MarketplaceArtifacts::marketplaceAddress).orElse(null);
    }

    /** The configured admin pkh as lowercase hex, or null if unset. */
    public String adminPkhHex() {
        if (adminPkhHex == null || adminPkhHex.isBlank()) return null;
        return adminPkhHex.toLowerCase(Locale.ROOT);
    }

    private MarketplaceArtifacts derive(String pkhLower) {
        byte[] pkhBytes = HexUtil.decodeHexString(pkhLower);

        // Step 1: applyParams(jar.spend, admin_pkh) → applied jar script.
        ListPlutusData jarParams = new ListPlutusData();
        jarParams.add(BytesPlutusData.of(pkhBytes));
        String appliedJar;
        try {
            appliedJar = AikenScriptUtil.applyParamToScript(jarParams, JarSpendValidator.COMPILED_CODE);
        } catch (ApplyParamException e) {
            throw new IllegalStateException(
                    "UPLC apply failed for jar.spend, admin_pkh=" + pkhLower, e);
        }
        PlutusScript jarScript = PlutusBlueprintUtil
                .getPlutusScriptFromCompiledCode(appliedJar, PlutusVersion.v3);
        byte[] jarScriptHash;
        try {
            jarScriptHash = jarScript.getScriptHash();
        } catch (CborSerializationException e) {
            throw new IllegalStateException(
                    "failed to hash applied jar script, admin_pkh=" + pkhLower, e);
        }
        String jarAddress = AddressProvider.getEntAddress(jarScript, appNetwork).toBech32();

        // Step 2: applyParams(marketplace.spend, jar_script_hash) → applied marketplace script.
        ListPlutusData marketParams = new ListPlutusData();
        marketParams.add(BytesPlutusData.of(jarScriptHash));
        String appliedMarket;
        try {
            appliedMarket = AikenScriptUtil.applyParamToScript(
                    marketParams, MarketplaceSpendValidator.COMPILED_CODE);
        } catch (ApplyParamException e) {
            throw new IllegalStateException(
                    "UPLC apply failed for marketplace.spend, jar_script_hash="
                            + HexUtil.encodeHexString(jarScriptHash), e);
        }
        PlutusScript marketScript = PlutusBlueprintUtil
                .getPlutusScriptFromCompiledCode(appliedMarket, PlutusVersion.v3);
        byte[] marketScriptHash;
        try {
            marketScriptHash = marketScript.getScriptHash();
        } catch (CborSerializationException e) {
            throw new IllegalStateException(
                    "failed to hash applied marketplace script, admin_pkh=" + pkhLower, e);
        }
        String marketAddress = AddressProvider.getEntAddress(marketScript, appNetwork).toBech32();

        return new MarketplaceArtifacts(
                pkhLower,
                HexUtil.encodeHexString(jarScriptHash),
                jarAddress,
                HexUtil.encodeHexString(marketScriptHash),
                marketAddress);
    }
}
