package com.easy1staking.shithole.p2p;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import org.cardanofoundation.merkle.ProofItem;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Tests for {@link PoolMerkleService}. The library calls are real (no mocks),
 * since the load-bearing invariant is byte-compatibility with
 * {@code aiken_merkle_tree/mt} — a unit test that mocks the library proves
 * nothing about the real construction. Repository is mocked so the test runs
 * without a DB.
 */
@ExtendWith(MockitoExtension.class)
class PoolMerkleServiceTest {

    private static final HexFormat HEX = HexFormat.of();

    /** Three 28-byte asset_names lexicographic-ascending (canonical order). */
    private static final byte[] NAME_A = HEX.parseHex("aabbccddeeff00112233445566778899aabbccddeeff001122334411");
    private static final byte[] NAME_B = HEX.parseHex("aabbccddeeff00112233445566778899aabbccddeeff001122334422");
    private static final byte[] NAME_C = HEX.parseHex("aabbccddeeff00112233445566778899aabbccddeeff001122334433");

    @Mock
    private PoolMerkleRootRepository repo;

    private PoolMerkleService service;

    @BeforeEach
    void setUp() {
        service = new PoolMerkleService(repo);
    }

    @Test
    void computeRootIsDeterministic() {
        List<byte[]> items = List.of(NAME_A, NAME_B, NAME_C);
        byte[] root1 = service.computeRoot(items);
        byte[] root2 = service.computeRoot(items);
        assertThat(root1).isEqualTo(root2);
        assertThat(root1).hasSize(32);
    }

    @Test
    void computeRootIsOrderSensitive() {
        // Library is left-leaning split-by-half — different order ⇒ different root.
        byte[] rootAsc = service.computeRoot(List.of(NAME_A, NAME_B, NAME_C));
        byte[] rootDesc = service.computeRoot(List.of(NAME_C, NAME_B, NAME_A));
        assertThat(rootAsc).isNotEqualTo(rootDesc);
    }

    @Test
    void proofRoundTripsThroughVerify() {
        List<byte[]> items = List.of(NAME_A, NAME_B, NAME_C);
        byte[] root = service.computeRoot(items);
        service.cacheTree(root, items);

        Optional<List<ProofItem>> proof = service.getProof(root, NAME_B);

        assertThat(proof).isPresent();
        assertThat(service.verifyProof(root, NAME_B, proof.get())).isTrue();
        // Proof for the WRONG leaf does NOT verify.
        assertThat(service.verifyProof(root, NAME_A, proof.get())).isFalse();
    }

    @Test
    void getProofReturnsEmptyForUnknownAssetName() {
        List<byte[]> items = List.of(NAME_A, NAME_B);
        byte[] root = service.computeRoot(items);
        service.cacheTree(root, items);

        // NAME_C is not in the tree.
        Optional<List<ProofItem>> proof = service.getProof(root, NAME_C);
        assertThat(proof).isEmpty();
    }

    @Test
    void cacheTreeRejectsRootDrift() {
        // Caller supplies a root that doesn't match the asset_names list.
        // Service must throw — silently caching a drifted tree would let
        // bogus proofs propagate.
        byte[] bogusRoot = new byte[32]; // all zeros
        assertThatThrownBy(() -> service.cacheTree(bogusRoot, List.of(NAME_A, NAME_B)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("merkle root mismatch");
    }

    @Test
    void treeForRootLazyLoadsFromRepoOnCacheMiss() {
        // Service has no tree cached; DB carries a row. Service must rebuild
        // from asset_names_hex AND verify it produces the row's claimed root.
        List<byte[]> items = List.of(NAME_A, NAME_B);
        byte[] root = service.computeRoot(items);
        PoolMerkleRootEntity row = PoolMerkleRootEntity.builder()
                .merkleRoot(root)
                .ticker("TESTPOOL")
                .assetNamesHex(List.of(HEX.formatHex(NAME_A), HEX.formatHex(NAME_B)))
                .totalAssets(2)
                .isActive(true)
                .sourceNftVersion("test")
                .sourceCurationVersion("test")
                .computedAt(OffsetDateTime.now())
                .build();
        when(repo.findById(root)).thenReturn(Optional.of(row));

        Optional<List<ProofItem>> proof = service.getProof(root, NAME_A);

        assertThat(proof).isPresent();
        assertThat(service.verifyProof(root, NAME_A, proof.get())).isTrue();
    }

    @Test
    void treeForRootDetectsDbTampering() {
        // DB row claims one merkle_root but its asset_names_hex hashes to a
        // different one. Service must throw to alert ops to tampering.
        List<byte[]> items = List.of(NAME_A, NAME_B);
        byte[] honestRoot = service.computeRoot(items);
        // Plant a row whose merkle_root is the HONEST root but whose
        // assetNamesHex list is missing NAME_B (subset → different root).
        PoolMerkleRootEntity tamperedRow = PoolMerkleRootEntity.builder()
                .merkleRoot(honestRoot)
                .ticker("TESTPOOL")
                .assetNamesHex(List.of(HEX.formatHex(NAME_A)))
                .totalAssets(1)
                .isActive(true)
                .sourceNftVersion("test")
                .sourceCurationVersion("test")
                .computedAt(OffsetDateTime.now())
                .build();
        when(repo.findById(honestRoot)).thenReturn(Optional.of(tamperedRow));

        assertThatThrownBy(() -> service.getProof(honestRoot, NAME_A))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("drifted from DB row root");
    }

    @Test
    void getProofForUnknownRootReturnsEmpty() {
        byte[] unknownRoot = new byte[32];
        when(repo.findById(unknownRoot)).thenReturn(Optional.empty());

        Optional<List<ProofItem>> proof = service.getProof(unknownRoot, NAME_A);
        assertThat(proof).isEmpty();
    }
}
