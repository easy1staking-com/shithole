package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.model.CuratedCollectionDto;
import com.easy1staking.shithole.service.FixtureService;
import com.fasterxml.jackson.core.type.TypeReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Collections;
import java.util.List;

/**
 * Curation registry. Bootstrap impl reads packaged fixtures; DB-backed impl lands
 * after the indexer + curation tables are wired up.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class CurationController {

    private final FixtureService fixtureService;

    @Value("${shithole.fixtures.curated:fixtures/api/curated.json}")
    private String curatedFixturePath;

    @GetMapping(value = "/curated", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<CuratedCollectionDto>> curated() {
        try {
            List<CuratedCollectionDto> entries =
                    fixtureService.loadFixture(curatedFixturePath,
                            new TypeReference<List<CuratedCollectionDto>>() {});
            if (entries == null) {
                return ResponseEntity.ok(Collections.emptyList());
            }
            return ResponseEntity.ok(entries);
        } catch (IOException ex) {
            log.error("failed to load curated fixture from {}", curatedFixturePath, ex);
            return ResponseEntity.internalServerError().build();
        }
    }
}
