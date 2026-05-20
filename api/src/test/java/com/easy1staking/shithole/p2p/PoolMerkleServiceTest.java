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

    @Test
    void poolMembershipIndexIsBuiltCorrectly() {
        // NAME_A is in HOSKY + A3C; NAME_B in HOSKY; NAME_C in none.
        service.cachePoolMembership("HOSKY", List.of(HEX.formatHex(NAME_A), HEX.formatHex(NAME_B)));
        service.cachePoolMembership("A3C", List.of(HEX.formatHex(NAME_A)));

        assertThat(service.getPoolMembership(HEX.formatHex(NAME_A)))
                .containsExactlyInAnyOrder("HOSKY", "A3C");
        assertThat(service.getPoolMembership(HEX.formatHex(NAME_B)))
                .containsExactly("HOSKY");
        assertThat(service.getPoolMembership(HEX.formatHex(NAME_C))).isEmpty();
    }

    @Test
    void poolMembershipLookupIsCaseInsensitive() {
        service.cachePoolMembership("HOSKY", List.of(HEX.formatHex(NAME_A).toUpperCase()));
        // Stored normalised; lookup with either case works.
        assertThat(service.getPoolMembership(HEX.formatHex(NAME_A).toLowerCase()))
                .containsExactly("HOSKY");
        assertThat(service.getPoolMembership(HEX.formatHex(NAME_A).toUpperCase()))
                .containsExactly("HOSKY");
    }

    @Test
    void poolMembershipIsIdempotentOnReinsert() {
        // Replaying the same (ticker, asset) pair (e.g. from a re-boot
        // hitting the same seed) doesn't dupe tickers in the result list.
        service.cachePoolMembership("HOSKY", List.of(HEX.formatHex(NAME_A)));
        service.cachePoolMembership("HOSKY", List.of(HEX.formatHex(NAME_A)));
        assertThat(service.getPoolMembership(HEX.formatHex(NAME_A)))
                .containsExactly("HOSKY");
    }

    /* ============================================================ */
    /* isMember / isMatchableBoth — matcher-facing predicates       */
    /* ============================================================ */

    @Test
    void isMember_trueForKnownLeaf() {
        List<byte[]> items = List.of(NAME_A, NAME_B, NAME_C);
        byte[] root = service.computeRoot(items);
        service.cacheTree(root, items);

        assertThat(service.isMember(root, NAME_A)).isTrue();
        assertThat(service.isMember(root, NAME_B)).isTrue();
        assertThat(service.isMember(root, NAME_C)).isTrue();
    }

    @Test
    void isMember_falseForUnknownLeaf() {
        List<byte[]> items = List.of(NAME_A, NAME_B);
        byte[] root = service.computeRoot(items);
        service.cacheTree(root, items);

        // NAME_C isn't in the tree.
        assertThat(service.isMember(root, NAME_C)).isFalse();
    }

    @Test
    void isMember_falseForUnknownRoot() {
        // Repo lookup returns empty for an unknown root.
        when(repo.findById(new byte[32])).thenReturn(Optional.empty());
        assertThat(service.isMember(new byte[32], NAME_A)).isFalse();
    }

    @Test
    void isMatchableBoth_trueWhenBothDirectionsAreMembers() {
        // Two trees:
        //   rootA accepts NAME_B
        //   rootB accepts NAME_A
        // Pair {offered_A=NAME_A, offered_B=NAME_B} matches both ways.
        byte[] rootA = service.computeRoot(List.of(NAME_B));
        byte[] rootB = service.computeRoot(List.of(NAME_A));
        service.cacheTree(rootA, List.of(NAME_B));
        service.cacheTree(rootB, List.of(NAME_A));

        assertThat(service.isMatchableBoth(rootA, NAME_B, rootB, NAME_A)).isTrue();
    }

    @Test
    void isMatchableBoth_falseWhenOnlyOneDirectionMatches() {
        // rootA accepts NAME_B, but rootB does NOT accept NAME_A
        // (rootB's only leaf is NAME_C, not NAME_A).
        byte[] rootA = service.computeRoot(List.of(NAME_B));
        byte[] rootB = service.computeRoot(List.of(NAME_C));
        service.cacheTree(rootA, List.of(NAME_B));
        service.cacheTree(rootB, List.of(NAME_C));

        assertThat(service.isMatchableBoth(rootA, NAME_B, rootB, NAME_A)).isFalse();
        // Swapping direction also false (it's the OTHER pair that doesn't
        // satisfy, but the predicate is symmetric in its boolean output).
        assertThat(service.isMatchableBoth(rootB, NAME_A, rootA, NAME_B)).isFalse();
    }

    @Test
    void isMatchableBoth_falseWhenNeitherDirectionMatches() {
        // Two unrelated trees with no overlap.
        byte[] rootA = service.computeRoot(List.of(NAME_A));
        byte[] rootB = service.computeRoot(List.of(NAME_B));
        service.cacheTree(rootA, List.of(NAME_A));
        service.cacheTree(rootB, List.of(NAME_B));

        // Pair {offered_A=NAME_C, offered_B=NAME_C} matches nothing.
        assertThat(service.isMatchableBoth(rootA, NAME_C, rootB, NAME_C)).isFalse();
    }
}
