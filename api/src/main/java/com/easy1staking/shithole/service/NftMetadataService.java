package com.easy1staking.shithole.service;

import com.bloxbean.cardano.client.api.exception.ApiException;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.client.backend.model.Asset;
import com.easy1staking.shithole.entity.NftMetadataEntity;
import com.easy1staking.shithole.model.NftMetadataDto;
import com.easy1staking.shithole.repository.NftMetadataRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * NFT metadata resolution + cache. First sight of a {@code unit} triggers a
 * Blockfrost {@code /assets/{unit}} fetch; CIP-25 fields (name, image,
 * description, traits) are extracted from the on-chain metadata and persisted
 * to {@code nft_metadata}. Subsequent fetches read from cache only — Cardano
 * native-asset metadata is immutable, so a one-shot lookup is correct.
 *
 * <p>Image bytes / thumbnails are NOT fetched here. The
 * {@code image_status='pending'} placeholder is written; the image pipeline
 * (Blockfrost gateway → IPFS fan-out → Thumbnailator) is its own phase per
 * {@code docs/BACKEND.md} §"Image pipeline". The {@code image_ipfs_uri} +
 * {@code image_url} fields are populated so the FE can render an
 * {@code <img>} tag against an IPFS gateway directly while the BE pipeline
 * waits to ship.
 *
 * <p>HTTPS URLs in {@code onchain_metadata.image} are passed through as
 * {@code image_url}. {@code ipfs://...} URIs are passed through as
 * {@code image_ipfs_uri} (FE chooses a gateway).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NftMetadataService {

    private final NftMetadataRepository repository;
    private final BackendService backendService;
    private final ObjectMapper objectMapper;

    /**
     * Resolve metadata for {@code unit}. Returns empty if Blockfrost has no
     * record (404) — the FE renders a placeholder in that case.
     */
    @Transactional
    public Optional<NftMetadataDto> getOrFetch(String unit) {
        String unitLower = unit.toLowerCase(Locale.ROOT);
        Optional<NftMetadataEntity> cached = repository.findById(unitLower);
        if (cached.isPresent()) {
            return Optional.of(toDto(cached.get()));
        }
        return fetchAndCache(unitLower);
    }

    private Optional<NftMetadataDto> fetchAndCache(String unit) {
        Result<Asset> result;
        try {
            result = backendService.getAssetService().getAsset(unit);
        } catch (ApiException e) {
            log.warn("blockfrost getAsset failed for unit={}: {}", unit, e.getMessage());
            return Optional.empty();
        } catch (RuntimeException e) {
            log.warn("blockfrost getAsset runtime error for unit={}: {}", unit, e.getMessage());
            return Optional.empty();
        }
        if (!result.isSuccessful()) {
            if (result.code() == 404) {
                log.debug("NFT {} not found on chain (Blockfrost 404)", unit);
                return Optional.empty();
            }
            log.warn("blockfrost getAsset non-success code={} unit={} response={}",
                    result.code(), unit, result.getResponse());
            return Optional.empty();
        }
        Asset asset = result.getValue();
        NftMetadataEntity entity = mapToEntity(unit, asset);
        repository.save(entity);
        return Optional.of(toDto(entity));
    }

    /** Pull the CIP-25 fields out of the on-chain metadata JsonNode. */
    private NftMetadataEntity mapToEntity(String unit, Asset asset) {
        NftMetadataEntity.NftMetadataEntityBuilder b = NftMetadataEntity.builder()
                .unit(unit)
                .policyId(asset.getPolicyId())
                .assetNameHex(asset.getAssetName())
                .assetName(decodeAssetName(asset.getAssetName()))
                .fingerprint(asset.getFingerprint())
                .quantity(parseLongOrNull(asset.getQuantity()))
                .imageStatus("pending")
                .imageFetchAttempts(0)
                .fetchedAt(OffsetDateTime.now());

        JsonNode onchain = asset.getOnchainMetadata();
        if (onchain != null && !onchain.isNull()) {
            // Blockfrost surfaces the per-asset CIP-25 entry directly (i.e.
            // the value at metadata.721[policy_id][asset_name]). Standard
            // fields: name, image, mediaType, description, plus arbitrary
            // traits.
            b.rawOnchainMetadata(onchain.toString());
            b.onchainMetadataStandard("CIP25");
            JsonNode name = onchain.get("name");
            if (isText(name)) b.name(name.asText());
            JsonNode description = onchain.get("description");
            if (isText(description)) b.description(description.asText());
            else if (description != null && description.isArray()) b.description(joinTextArray(description));

            JsonNode image = onchain.get("image");
            String imageStr = textOrJoined(image);
            if (imageStr != null) {
                if (imageStr.startsWith("ipfs://")) {
                    b.imageIpfsUri(imageStr);
                    // Convert ipfs://CID/path → https gateway URL the FE can <img src=...>
                    b.imageUrl("https://ipfs.io/ipfs/" + imageStr.substring("ipfs://".length()));
                } else if (imageStr.startsWith("https://") || imageStr.startsWith("http://")) {
                    b.imageUrl(imageStr);
                }
                // data:... URIs intentionally not stored as a URL — they'd
                // bloat the row and FE-side base64 rendering is fine direct.
            }

            // Anything else in the onchain metadata becomes a trait entry
            // (matches the FE fixture convention).
            try {
                String traitsJson = extractTraits(onchain);
                if (traitsJson != null) b.traitsJson(traitsJson);
            } catch (Exception traitsErr) {
                log.debug("traits extraction failed for unit={}: {}", unit, traitsErr.getMessage());
            }
        }
        return b.build();
    }

    private NftMetadataDto toDto(NftMetadataEntity e) {
        List<Map<String, String>> traits = parseTraits(e.getTraitsJson());
        return NftMetadataDto.builder()
                .unit(e.getUnit())
                .policyId(e.getPolicyId())
                .assetNameHex(e.getAssetNameHex())
                .assetName(e.getAssetName())
                .fingerprint(e.getFingerprint())
                .quantity(e.getQuantity())
                .onchainMetadataStandard(e.getOnchainMetadataStandard())
                .name(e.getName())
                .imageIpfsUri(e.getImageIpfsUri())
                .imageUrl(e.getImageUrl())
                .traits(traits)
                .description(e.getDescription())
                .build();
    }

    /** UTF-8 decode the hex-encoded asset name; falls back to the hex on bad bytes. */
    private static String decodeAssetName(String hex) {
        if (hex == null || hex.isEmpty()) return "";
        try {
            byte[] bytes = hexDecode(hex);
            String s = new String(bytes, StandardCharsets.UTF_8);
            // Reject control characters — those usually mean it's a CIP-68
            // labelled or otherwise binary asset name; fall back to hex.
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c < 0x20 || c == 0x7f) return hex;
            }
            return s;
        } catch (Exception e) {
            return hex;
        }
    }

    private static byte[] hexDecode(String hex) {
        int n = hex.length();
        byte[] out = new byte[n / 2];
        for (int i = 0; i < n; i += 2) {
            out[i / 2] = (byte) Integer.parseInt(hex, i, i + 2, 16);
        }
        return out;
    }

    private static boolean isText(JsonNode n) {
        return n != null && !n.isNull() && n.isTextual();
    }

    /**
     * CIP-25 allows {@code image} to be either a single string or an array of
     * strings (for URLs > 64 chars that viewers concatenate). Join arrays.
     */
    private static String textOrJoined(JsonNode n) {
        if (n == null || n.isNull()) return null;
        if (n.isTextual()) return n.asText();
        if (n.isArray()) return joinTextArray(n);
        return null;
    }

    private static String joinTextArray(JsonNode arr) {
        StringBuilder sb = new StringBuilder();
        for (JsonNode part : arr) {
            if (part != null && part.isTextual()) sb.append(part.asText());
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private static Long parseLongOrNull(String s) {
        if (s == null || s.isEmpty()) return null;
        try { return Long.parseLong(s); } catch (NumberFormatException e) { return null; }
    }

    /**
     * Build a {@code List<{key:value}>} JSON for non-standard CIP-25
     * fields, covering the dialects we've seen in mainnet + preprod:
     *
     * <ul>
     *   <li>Nested-object container ({@code "traits": {Fur: "Original",
     *       Eyes: "Original"}}) — older mainnet CNFT collections.</li>
     *   <li>Nested-array container of single-key dicts ({@code "traits":
     *       [{Fur: "Original"}, {Eyes: "Original"}]}) — CIP-25 v1
     *       recommended shape, used by the preprod HOSKY mimic and many
     *       mainnet collections under ornate keys like
     *       "-----Traits-----".</li>
     *   <li>OpenSea-style "attributes" array of {trait_type, value}.</li>
     *   <li>Flat top-level fields — older convention where each trait is
     *       a top-level field alongside name / image.</li>
     * </ul>
     *
     * <p>All four are tried per call so a collection mixing two
     * dialects still surfaces sensibly.
     */
    private String extractTraits(JsonNode onchain) {
        if (!(onchain instanceof ObjectNode obj)) return null;
        var traits = objectMapper.createArrayNode();

        // Dialects 1 & 2: nested container under any of the known keys.
        // The mainnet HOSKY's ornate "-----Traits-----" key is included
        // so the dev branch shares the same recognition surface as main.
        for (String key : NESTED_TRAIT_KEYS) {
            JsonNode container = obj.get(key);
            if (container == null) continue;
            if (container.isObject()) {
                Iterator<String> names = container.fieldNames();
                while (names.hasNext()) {
                    String k = names.next();
                    String txt = textOrJoined(container.get(k));
                    if (txt == null) continue;
                    ObjectNode pair = objectMapper.createObjectNode();
                    pair.put(k, txt);
                    traits.add(pair);
                }
            } else if (container.isArray()) {
                for (JsonNode entry : container) {
                    if (!entry.isObject()) continue;
                    Iterator<String> names = entry.fieldNames();
                    while (names.hasNext()) {
                        String k = names.next();
                        String txt = textOrJoined(entry.get(k));
                        if (txt == null) continue;
                        ObjectNode pair = objectMapper.createObjectNode();
                        pair.put(k, txt);
                        traits.add(pair);
                    }
                }
            }
        }

        // Dialect 3: OpenSea "attributes" array.
        for (String key : ATTRIBUTES_KEYS) {
            JsonNode attrs = obj.get(key);
            if (attrs == null || !attrs.isArray()) continue;
            for (JsonNode attr : attrs) {
                JsonNode tt = attr.get("trait_type");
                if (tt == null || !tt.isTextual()) continue;
                String txt = textOrJoined(attr.get("value"));
                if (txt == null) continue;
                ObjectNode pair = objectMapper.createObjectNode();
                pair.put(tt.asText(), txt);
                traits.add(pair);
            }
        }

        // Dialect 4: flat top-level fields (fallback). Skip standard
        // CIP-25 fields AND any key we already drained as a container
        // above, to avoid double-counting.
        Iterator<String> names = obj.fieldNames();
        while (names.hasNext()) {
            String k = names.next();
            if (FLAT_SKIP_KEYS.contains(k)) continue;
            String txt = textOrJoined(obj.get(k));
            if (txt == null) continue;
            ObjectNode pair = objectMapper.createObjectNode();
            pair.put(k, txt);
            traits.add(pair);
        }

        return traits.isEmpty() ? null : traits.toString();
    }

    private static final List<String> NESTED_TRAIT_KEYS = List.of(
            "-----Traits-----",
            "traits",
            "Traits",
            "properties",
            "Properties"
    );

    private static final List<String> ATTRIBUTES_KEYS = List.of(
            "attributes",
            "Attributes"
    );

    private static final java.util.Set<String> FLAT_SKIP_KEYS = java.util.Set.of(
            "name", "image", "mediaType", "description", "files",
            "-----Traits-----", "traits", "Traits", "properties", "Properties",
            "attributes", "Attributes"
    );

    private List<Map<String, String>> parseTraits(String traitsJson) {
        if (traitsJson == null || traitsJson.isBlank()) return new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(traitsJson);
            List<Map<String, String>> out = new ArrayList<>(root.size());
            for (JsonNode pair : root) {
                if (!pair.isObject()) continue;
                Iterator<Map.Entry<String, JsonNode>> it = pair.fields();
                if (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    out.add(Map.of(e.getKey(), e.getValue().asText()));
                }
            }
            return out;
        } catch (Exception e) {
            log.debug("traits JSON parse failed: {}", e.getMessage());
            return new ArrayList<>();
        }
    }
}
