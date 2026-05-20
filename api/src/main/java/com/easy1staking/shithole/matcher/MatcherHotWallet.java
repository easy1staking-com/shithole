package com.easy1staking.shithole.matcher;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.transaction.spec.Transaction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Conditional;
import org.springframework.stereotype.Component;

/**
 * Dedicated hot-wallet for the autonomous P2P matcher bot. Single-address
 * for v1 — collateral, fee-payment, and change all live at the same
 * base-address derived from the mnemonic. Multi-address rotation is a
 * follow-up.
 *
 * <p>Wired only when {@code shithole.p2p.matcher.enabled=true}. Operator
 * MUST supply {@code SHITHOLE_MATCHER_MNEMONIC} (env var) — boot fails
 * fast with a clear message otherwise. Mnemonic is NEVER logged; only the
 * derived bech32 address is printed on startup so ops can confirm the
 * right wallet was loaded.
 *
 * <p>Network selection follows {@code app.network} (same {@link Network}
 * bean every other component uses), so the wallet's address always matches
 * the network the rest of the BE is talking to.
 */
@Component
@Conditional(MatcherHotWallet.AnyBotEnabledCondition.class)
@Slf4j
public class MatcherHotWallet {

    /**
     * Wires the wallet when EITHER the matcher OR the auto-fulfill loop is
     * enabled. Both bots share the same hot wallet by design (received NFTs
     * rotate back into the inventory the other loop reads). Operator MUST
     * still supply {@code SHITHOLE_MATCHER_MNEMONIC} — the
     * constructor fails fast otherwise.
     */
    public static class AnyBotEnabledCondition
            implements org.springframework.context.annotation.ConfigurationCondition {
        @Override
        public boolean matches(org.springframework.context.annotation.ConditionContext ctx,
                               org.springframework.core.type.AnnotatedTypeMetadata md) {
            var env = ctx.getEnvironment();
            return "true".equalsIgnoreCase(env.getProperty("shithole.p2p.matcher.enabled"))
                    || "true".equalsIgnoreCase(env.getProperty("shithole.p2p.auto-fulfill.enabled"));
        }
        @Override
        public ConfigurationPhase getConfigurationPhase() {
            return ConfigurationPhase.REGISTER_BEAN;
        }
    }

    private final Network network;
    private final Account account;
    private final String address;

    public MatcherHotWallet(
            Network network,
            @Value("${shithole.p2p.matcher.mnemonic:}") String mnemonic) {
        this.network = network;
        String seedPhrase = requireMnemonic(mnemonic);
        // Keep the secret in a local variable only. The Spring/env String and
        // CCL Account internals are outside our control, but this bean no
        // longer retains an extra long-lived mnemonic field.
        this.account = new Account(network, seedPhrase);
        this.address = account.baseAddress();
        log.info("MatcherHotWallet: derived bot address={} (network protocol_magic={})",
                address, network.getProtocolMagic());
    }

    private static String requireMnemonic(String mnemonic) {
        if (mnemonic == null || mnemonic.isBlank()) {
            // Fail fast — operator enabled at least one of the P2P bot loops
            // but didn't supply the shared hot-wallet mnemonic. Silent disable
            // would let funds and signing requests route to whatever address
            // happened to come up; loud crash is the only safe behaviour.
            throw new IllegalStateException(
                    "One of shithole.p2p.matcher.enabled / shithole.p2p.auto-fulfill.enabled is true "
                            + "but SHITHOLE_MATCHER_MNEMONIC is missing/blank. "
                            + "Either supply the mnemonic via env, or disable both bot loops.");
        }
        return mnemonic;
    }

    public String getAddress() {
        return address;
    }

    public Account getAccount() {
        return account;
    }

    public byte[] getPaymentPkh() {
        return account.hdKeyPair().getPublicKey().getKeyHash();
    }

    /**
     * Sign a built transaction with the bot's payment key. Delegates to
     * the {@link Account#sign(Transaction)} helper.
     */
    public Transaction signTx(Transaction tx) {
        return account.sign(tx);
    }

    /**
     * Defensive toString — never include the mnemonic. Even via lombok
     * or accidental logger.info(wallet) the secret stays opaque.
     */
    @Override
    public String toString() {
        return "MatcherHotWallet{address=" + address + "}";
    }
}
