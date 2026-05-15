package com.easy1staking.shithole.service;

import com.bloxbean.cardano.aiken.AikenScriptUtil;
import com.bloxbean.cardano.aiken.exception.ApplyParamException;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.plutus.blueprint.PlutusBlueprintUtil;
import com.bloxbean.cardano.client.plutus.blueprint.model.PlutusVersion;
import com.bloxbean.cardano.client.plutus.spec.BytesPlutusData;
import com.bloxbean.cardano.client.plutus.spec.ListPlutusData;
import com.bloxbean.cardano.client.plutus.spec.PlutusScript;
import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.blueprint.generated.listing.ListingSpendValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Derives the bech32 listing-script address for a given {@code config_nft_policy}
 * by applying the policy id as a UPLC parameter to the unapplied listing
 * validator and address-encoding the resulting script hash.
 *
 * <p>The unapplied compiled code is the constant
 * {@link ListingSpendValidator#COMPILED_CODE} generated from
 * {@code contracts/plutus.json}. The parameter application is performed by
 * {@link AikenScriptUtil#applyParamToScript} (JNI wrapper around the Aiken
 * UPLC runtime via {@code aiken-java-binding}). Results are memoized per
 * {@code (policy, network)} since application is deterministic and not free.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ListingScriptAddressDeriver {

    private final Network appNetwork;

    /** Memoize {@code (policy_lowercase || network_id) → bech32 address}. */
    private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();

    /**
     * Memoize {@code (policy_lowercase || network_id) → AppliedListing}.
     * Separate from {@link #cache} since the spend-validator tool needs the full
     * {@link PlutusScript} (to attach to a {@code ScriptTx}) plus the bech32
     * address; web flows only need the address string.
     */
    private final ConcurrentHashMap<String, AppliedListing> appliedCache = new ConcurrentHashMap<>();

    /**
     * Derive the bech32 listing-script address for a config NFT policy.
     *
     * @param configNftPolicyHex 56 hex chars (28-byte policy id)
     * @return bech32 address (e.g. {@code addr1w…}) suitable for indexer watch
     * @throws IllegalArgumentException if the policy is malformed
     * @throws ApplyParamException      if the UPLC apply step fails
     */
    public String deriveAddress(String configNftPolicyHex) {
        if (configNftPolicyHex == null || !configNftPolicyHex.matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalArgumentException("config_nft_policy must be 56 hex chars");
        }
        String policyLower = configNftPolicyHex.toLowerCase(Locale.ROOT);
        String cacheKey = policyLower + ":" + appNetwork.getNetworkId() + ":" + appNetwork.getProtocolMagic();
        return cache.computeIfAbsent(cacheKey, k -> derive(policyLower));
    }

    /**
     * Derive both the applied listing {@link PlutusScript} and its bech32
     * enterprise address. Used by operator tools that need to attach the
     * validator to a {@code ScriptTx} (spending the listing UTxO triggers the
     * validator, so the tx must carry the applied script).
     *
     * <p>Same memoization scheme as {@link #deriveAddress}: the
     * {@code (policy, network)} pair determines the applied output, so
     * repeated calls are cheap.
     *
     * @param configNftPolicyHex 56 hex chars (28-byte policy id)
     * @return {@link AppliedListing} bundling the applied script + address
     * @throws IllegalArgumentException if the policy is malformed
     * @throws ApplyParamException      if the UPLC apply step fails
     */
    public AppliedListing deriveApplied(String configNftPolicyHex) {
        if (configNftPolicyHex == null || !configNftPolicyHex.matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalArgumentException("config_nft_policy must be 56 hex chars");
        }
        String policyLower = configNftPolicyHex.toLowerCase(Locale.ROOT);
        String cacheKey = policyLower + ":" + appNetwork.getNetworkId() + ":" + appNetwork.getProtocolMagic();
        return appliedCache.computeIfAbsent(cacheKey, k -> deriveFull(policyLower));
    }

    private String derive(String policyLower) {
        return deriveFull(policyLower).address();
    }

    private AppliedListing deriveFull(String policyLower) {
        byte[] policyBytes = HexUtil.decodeHexString(policyLower);
        ListPlutusData params = new ListPlutusData();
        params.add(BytesPlutusData.of(policyBytes));

        String applied = AikenScriptUtil.applyParamToScript(params, ListingSpendValidator.COMPILED_CODE);
        PlutusScript script = PlutusBlueprintUtil.getPlutusScriptFromCompiledCode(applied, PlutusVersion.v3);
        String address = AddressProvider.getEntAddress(script, appNetwork).toBech32();
        log.info("derived listing-script address policy={} network={} address={}",
                policyLower, appNetwork.getProtocolMagic(), address);
        return new AppliedListing(script, address);
    }

    /**
     * Bundle of the parameterized listing {@link PlutusScript} and its bech32
     * enterprise address. The script is required to attach as the spending
     * validator on a {@code ScriptTx} when consuming a listing UTxO; the
     * address is required to set the successor listing's output address.
     */
    public record AppliedListing(PlutusScript script, String address) {}
}
