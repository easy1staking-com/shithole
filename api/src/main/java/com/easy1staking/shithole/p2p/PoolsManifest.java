package com.easy1staking.shithole.p2p;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * On-disk shape of {@code classpath:p2p/pools.json}. The committed source of
 * truth for v3 curated pools; the {@link PoolMerkleSeeder} reads it on boot,
 * verifies each pool's claimed merkle root against a recompute, and persists
 * the rows into {@code pool_merkle_roots}.
 *
 * <p>{@link PoolEntry#assetNamesHex()} order is LOAD-BEARING — the
 * aiken_merkle_tree library is order-sensitive (left-leaning split-by-half).
 * The builder ({@code PoolMerkleBuilder}) emits lexicographic-ascending order
 * and the seeder verifies the order produces the claimed root.
 */
public record PoolsManifest(
        @JsonProperty("version") int version,
        @JsonProperty("generated_at") String generatedAt,
        @JsonProperty("source") Source source,
        @JsonProperty("pools") List<PoolEntry> pools) {

    /**
     * Provenance of the manifest's inputs. {@code jsonl_sha256} is the
     * sha2_256 of the {@code nft_traits.jsonl} the builder consumed; matches
     * the {@code sourceVersion} stamped on every nft_traits row at the same
     * generation, so an entry in {@code pool_merkle_roots} is fully
     * reconstructible from the snapshot.
     */
    public record Source(
            @JsonProperty("csv") String csv,
            @JsonProperty("jsonl_sha256") String jsonlSha256) {
    }

    public record PoolEntry(
            @JsonProperty("ticker") String ticker,
            @JsonProperty("pool_id_hex") String poolIdHex,
            @JsonProperty("merkle_root_hex") String merkleRootHex,
            @JsonProperty("asset_names_hex") List<String> assetNamesHex,
            @JsonProperty("total_assets") int totalAssets) {
    }
}
