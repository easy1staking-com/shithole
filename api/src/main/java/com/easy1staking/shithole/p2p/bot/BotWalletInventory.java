package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.model.Utxo;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Snapshot of the auto-fulfiller bot's hot-wallet NFT holdings — one entry
 * per distinct (policy_id, asset_name) that the wallet currently holds at
 * quantity exactly 1. Built fresh on every block (no caching beyond the scan
 * cycle).
 *
 * <p>Storage shape: {@code policyHex (lower) → assetNameHex (lower) → Utxo}.
 * The {@link Utxo} reference is the SPECIFIC UTxO holding the NFT — we
 * capture it at detect-time so the tx builder can force it into the tx's
 * inputs (defends against the balancer picking a different ADA-only UTxO and
 * leaving negative-quantity change, the same defense
 * {@code PreprodFulfillP2pTool} carries).
 *
 * <p>Quantity-1 filter: an NFT by construction is quantity-1; > 1 means
 * either a fungible token sharing the policy_id or a multi-quantity oddity
 * — neither is safe to auto-deposit, so we skip them.
 */
@Getter
@AllArgsConstructor
public class BotWalletInventory {

    private final Map<String, Map<String, Utxo>> byPolicyAndAssetHex;

    public static BotWalletInventory empty() {
        return new BotWalletInventory(Collections.emptyMap());
    }

    /**
     * Build an inventory snapshot from a list of wallet UTxOs (typically from
     * {@code backendService.getUtxoService().getUtxos(walletAddress, ...)}
     * paged into a single flat list).
     */
    public static BotWalletInventory from(List<Utxo> walletUtxos) {
        Map<String, Map<String, Utxo>> idx = new HashMap<>();
        for (Utxo u : walletUtxos) {
            if (u == null || u.getAmount() == null) continue;
            for (var amt : u.getAmount()) {
                if (amt == null) continue;
                String unit = amt.getUnit();
                if (unit == null || unit.length() <= 56) continue;
                // NFT invariant — quantity 1. Skip fungibles / oddities.
                if (amt.getQuantity() == null
                        || amt.getQuantity().signum() <= 0
                        || !amt.getQuantity().toString().equals("1")) {
                    continue;
                }
                String policyHex = unit.substring(0, 56).toLowerCase(Locale.ROOT);
                String assetNameHex = unit.substring(56).toLowerCase(Locale.ROOT);
                idx.computeIfAbsent(policyHex, k -> new HashMap<>())
                        .putIfAbsent(assetNameHex, u);
            }
        }
        return new BotWalletInventory(idx);
    }

    public boolean isEmpty() {
        return byPolicyAndAssetHex.values().stream().allMatch(Map::isEmpty);
    }

    public int totalCount() {
        return byPolicyAndAssetHex.values().stream().mapToInt(Map::size).sum();
    }

    /**
     * For a given collection_policy_id (28-byte hex), return the
     * {@code assetNameHex → Utxo} map of NFTs the wallet holds under that
     * policy. Empty map when none.
     */
    public Map<String, Utxo> forCollection(String collectionPolicyHex) {
        if (collectionPolicyHex == null) return Collections.emptyMap();
        Map<String, Utxo> m = byPolicyAndAssetHex.get(collectionPolicyHex.toLowerCase(Locale.ROOT));
        return m == null ? Collections.emptyMap() : m;
    }

    /** Convenience — look up the UTxO holding (policyHex, assetNameHex). */
    public Utxo getUtxo(String collectionPolicyHex, String assetNameHex) {
        Map<String, Utxo> m = forCollection(collectionPolicyHex);
        return m.get(Objects.requireNonNull(assetNameHex).toLowerCase(Locale.ROOT));
    }

    /** Helper for byte[] callers — converts asset_name bytes to lowercase hex. */
    public static String hex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Helper — equality check (used in unit tests). */
    public boolean containsAsset(String policyHex, byte[] assetName) {
        Map<String, Utxo> m = forCollection(policyHex);
        if (m == null || m.isEmpty()) return false;
        for (String k : m.keySet()) {
            if (Arrays.equals(hexBytes(k), assetName)) return true;
        }
        return false;
    }

    private static byte[] hexBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return out;
    }
}
