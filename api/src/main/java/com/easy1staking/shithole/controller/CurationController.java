package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.model.CuratedCollectionDto;
import com.easy1staking.shithole.model.ThemeDto;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Public curation registry — surfaces every row in {@code curated_collections}
 * (auto-promoted on registration via the operator-pkh gate, see
 * {@link com.easy1staking.shithole.service.ConfigRegistrationService}).
 *
 * <p>Drives the FE homepage's carousel of pits.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class CurationController {

    private final CuratedCollectionRepository curatedCollectionRepository;

    @GetMapping(value = "/curated", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<CuratedCollectionDto>> curated() {
        // Pit-visible collections only — marketplace-only rows have no config
        // and would show up as non-functional "pits".
        List<CuratedCollectionDto> entries = curatedCollectionRepository
                .findBySurfaceNotOrderByDisplayOrderAscSlugAsc("marketplace")
                .stream()
                .map(CurationController::toDto)
                .toList();
        return ResponseEntity.ok(entries);
    }

    static CuratedCollectionDto toDto(CuratedCollectionEntity e) {
        return CuratedCollectionDto.builder()
                .slug(e.getSlug())
                .configNftPolicy(e.getConfigNftPolicy())
                .collectionPolicyId(e.getCollectionPolicyId())
                .displayName(e.getDisplayName())
                .displayOrder(e.getDisplayOrder())
                .theme(ThemeDto.builder()
                        .backgroundUrl(e.getBackgroundUrl())
                        .accentColor(e.getAccentColor())
                        .mascotImageUrl(e.getMascotImageUrl())
                        .build())
                .build();
    }
}
