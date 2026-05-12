package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.model.ListingHistoryDto;
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
 * Swap-history lineage endpoint.
 *
 * <p>{@code GET /api/listings/{initial_tx_hash}_{initial_output_index}/history}
 * returns the full timeline of a listing lineage (create → 0..N swaps → optional
 * cancel/recover). Shape and indexer behavior in {@code docs/BACKEND.md}
 * §"Swap-history lineage tracking"; spec linkage in SPEC §10.2.
 *
 * <p>Bootstrap impl: serves a packaged JSON fixture under
 * {@code classpath:fixtures/api/listings/{outref}/history.json}. The
 * DB-backed implementation (querying {@link com.easy1staking.shithole.repository.ListingEventRepository}
 * with {@code findLineage}) lands together with the indexer phase that
 * actually populates {@code listing_events}.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class ListingHistoryController {

    /**
     * Combined pattern for {@code {tx_hash}_{output_index}} path segments.
     * Mirrors the validation discipline used in {@link NftController}:
     * hex-only, length-bounded, no path-traversal characters.
     *
     * <ul>
     *   <li>tx_hash: exactly 64 lowercase hex chars (32-byte blake2b)</li>
     *   <li>output_index: 1-5 decimal digits, no leading zeros except for "0"</li>
     * </ul>
     */
    private static final Pattern INITIAL_OUTREF_PATTERN =
            Pattern.compile("^(?<tx>[0-9a-f]{64})_(?<idx>0|[1-9][0-9]{0,4})$");

    private final FixtureService fixtureService;

    @GetMapping(value = "/listings/{initialOutref}/history",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ListingHistoryDto> history(@PathVariable String initialOutref) {
        if (!INITIAL_OUTREF_PATTERN.matcher(initialOutref).matches()) {
            return ResponseEntity.badRequest().build();
        }
        try {
            ListingHistoryDto history = fixtureService.loadFixture(
                    "fixtures/api/listings/" + initialOutref + "/history.json",
                    ListingHistoryDto.class);
            if (history == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(history);
        } catch (IOException ex) {
            log.error("failed to load history fixture for initialOutref={}", initialOutref, ex);
            return ResponseEntity.internalServerError().build();
        }
    }
}
