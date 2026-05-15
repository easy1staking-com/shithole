package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.util.HexUtil;

/**
 * Operator tool: print the preprod payment address derived from {@code ADMIN_SEED}
 * (or the env var named by the first CLI arg), plus the payment-credential hash
 * (= the admin_pkh you'll paste into the curation form).
 *
 * <p>Run from the repo root:
 * <pre>
 *   set -a; source api/.env.preprod; set +a; cd api && ./gradlew preprodDeriveAddress
 * </pre>
 *
 * <p>This lives in {@code main/} (not {@code test/}) because operator tools are
 * production code paths; the {@code tools/preprod} package is a documentation
 * boundary, not a sourceSet boundary.
 */
public final class DeriveAddressTool {

    private DeriveAddressTool() {}

    public static void main(String[] args) {
        String seedEnv = args.length > 0 ? args[0] : "ADMIN_SEED";
        String networkArg = args.length > 1 ? args[1] : "preprod";

        String mnemonic = System.getenv(seedEnv);
        if (mnemonic == null || mnemonic.isBlank()) {
            System.err.println("Missing " + seedEnv + " env var. Source api/.env.preprod first.");
            System.exit(2);
            return;
        }

        Network network = switch (networkArg.toLowerCase()) {
            case "mainnet" -> Networks.mainnet();
            case "preprod" -> Networks.preprod();
            case "preview" -> Networks.preview();
            default -> throw new IllegalArgumentException("Unsupported network: " + networkArg);
        };

        Account account = new Account(network, mnemonic);
        Address base = new Address(account.baseAddress());

        System.out.println("network              : " + networkArg);
        System.out.println("base address         : " + account.baseAddress());
        System.out.println("enterprise address   : " + account.enterpriseAddress());
        System.out.println("stake address        : " + account.stakeAddress());
        System.out.println();
        System.out.println("payment cred hash    : " + HexUtil.encodeHexString(
                AddressProvider.getPaymentCredentialHash(base).orElseThrow()));
        System.out.println("stake   cred hash    : " + HexUtil.encodeHexString(
                AddressProvider.getDelegationCredentialHash(base).orElseThrow()));
    }
}
