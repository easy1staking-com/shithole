package com.easy1staking.shithole.p2p;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cardanofoundation.merkle.MerkleElement;
import org.cardanofoundation.merkle.MerkleTree;
import org.cardanofoundation.merkle.ProofItem;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Thin wrapper over {@code merkle-tree-java:0.0.7}, plus a per-root cache of
 * built {@link MerkleElement} trees so proof generation is O(log n) on a hit
 * (not O(n) tree rebuild on every request).
 *
 * <p>The library's serialiser for our use case is {@link Function#identity()}
 * — leaves are raw 28-byte asset_names, the library hashes via sha2_256
 * internally. {@link MerkleElement#itemHash()} returns the 32-byte root.
 *
 * <p>Cache is keyed by lowercase-hex of the root (so {@code byte[]}'s
 * reference-equality doesn't bite). Population happens up-front via
 * {@link #cacheTree(byte[], List)} (called by the seeder for every root
 * known at boot) and lazily via {@link #treeForRoot(byte[])} (rebuilds from
 * the DB row's {@code assetNamesHex} on a miss — covers historical roots
 * that didn't make it into the current {@code pools.json}).
 *
 * <p>Byte-compatibility with the on-chain
 * {@code aiken_merkle_tree/mt.is_member} is the load-bearing invariant: BE
 * builds + serves a proof, FE puts it in a {@code Fulfill} redeemer,
 * validator verifies — same library, same byte-level construction, no
 * algorithmic drift.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PoolMerkleService {

    private static final HexFormat HEX = HexFormat.of();
    private static final Function<byte[], byte[]> IDENTITY_SERIALISER = bytes -> bytes;

    private final PoolMerkleRootRepository poolMerkleRootRepository;

    /** root_hex → built tree. ConcurrentHashMap because lazy-load is read-heavy. */
    private final ConcurrentHashMap<String, MerkleElement<byte[]>> treesByRootHex =
            new ConcurrentHashMap<>();

    /**
     * Build a tree from a canonical-ordered asset_names list and return its
     * 32-byte root. Used by the seeder during the recompute-and-verify phase
     * and by {@code PoolMerkleBuilder} when authoring {@code pools.json}.
     *
     * <p>Order is load-bearing — the library is left-leaning split-by-half.
     */
    public byte[] computeRoot(List<byte[]> assetNames) {
        return buildTree(assetNames).itemHash();
    }

    /**
     * Build a tree and return the {@link MerkleElement} root for further use
     * (e.g. proof generation).
     */
    public MerkleElement<byte[]> buildTree(List<byte[]> assetNames) {
        return MerkleTree.fromList(assetNames, IDENTITY_SERIALISER);
    }

    /**
     * Cache a built tree keyed by its root hash. The seeder calls this once
     * per active pool at boot so the in-memory map is hot before the first
     * proof request.
     */
    public void cacheTree(byte[] merkleRoot, List<byte[]> assetNames) {
        MerkleElement<byte[]> tree = buildTree(assetNames);
        if (!Arrays.equals(tree.itemHash(), merkleRoot)) {
            throw new IllegalStateException(
                    "merkle root mismatch when caching tree: expected "
                            + HEX.formatHex(merkleRoot)
                            + " but recomputed "
                            + HEX.formatHex(tree.itemHash()));
        }
        treesByRootHex.put(HEX.formatHex(merkleRoot), tree);
    }

    /**
     * Return the tree for a root, building it lazily from the DB if not
     * already cached. Returns {@code Optional.empty()} when no row exists.
     */
    public Optional<MerkleElement<byte[]>> treeForRoot(byte[] merkleRoot) {
        String key = HEX.formatHex(merkleRoot);
        MerkleElement<byte[]> cached = treesByRootHex.get(key);
        if (cached != null) {
            return Optional.of(cached);
        }
        return poolMerkleRootRepository.findById(merkleRoot)
                .map(this::rebuildAndCache);
    }

    /**
     * Generate a membership proof for {@code assetName} in the tree
     * identified by {@code merkleRoot}. Returns {@code Optional.empty()}
     * when either the root is unknown or the asset_name is not a leaf.
     */
    public Optional<List<ProofItem>> getProof(byte[] merkleRoot, byte[] assetName) {
        return treeForRoot(merkleRoot)
                .flatMap(tree -> MerkleTree.getProof(tree, assetName, IDENTITY_SERIALISER)
                        .map(PoolMerkleService::toJavaList));
    }

    /**
     * Verify a proof. Mainly useful for tests / smoke checks; the actual
     * on-chain verification is what matters in production.
     */
    public boolean verifyProof(byte[] merkleRoot, byte[] assetName, List<ProofItem> proof) {
        return MerkleTree.verifyProof(
                merkleRoot, assetName, io.vavr.collection.List.ofAll(proof), IDENTITY_SERIALISER);
    }

    private MerkleElement<byte[]> rebuildAndCache(PoolMerkleRootEntity row) {
        List<byte[]> assetNames = row.getAssetNamesHex().stream()
                .map(HEX::parseHex)
                .toList();
        MerkleElement<byte[]> tree = buildTree(assetNames);
        if (!Arrays.equals(tree.itemHash(), row.getMerkleRoot())) {
            throw new IllegalStateException(
                    "rebuilt tree root drifted from DB row root: row "
                            + HEX.formatHex(row.getMerkleRoot())
                            + " vs rebuilt "
                            + HEX.formatHex(tree.itemHash())
                            + " — pool_merkle_roots.asset_names_hex tampering?");
        }
        treesByRootHex.put(HEX.formatHex(row.getMerkleRoot()), tree);
        return tree;
    }

    private static <T> List<T> toJavaList(io.vavr.collection.List<T> vavr) {
        return vavr.toJavaList();
    }
}
