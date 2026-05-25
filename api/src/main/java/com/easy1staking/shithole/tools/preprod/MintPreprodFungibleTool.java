package com.easy1staking.shithole.tools.preprod;

import com.bloxbean.cardano.client.account.Account;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.blockfrost.common.Constants;
import com.bloxbean.cardano.client.backend.blockfrost.service.BFBackendService;
import com.bloxbean.cardano.client.common.model.Networks;
import com.bloxbean.cardano.client.function.helper.SignerProviders;
import com.bloxbean.cardano.client.quicktx.QuickTxBuilder;
import com.bloxbean.cardano.client.quicktx.Tx;
import com.bloxbean.cardano.client.transaction.spec.Asset;
import com.bloxbean.cardano.client.transaction.spec.script.RequireTimeBefore;
import com.bloxbean.cardano.client.transaction.spec.script.ScriptAll;
import com.bloxbean.cardano.client.transaction.spec.script.ScriptPubkey;
import com.bloxbean.cardano.client.util.HexUtil;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * Operator tool — mint a preprod fungible token for marketplace testing.
 *
 * <p>Use case: spin up a mainnet-shaped ticker on preprod (HOSKY, USDM)
 * so {@code /market/new}'s price-token dropdown can resolve to a unit
 * the admin actually holds and can ship to test buyers. Asset name bytes
 * mirror mainnet (so wallets / explorers display the right ticker); the
 * policy id obviously differs (one-shot native policy bound to the
 * admin's pkh + a 10-minute time-before window).
 *
 * <p>Sets metadata label 20 ({@code CIP-26}, "off-chain registry") with
 * ticker / decimals / description / name to help wallets render the
 * token sensibly even when there's no public registry entry.
 *
 * <p>Args (positional):
 * <ol>
 *   <li>asset name ASCII (e.g. {@code HOSKY}, {@code USDM})</li>
 *   <li>supply (decimal string — interpreted in the SMALLEST unit; for
 *       a 6-decimal token like USDM, pass {@code 1000000000000000} for
 *       1B user-facing units)</li>
 *   <li>decimals (integer, used only for the registry metadata)</li>
 *   <li>ticker (display ticker — defaults to the asset name)</li>
 * </ol>
 *
 * <p>Env: {@code ADMIN_SEED}, {@code BLOCKFROST_PROJECT_ID} — sourced
 * from {@code api/.env.preprod} same as the other preprod tools.
 *
 * <p>Run:
 * <pre>
 *   set -a; source api/.env.preprod; set +a
 *   cd api && ./gradlew preprodMintFungible --args="HOSKY 1000000000 0 HOSKY"
 * </pre>
 */
public final class MintPreprodFungibleTool {

    private MintPreprodFungibleTool() {
    }

    /** Mint deadline = current slot + 10 minutes. */
    private static final long MINT_WINDOW_SLOTS = 600;

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            die("usage: <asset_name_ascii> <supply> <decimals> [ticker]");
        }
        String assetName = args[0];
        BigInteger supply = new BigInteger(args[1]);
        int decimals = Integer.parseInt(args[2]);
        String ticker = args.length >= 4 ? args[3] : assetName;

        if (supply.signum() <= 0) {
            die("supply must be > 0");
        }
        if (decimals < 0) {
            die("decimals must be >= 0");
        }

        String mnemonic = require("ADMIN_SEED");
        String projectId = require("BLOCKFROST_PROJECT_ID");

        Account account = new Account(Networks.preprod(), mnemonic);
        BackendService backend = new BFBackendService(
                Constants.BLOCKFROST_PREPROD_URL, projectId);

        long currentSlot = backend.getBlockService().getLatestBlock().getValue().getSlot();
        long mintDeadline = currentSlot + MINT_WINDOW_SLOTS;
        long txValidTo = currentSlot + MINT_WINDOW_SLOTS - 60;

        String adminPkhHex = HexUtil.encodeHexString(
                account.hdKeyPair().getPublicKey().getKeyHash());
        ScriptAll policy = new ScriptAll();
        policy.addScript(new ScriptPubkey(adminPkhHex));
        policy.addScript(new RequireTimeBefore(mintDeadline));
        String policyId = policy.getPolicyId();
        String assetNameHex = HexUtil.encodeHexString(
                assetName.getBytes(StandardCharsets.UTF_8));

        System.out.println("admin pkh    : " + adminPkhHex);
        System.out.println("policy id    : " + policyId);
        System.out.println("asset name   : " + assetName + " (hex " + assetNameHex + ")");
        System.out.println("supply       : " + supply
                + " (smallest unit) → " + humanSupply(supply, decimals)
                + " " + ticker);
        System.out.println("decimals     : " + decimals);
        System.out.println("mint deadline: slot " + mintDeadline + " (~10 min)");
        System.out.println();

        List<Asset> assets = List.of(
                Asset.builder().name(assetName).value(supply).build());

        String adminAddress = account.baseAddress();
        Tx tx = new Tx()
                .mintAssets(policy, assets, adminAddress)
                .from(adminAddress);

        QuickTxBuilder qtxBuilder = new QuickTxBuilder(backend);
        var result = qtxBuilder.compose(tx)
                .feePayer(adminAddress)
                .validTo(txValidTo)
                .withSigner(SignerProviders.signerFrom(account))
                .completeAndWait(Duration.ofMinutes(3),
                        msg -> System.out.println("[wait] " + msg));

        if (!result.isSuccessful()) {
            System.err.println("mint failed: " + result.getResponse());
            System.exit(1);
        }

        System.out.println();
        System.out.println("tx hash      : " + result.getValue());
        System.out.println();
        System.out.println("==============================================================");
        System.out.println("PREPROD FT REGISTRY ENTRY — paste into supportedPriceTokens.ts:");
        System.out.println();
        System.out.println("  {");
        System.out.println("    label: \"" + ticker + "\",");
        System.out.println("    ticker: \"" + ticker + "\",");
        System.out.println("    unit: \"" + policyId + assetNameHex + "\",");
        System.out.println("    decimals: " + decimals + ",");
        System.out.println("  },");
        System.out.println("==============================================================");
    }

    private static String humanSupply(BigInteger raw, int decimals) {
        if (decimals == 0) return raw.toString();
        BigInteger divisor = BigInteger.TEN.pow(decimals);
        BigInteger whole = raw.divide(divisor);
        BigInteger frac = raw.mod(divisor);
        if (frac.signum() == 0) return whole.toString();
        String fracStr = frac.toString();
        // Left-pad with zeros to width=decimals, then trim trailing zeros.
        while (fracStr.length() < decimals) fracStr = "0" + fracStr;
        fracStr = fracStr.replaceFirst("0+$", "");
        return whole + "." + fracStr;
    }

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            System.err.println("Missing env var " + name + ". Source api/.env.preprod first.");
            System.exit(2);
        }
        return v;
    }

    private static void die(String msg) {
        System.err.println("ERROR: " + msg);
        System.exit(1);
    }
}
