package com.easy1staking.shithole.service;

import com.bloxbean.cardano.client.common.model.Networks;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Real-JNI test for {@link ListingScriptAddressDeriver}. Exercises the
 * {@code aiken-java-binding} {@code applyParamToScript} call against the
 * generated {@code ListingSpendValidator.COMPILED_CODE} constant.
 *
 * <p>If the native library cannot be loaded on this platform, these tests
 * will fail at construction time with an {@code UnsatisfiedLinkError} —
 * which is the desired signal (we want to know early that JNI is broken).
 */
class ListingScriptAddressDeriverTest {

    private static final String POLICY_A = "abababababababababababababababababababababababababababab";
    private static final String POLICY_B = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

    @Test
    void derivesDeterministicMainnetEnterpriseAddress() {
        var deriver = new ListingScriptAddressDeriver(Networks.mainnet());
        String addrA = deriver.deriveAddress(POLICY_A);
        String addrA2 = deriver.deriveAddress(POLICY_A.toUpperCase());

        // addr1w… is the mainnet enterprise-address prefix for a script credential.
        assertThat(addrA).startsWith("addr1w");
        // Deterministic + cache hit on second call (case-insensitive input).
        assertThat(addrA2).isEqualTo(addrA);
    }

    @Test
    void differentPoliciesYieldDifferentAddresses() {
        var deriver = new ListingScriptAddressDeriver(Networks.mainnet());
        String addrA = deriver.deriveAddress(POLICY_A);
        String addrB = deriver.deriveAddress(POLICY_B);
        assertThat(addrA).isNotEqualTo(addrB);
        assertThat(addrA).startsWith("addr1w");
        assertThat(addrB).startsWith("addr1w");
    }

    @Test
    void preprodPrefixDiffersFromMainnet() {
        var mainnet = new ListingScriptAddressDeriver(Networks.mainnet()).deriveAddress(POLICY_A);
        var preprod = new ListingScriptAddressDeriver(Networks.preprod()).deriveAddress(POLICY_A);
        // Mainnet enterprise script addresses start with `addr1w…`,
        // preprod/preview with `addr_test1w…`.
        assertThat(mainnet).startsWith("addr1w");
        assertThat(preprod).startsWith("addr_test1w");
    }

    @Test
    void rejectsMalformedPolicy() {
        var deriver = new ListingScriptAddressDeriver(Networks.mainnet());
        assertThatThrownBy(() -> deriver.deriveAddress("not-hex"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("config_nft_policy");
        assertThatThrownBy(() -> deriver.deriveAddress("ab".repeat(27))) // 54 chars
                .isInstanceOf(IllegalArgumentException.class);
    }
}
