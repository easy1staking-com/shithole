package com.easy1staking.shithole.tools.p2p;

import com.bloxbean.cardano.client.crypto.Bech32;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.cardanofoundation.merkle.MerkleTree;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.zip.GZIPOutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * Gradle-task entrypoint that authors {@code api/src/main/resources/p2p/pools.json}
 * from the off-line trait scan + curation CSV. Invoked via {@code
 * ./gradlew p2pBuildPoolMerkle}.
 *
 * <p>Inputs (paths default to the project layout; override via CLI args):
 * <ul>
 *   <li>{@code --jsonl <path>} — newline-delimited NFT records produced by
 *       {@code .local/scan-hosky-traits.py}. One JSON per line with at
 *       minimum {@code asset_name} (hex) + {@code traits} ({@code {category,
 *       value}} object).</li>
 *   <li>{@code --csv <path>} — curation CSV with header {@code Pool Name,
 *       Trait Name,Trait Count,Total Count for Pool,Category,Pool ID}.
 *       Each row is one accepted trait for that pool.</li>
 *   <li>{@code --out <path>} — destination {@code pools.json}.</li>
 * </ul>
 *
 * <p>Algorithm:
 * <ol>
 *   <li>Parse the CSV → {@code Map<ticker, PoolCuration>} where each
 *       {@code PoolCuration} carries the bech32 pool id (single, validated
 *       across rows) + a set of {@code (category, value)} pairs.</li>
 *   <li>Stream the JSONL once (NOT materialize) and for each NFT, push its
 *       28-byte asset_name onto every pool whose accepted-trait set
 *       intersects the NFT's traits. Categories are normalised to lower-case
 *       to bridge the CSV ↔ JSONL case mismatch ("background" ↔
 *       "Background"); trait values stay case-sensitive (they come straight
 *       from CIP-25 minting metadata and shouldn't be normalised).</li>
 *   <li>For each pool: sort asset_names lexicographically ascending
 *       (canonical order is LOAD-BEARING — the merkle-tree-java library is
 *       order-sensitive via left-leaning split-by-half, identical to the
 *       on-chain aiken_merkle_tree shape). Compute the root via
 *       {@code MerkleTree.fromList(identity)} + {@code itemHash}.</li>
 *   <li>Write {@code pools.json} atomically (.tmp → rename) with stable
 *       formatting so the diff is reviewable.</li>
 * </ol>
 *
 * <p>The BE seeder ({@link com.easy1staking.shithole.p2p.PoolMerkleSeeder})
 * recomputes each root on boot and fails fast on mismatch — so any drift
 * between this builder and the on-chain library surfaces immediately.
 */
public final class PoolMerkleBuilder {

    private static final HexFormat HEX = HexFormat.of();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Path DEFAULT_JSONL =
            Path.of("../.local/hosky-traits/nft_traits.jsonl");
    private static final Path DEFAULT_CSV =
            Path.of("../.local/rug-pool-matching-traits-merged.csv");
    /**
     * Default output path. The {@code .gz} suffix is load-bearing: the
     * uncompressed manifest is ~73 MB for the 12-pool / 420k-NFT corpus
     * (each pool stores every accepted asset_name). gzip squashes the
     * repetitive hex prefix down to ~5-10 MB, well under GitHub's 50 MB
     * warning threshold. {@link com.easy1staking.shithole.p2p.PoolMerkleSeeder}
     * detects the suffix and decompresses on read.
     */
    private static final Path DEFAULT_OUT =
            Path.of("src/main/resources/p2p/pools.json.gz");

    private PoolMerkleBuilder() {
    }

    public static void main(String[] args) throws Exception {
        Path jsonlPath = DEFAULT_JSONL;
        Path csvPath = DEFAULT_CSV;
        Path outPath = DEFAULT_OUT;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--jsonl" -> jsonlPath = Path.of(args[++i]);
                case "--csv" -> csvPath = Path.of(args[++i]);
                case "--out" -> outPath = Path.of(args[++i]);
                default -> throw new IllegalArgumentException("unknown arg: " + args[i]);
            }
        }

        log("reading curation csv: " + csvPath);
        Map<String, PoolCuration> curations = parseCsv(csvPath);
        log(curations.size() + " pool(s): " + String.join(", ", curations.keySet()));

        log("streaming jsonl: " + jsonlPath);
        Map<String, Set<String>> assetsByTicker = collectAssetsByTicker(jsonlPath, curations);

        log("computing merkle roots…");
        ArrayNode poolsArr = MAPPER.createArrayNode();
        // Emit pools in alphabetical order so the JSON diff is stable across
        // builds regardless of HashMap iteration order.
        List<String> orderedTickers = new ArrayList<>(curations.keySet());
        Collections.sort(orderedTickers);
        for (String ticker : orderedTickers) {
            PoolCuration cur = curations.get(ticker);
            Set<String> hexSet = assetsByTicker.getOrDefault(ticker, Set.of());
            if (hexSet.isEmpty()) {
                log("WARN: pool " + ticker + " matched 0 NFTs — likely a "
                        + "trait-name/category casing mismatch between CSV and JSONL");
            }
            List<String> sortedHexNames = new ArrayList<>(hexSet);
            // Lexicographic ascending. Same ordering the on-chain validator
            // and the BE seeder will see.
            Collections.sort(sortedHexNames);
            List<byte[]> names = sortedHexNames.stream().map(HEX::parseHex).toList();
            byte[] root = MerkleTree.fromList(names, b -> b).itemHash();
            String rootHex = HEX.formatHex(root);

            ObjectNode poolObj = MAPPER.createObjectNode();
            poolObj.put("ticker", ticker);
            poolObj.put("pool_id_hex", cur.poolIdHex == null ? null : cur.poolIdHex);
            poolObj.put("merkle_root_hex", rootHex);
            ArrayNode namesArr = poolObj.putArray("asset_names_hex");
            for (String n : sortedHexNames) namesArr.add(n);
            poolObj.put("total_assets", sortedHexNames.size());
            poolsArr.add(poolObj);

            log("  " + ticker + ": " + sortedHexNames.size() + " NFTs, root="
                    + rootHex.substring(0, 12) + "…");
        }

        String jsonlSha256 = sha256Hex(jsonlPath);

        ObjectNode manifest = MAPPER.createObjectNode();
        manifest.put("version", 1);
        manifest.put("generated_at", Instant.now().toString());
        ObjectNode source = manifest.putObject("source");
        source.put("csv", csvPath.getFileName().toString());
        source.put("jsonl_sha256", jsonlSha256);
        manifest.set("pools", poolsArr);

        writeAtomic(outPath, manifest);
        log("wrote " + outPath);
    }

    /* ---------------------------------------------------------------------- */
    /* CSV parse                                                              */
    /* ---------------------------------------------------------------------- */

    static Map<String, PoolCuration> parseCsv(Path csv) throws IOException {
        Map<String, PoolCuration> out = new LinkedHashMap<>();
        try (Stream<String> lines = Files.lines(csv, StandardCharsets.UTF_8)) {
            int[] lineNo = {0};
            lines.forEach(line -> {
                lineNo[0]++;
                if (lineNo[0] == 1) return; // header
                if (line.isBlank()) return;
                List<String> cols = parseCsvLine(line);
                if (cols.size() < 6) {
                    throw new IllegalStateException(
                            "csv line " + lineNo[0] + " has " + cols.size()
                                    + " columns, expected ≥ 6: " + line);
                }
                String ticker = cols.get(0).trim();
                String traitName = cols.get(1).trim();
                // cols[2] = Trait Count (unused on this side)
                // cols[3] = Total Count for Pool (unused)
                // cols[4] = Category — may be a comma-separated list inside
                // quotes (e.g. "background, frame") meaning the trait value
                // applies in ANY of those categories. Expand to one
                // TraitFilter per category.
                String categoryField = cols.get(4);
                String poolIdBech32 = cols.get(5).trim();

                PoolCuration cur = out.computeIfAbsent(ticker, t -> new PoolCuration());
                for (String cat : categoryField.split(",")) {
                    String category = cat.trim().toLowerCase(Locale.ROOT);
                    if (category.isEmpty()) continue;
                    cur.accepted.add(new TraitFilter(category, traitName));
                }
                String hex = decodePoolIdHex(poolIdBech32);
                if (cur.poolIdHex == null) {
                    cur.poolIdHex = hex;
                } else if (hex != null && !cur.poolIdHex.equalsIgnoreCase(hex)) {
                    throw new IllegalStateException(
                            "csv pool " + ticker + " has conflicting pool ids: "
                                    + cur.poolIdHex + " vs " + hex);
                }
            });
        }
        return out;
    }

    /**
     * Minimal RFC 4180-ish CSV row splitter. Handles quoted fields with
     * embedded commas (e.g. {@code "background, frame"}) and the doubled-
     * quote escape ({@code ""}). Does NOT handle multi-line quoted fields —
     * the curation CSV is single-line per row.
     */
    static List<String> parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        cur.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cur.append(c);
                }
            } else {
                if (c == ',') {
                    out.add(cur.toString());
                    cur.setLength(0);
                } else if (c == '"') {
                    inQuotes = true;
                } else {
                    cur.append(c);
                }
            }
        }
        out.add(cur.toString());
        return out;
    }

    /**
     * Decode a bech32-encoded stake pool id ({@code pool1…}) to its 28-byte
     * hex representation. Returns null when the input is empty/blank — some
     * community-curated pools haven't published their pool id and that's OK.
     *
     * <p>cardano-client-lib's {@code Bech32.decode} returns the 8-bit
     * payload directly (the {@code data} field is the result of the
     * library's internal 5→8 bit conversion + checksum strip). For Cardano
     * pool ids this is exactly the 28-byte blake2b_224 hash with no
     * additional version byte.
     */
    static String decodePoolIdHex(String bech32) {
        if (bech32 == null || bech32.isBlank()) return null;
        Bech32.Bech32Data decoded = Bech32.decode(bech32.trim());
        byte[] bytes = decoded.data;
        if (bytes.length != 28) {
            throw new IllegalStateException(
                    "decoded pool id is " + bytes.length + " bytes (expected 28): "
                            + bech32);
        }
        return HEX.formatHex(bytes);
    }

    /* ---------------------------------------------------------------------- */
    /* JSONL stream + traits match                                            */
    /* ---------------------------------------------------------------------- */

    static Map<String, Set<String>> collectAssetsByTicker(
            Path jsonl, Map<String, PoolCuration> curations) throws IOException {
        Map<String, Set<String>> out = new HashMap<>();
        for (String ticker : curations.keySet()) out.put(ticker, new TreeSet<>());

        long lineCount = 0;
        long matched = 0;
        try (Stream<String> lines = Files.lines(jsonl, StandardCharsets.UTF_8)) {
            for (String line : (Iterable<String>) lines::iterator) {
                lineCount++;
                if (line.isBlank()) continue;
                JsonNode node = MAPPER.readTree(line);
                String assetNameHex = node.path("asset_name").asText(null);
                JsonNode traits = node.path("traits");
                if (assetNameHex == null || !traits.isObject()) continue;

                // Build a (category_lower, value) set for THIS NFT and test
                // against each pool's accepted set. Doing it pool-first
                // (outer) vs nft-first (inner) is the same big-O — 12 pools
                // × ~75 trait filters dwarfed by ~420k NFTs.
                Set<TraitFilter> nftTraits = new LinkedHashSet<>();
                traits.fieldNames().forEachRemaining(category -> {
                    String value = traits.get(category).asText(null);
                    if (value != null) {
                        nftTraits.add(new TraitFilter(
                                category.toLowerCase(Locale.ROOT), value));
                    }
                });

                boolean anyMatch = false;
                for (Map.Entry<String, PoolCuration> e : curations.entrySet()) {
                    if (intersects(nftTraits, e.getValue().accepted)) {
                        out.get(e.getKey()).add(assetNameHex.toLowerCase(Locale.ROOT));
                        anyMatch = true;
                    }
                }
                if (anyMatch) matched++;

                if (lineCount % 50_000 == 0) {
                    log("  processed " + lineCount + " NFTs, " + matched
                            + " matched at least one pool");
                }
            }
        }
        log("processed " + lineCount + " NFT lines, " + matched
                + " matched at least one pool");
        return out;
    }

    private static boolean intersects(Set<TraitFilter> a, Set<TraitFilter> b) {
        // Iterate the smaller side. Pool sets are O(60), NFT sets are O(8) —
        // NFT side wins.
        Set<TraitFilter> small = a.size() <= b.size() ? a : b;
        Set<TraitFilter> big = small == a ? b : a;
        for (TraitFilter f : small) {
            if (big.contains(f)) return true;
        }
        return false;
    }

    /* ---------------------------------------------------------------------- */
    /* IO + hashing                                                           */
    /* ---------------------------------------------------------------------- */

    private static String sha256Hex(Path file) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (var in = Files.newInputStream(file)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            }
            return HEX.formatHex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static void writeAtomic(Path out, JsonNode manifest) throws IOException {
        Files.createDirectories(out.getParent());
        Path tmp = out.resolveSibling(out.getFileName() + ".tmp");
        boolean gzipped = out.getFileName().toString().endsWith(".gz");
        // Pretty-print only when emitting uncompressed JSON. Inside a gzip
        // wrapper the indentation just bloats pre-compression bytes; the
        // compressed size is similar but the in-memory parse path doesn't
        // benefit. Use compact form when gzipped.
        ObjectMapper writer = gzipped
                ? MAPPER
                : MAPPER.copy().enable(SerializationFeature.INDENT_OUTPUT);
        if (gzipped) {
            try (OutputStream os = Files.newOutputStream(tmp);
                 GZIPOutputStream gz = new GZIPOutputStream(os)) {
                writer.writeValue(gz, manifest);
            }
        } else {
            Files.write(tmp, writer.writeValueAsBytes(manifest));
        }
        Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
    }

    private static void log(String msg) {
        System.out.println("[p2pBuildPoolMerkle] " + msg);
    }

    /* ---------------------------------------------------------------------- */
    /* Value types                                                            */
    /* ---------------------------------------------------------------------- */

    /** Mutable accumulator per pool. */
    static final class PoolCuration {
        String poolIdHex;
        final Set<TraitFilter> accepted = new LinkedHashSet<>();
    }

    /** Case-normalised category + raw trait value. */
    record TraitFilter(String category, String value) {
    }
}
