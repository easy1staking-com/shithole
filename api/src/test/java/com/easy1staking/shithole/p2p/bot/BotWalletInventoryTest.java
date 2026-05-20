package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.model.Amount;
import com.bloxbean.cardano.client.api.model.Utxo;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class BotWalletInventoryTest {

    private static final String POLICY_A = "aa".repeat(28);
    private static final String POLICY_B = "bb".repeat(28);
    private static final String NAME_X = "0123";
    private static final String NAME_Y = "4567";

    @Test
    void groupsNftsByPolicyAndAssetName() {
        Utxo u1 = utxoWithNft(POLICY_A, NAME_X);
        Utxo u2 = utxoWithNft(POLICY_A, NAME_Y);
        Utxo u3 = utxoWithNft(POLICY_B, NAME_X);

        BotWalletInventory inv = BotWalletInventory.from(List.of(u1, u2, u3));
        assertThat(inv.totalCount()).isEqualTo(3);
        assertThat(inv.forCollection(POLICY_A)).hasSize(2);
        assertThat(inv.forCollection(POLICY_A)).containsKeys(NAME_X, NAME_Y);
        assertThat(inv.forCollection(POLICY_B)).hasSize(1);
        assertThat(inv.getUtxo(POLICY_A, NAME_X)).isEqualTo(u1);
    }

    @Test
    void skipsFungibleQuantities() {
        // Quantity > 1 — not an NFT. Skip.
        Utxo fungible = Utxo.builder()
                .txHash("aa".repeat(32))
                .outputIndex(0)
                .amount(List.of(
                        Amount.builder().unit("lovelace").quantity(BigInteger.valueOf(2_000_000L)).build(),
                        Amount.builder().unit(POLICY_A + NAME_X).quantity(BigInteger.valueOf(1000)).build()))
                .build();
        BotWalletInventory inv = BotWalletInventory.from(List.of(fungible));
        assertThat(inv.isEmpty()).isTrue();
    }

    @Test
    void caseInsensitiveLookup() {
        Utxo u = utxoWithNft(POLICY_A.toUpperCase(), NAME_X.toUpperCase());
        BotWalletInventory inv = BotWalletInventory.from(List.of(u));
        // Stored normalised; lookup with either case works.
        assertThat(inv.getUtxo(POLICY_A.toLowerCase(), NAME_X.toLowerCase())).isEqualTo(u);
        assertThat(inv.getUtxo(POLICY_A.toUpperCase(), NAME_X.toUpperCase())).isEqualTo(u);
    }

    @Test
    void emptyInventoryIsEmpty() {
        BotWalletInventory inv = BotWalletInventory.empty();
        assertThat(inv.isEmpty()).isTrue();
        assertThat(inv.totalCount()).isZero();
        assertThat(inv.forCollection(POLICY_A)).isEmpty();
    }

    private static Utxo utxoWithNft(String policyHex, String assetNameHex) {
        return Utxo.builder()
                .txHash("aa".repeat(32))
                .outputIndex(0)
                .address("addr_test1_x")
                .amount(List.of(
                        Amount.builder().unit("lovelace").quantity(BigInteger.valueOf(2_000_000L)).build(),
                        Amount.builder().unit(policyHex + assetNameHex).quantity(BigInteger.ONE).build()))
                .build();
    }
}
