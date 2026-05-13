package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.model.NftMetadataDto;
import com.easy1staking.shithole.service.NftMetadataService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * Per-NFT metadata + image.
 *
 * <p>The metadata endpoint resolves CIP-25 fields via {@link NftMetadataService}
 * (DB cache + Blockfrost fallback on miss).
 *
 * <p>The image endpoint stays {@code 404} for now — full image pipeline
 * (IPFS gateway fan-out + Thumbnailator) is its own phase per
 * {@code docs/BACKEND.md} §"Image pipeline". The FE renders against
 * {@code image_url} / {@code image_ipfs_uri} from the metadata response
 * directly in the meantime.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class NftController {

    /** Hex-only, length-bounded to defang path traversal and pathological lookups. */
    private static final Pattern UNIT_PATTERN = Pattern.compile("^[0-9a-f]{56,120}$");

    private static final Set<String> ALLOWED_SIZES = Set.of("64", "256", "1024");

    private final NftMetadataService nftMetadataService;

    @GetMapping(value = "/nft/{unit}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<NftMetadataDto> nft(@PathVariable String unit) {
        if (!UNIT_PATTERN.matcher(unit).matches()) {
            return ResponseEntity.badRequest().build();
        }
        return nftMetadataService.getOrFetch(unit)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Image route. Not yet implemented — pipeline (Blockfrost + IPFS fan-out +
     * Thumbnailator) lands in a later phase. Returns 404 to match the documented
     * permanent-failure UX so the FE placeholder triggers naturally.
     */
    @GetMapping("/nft/{unit}/image")
    public ResponseEntity<byte[]> nftImage(@PathVariable String unit,
                                           @RequestParam(value = "size", defaultValue = "256") String size) {
        if (!UNIT_PATTERN.matcher(unit).matches()) {
            return ResponseEntity.badRequest().build();
        }
        if (!ALLOWED_SIZES.contains(size)) {
            return ResponseEntity.badRequest().build();
        }
        log.debug("image route not yet implemented (unit={}, size={})", unit, size);
        return ResponseEntity.notFound().build();
    }
}
