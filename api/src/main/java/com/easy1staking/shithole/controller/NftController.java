package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.model.NftMetadataDto;
import com.easy1staking.shithole.service.FixtureService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Per-NFT metadata + image. Bootstrap impl serves the metadata JSON from fixtures
 * and returns 404 for the image route until the IPFS-fan-out + thumbnail pipeline
 * is wired up (docs/BACKEND.md §image pipeline).
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class NftController {

    /** Hex-only, length-bounded to defang path traversal and pathological lookups. */
    private static final Pattern UNIT_PATTERN = Pattern.compile("^[0-9a-f]{56,120}$");

    private static final Set<String> ALLOWED_SIZES = Set.of("64", "256", "1024");

    private final FixtureService fixtureService;

    @GetMapping(value = "/nft/{unit}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<NftMetadataDto> nft(@PathVariable String unit) {
        if (!UNIT_PATTERN.matcher(unit).matches()) {
            return ResponseEntity.badRequest().build();
        }
        try {
            NftMetadataDto meta = fixtureService.loadFixture(
                    "fixtures/api/nft/" + unit + ".json",
                    NftMetadataDto.class);
            if (meta == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(meta);
        } catch (IOException ex) {
            log.error("failed to load NFT metadata fixture for unit={}", unit, ex);
            return ResponseEntity.internalServerError().build();
        }
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
