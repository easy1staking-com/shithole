package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.model.CollectionStateDto;
import com.easy1staking.shithole.model.ListingsResponseDto;
import com.easy1staking.shithole.service.FixtureService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.regex.Pattern;

/**
 * Per-collection state + listings. Bootstrap impl serves packaged fixtures by slug;
 * DB-backed impl lands after the listing indexer is in place.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class CollectionController {

    /** Permits a-z, 0-9, and hyphen. Stops directory traversal and weird slugs. */
    private static final Pattern SAFE_SLUG = Pattern.compile("^[a-z0-9-]+$");

    private final FixtureService fixtureService;

    @GetMapping(value = "/collections/{slug}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CollectionStateDto> collection(@PathVariable String slug) {
        if (!SAFE_SLUG.matcher(slug).matches()) {
            return ResponseEntity.badRequest().build();
        }
        try {
            CollectionStateDto state = fixtureService.loadFixture(
                    "fixtures/api/collections/" + slug + ".json",
                    CollectionStateDto.class);
            if (state == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(state);
        } catch (IOException ex) {
            log.error("failed to load collection fixture for slug={}", slug, ex);
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping(value = "/collections/{slug}/listings", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ListingsResponseDto> listings(@PathVariable String slug) {
        if (!SAFE_SLUG.matcher(slug).matches()) {
            return ResponseEntity.badRequest().build();
        }
        try {
            ListingsResponseDto resp = fixtureService.loadFixture(
                    "fixtures/api/collections/" + slug + "-listings.json",
                    ListingsResponseDto.class);
            if (resp == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(resp);
        } catch (IOException ex) {
            log.error("failed to load listings fixture for slug={}", slug, ex);
            return ResponseEntity.internalServerError().build();
        }
    }
}
