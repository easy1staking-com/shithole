package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.api.exception.ApiException;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.blockfrost.common.Constants;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Networks;

import java.math.BigInteger;
import java.util.Comparator;
import java.util.List;

/**
 * Operator tool: print the preprod UTxO summary for the address derived from
 * {@code ADMIN_SEED}. Uses CCL's Blockfrost backend (the same one the BE wires
 * for the registration endpoint), so the project id never lands on the shell
 * command line.
 */
public final class CheckBalanceTool {

    private CheckBalanceTool() {}

    public static void main(String[] args) throws ApiException {
        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");

        Account account = new Account(Networks.preprod(), mnemonic);
        String address = account.baseAddress();

        BackendService backend = new BFBackendService(Constants.BLOCKFROST_PREPROD_URL, projectId);

        // Also report the current preprod tip — Yaci's sync-start needs BOTH
        // a slot AND a blockhash at that slot to skip ahead from genesis.
        try {
            var blockResult = backend.getBlockService().getLatestBlock();
            if (blockResult.isSuccessful()) {
                var b = blockResult.getValue();
                System.out.println("preprod tip slot : " + b.getSlot());
                System.out.println("preprod tip hash : " + b.getHash());
                System.out.println();
                System.out.println("Yaci sync-start fixture (paste these into api/.env.preprod):");
                System.out.println("  SHITHOLE_INDEXER_START_SLOT=" + b.getSlot());
                System.out.println("  SHITHOLE_INDEXER_START_BLOCKHASH=" + b.getHash());
                System.out.println();
            }
        } catch (Exception ignored) {
            // Tip query is best-effort; don't fail the balance check.
        }

        Result<List<Utxo>> result = backend.getUtxoService().getUtxos(address, 100, 1);
        if (!result.isSuccessful()) {
            // The Blockfrost address endpoint returns 404 when an address has
            // never been used. Treat that as "0 UTxOs" rather than an error.
            if (result.code() == 404) {
                System.out.println("address : " + address);
                System.out.println("status  : not yet seen on chain (0 UTxOs)");
                System.out.println("\nFund via https://docs.cardano.org/cardano-testnets/tools/faucet/ (preprod).");
                return;
            }
            System.err.println("Blockfrost error " + result.code() + ": " + result.getResponse());
            System.exit(1);
            return;
        }

        List<Utxo> utxos = result.getValue();
        BigInteger totalLovelace = utxos.stream()
                .flatMap(u -> u.getAmount().stream())
                .filter(a -> "lovelace".equals(a.getUnit()))
                .map(a -> a.getQuantity())
                .reduce(BigInteger.ZERO, BigInteger::add);

        System.out.println("address : " + address);
        System.out.println("utxos   : " + utxos.size());
        System.out.println("ADA     : " + totalLovelace.divide(BigInteger.valueOf(1_000_000)) + " tADA"
                + " (" + totalLovelace + " lovelace)");

        if (utxos.isEmpty()) {
            System.out.println("\nWallet is empty. Fund via https://docs.cardano.org/cardano-testnets/tools/faucet/.");
            return;
        }

        System.out.println("\nUTxOs (top 5 by lovelace):");
        utxos.stream()
                .sorted(Comparator.comparing(CheckBalanceTool::lovelaceOf).reversed())
                .limit(5)
                .forEach(u -> {
                    BigInteger lov = lovelaceOf(u);
                    int otherAssets = (int) u.getAmount().stream()
                            .filter(a -> !"lovelace".equals(a.getUnit()))
                            .count();
                    System.out.println(String.format(
                            "  %s#%d  %s tADA  +%d other assets",
                            u.getTxHash(), u.getOutputIndex(),
                            lov.divide(BigInteger.valueOf(1_000_000)),
                            otherAssets));
                });
    }

    private static BigInteger lovelaceOf(Utxo u) {
        return u.getAmount().stream()
                .filter(a -> "lovelace".equals(a.getUnit()))
                .findFirst()
                .map(a -> a.getQuantity())
                .orElse(BigInteger.ZERO);
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            System.err.println("Missing env var " + name + ". Source api/.env.preprod first.");
            System.exit(2);
        }
        return v;
    }
}
