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
import com.easy1staking.shithole.blueprint.generated.wantedlisting.WantedListingSpendValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * v3 sibling of {@link ListingScriptAddressDeriver}. Derives the bech32
 * wanted_listing script address for a given {@code config_nft_policy} by
 * applying the policy as a UPLC parameter to the unapplied wanted_listing
 * validator (CCL-generated constant from
 * {@code contracts/plutus.json}) and address-encoding the resulting hash.
 *
 * <p>Memoized per {@code (policy, network)}. The deriver is consulted by:
 * <ul>
 *   <li>the {@code WatchAddressRegistry} on startup / config registration —
 *       so the indexer knows which addresses to watch</li>
 *   <li>any FE-driven tx-building helper that needs the wanted_listing
 *       script address (although the FE today derives it itself via UPLC
 *       in {@code createP2pListing.ts})</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WantedListingScriptAddressDeriver {

    private final Network appNetwork;

    /** Memoize {@code (policy_lowercase || network_id) → bech32 address}. */
    private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();

    /** Memoize {@code (policy_lowercase || network_id) → AppliedWantedListing}. */
    private final ConcurrentHashMap<String, AppliedWantedListing> appliedCache =
            new ConcurrentHashMap<>();

    public String deriveAddress(String configNftPolicyHex) {
        if (configNftPolicyHex == null || !configNftPolicyHex.matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalArgumentException("config_nft_policy must be 56 hex chars");
        }
        String policyLower = configNftPolicyHex.toLowerCase(Locale.ROOT);
        String cacheKey = policyLower + ":" + appNetwork.getNetworkId()
                + ":" + appNetwork.getProtocolMagic();
        return cache.computeIfAbsent(cacheKey, k -> derive(policyLower));
    }

    public AppliedWantedListing deriveApplied(String configNftPolicyHex) {
        if (configNftPolicyHex == null || !configNftPolicyHex.matches("^[0-9a-fA-F]{56}$")) {
            throw new IllegalArgumentException("config_nft_policy must be 56 hex chars");
        }
        String policyLower = configNftPolicyHex.toLowerCase(Locale.ROOT);
        String cacheKey = policyLower + ":" + appNetwork.getNetworkId()
                + ":" + appNetwork.getProtocolMagic();
        return appliedCache.computeIfAbsent(cacheKey, k -> deriveFull(policyLower));
    }

    private String derive(String policyLower) {
        return deriveFull(policyLower).address();
    }

    private AppliedWantedListing deriveFull(String policyLower) {
        byte[] policyBytes = HexUtil.decodeHexString(policyLower);
        ListPlutusData params = new ListPlutusData();
        params.add(BytesPlutusData.of(policyBytes));

        String applied;
        try {
            applied = AikenScriptUtil.applyParamToScript(
                    params, WantedListingSpendValidator.COMPILED_CODE);
        } catch (ApplyParamException e) {
            throw new IllegalStateException(
                    "UPLC apply failed for wanted_listing.spend, policy=" + policyLower, e);
        }
        PlutusScript script =
                PlutusBlueprintUtil.getPlutusScriptFromCompiledCode(applied, PlutusVersion.v3);
        String address = AddressProvider.getEntAddress(script, appNetwork).toBech32();
        log.info("derived wanted_listing script address policy={} network={} address={}",
                policyLower, appNetwork.getProtocolMagic(), address);
        return new AppliedWantedListing(script, address);
    }

    public record AppliedWantedListing(PlutusScript script, String address) {
    }
}
