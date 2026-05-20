package com.easy1staking.shithole.controller;

import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ListingEventEntity;
import com.easy1staking.shithole.model.ListingEventDto;
import com.easy1staking.shithole.model.ListingHistoryDto;
import com.easy1staking.shithole.model.ListingHistoryEventDto;
import com.easy1staking.shithole.model.OutRefDto;
import com.easy1staking.shithole.repository.ListingEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Swap-history lineage endpoint.
 *
 * <p>{@code GET /api/listings/{initial_tx_hash}_{initial_output_index}/history}
 * returns the full timeline of a listing lineage (create → 0..N swaps → optional
 * cancel/recover) by querying {@link ListingEventRepository#findLineage} for
 * every row sharing the given initial outref, then mapping each row to one
 * timeline event:
 *
 * <ul>
 *   <li>row with {@code swap_index == 0} → {@code action="create"} event with
 *       {@code nft_unit} populated.</li>
 *   <li>row with {@code swap_index > 0} → {@code action="swap"} event with
 *       {@code na_unit} (the asset on the previous row = what LEFT this listing)
 *       and {@code nb_unit} (this row's asset = what ARRIVED).</li>
 *   <li>if the latest row has {@code spent_action != null} AND no successor
 *       exists, append a terminal event with the matching action
 *       ({@code "cancel" | "recover" | "spent_unknown"}). For the indexer's
 *       current behavior cancel/recover are tagged jointly as
 *       {@code "spent_unknown"} — they'll be disambiguated once redeemer
 *       inspection lands.</li>
 * </ul>
 *
 * <p>Shape + indexer behavior documented in {@code docs/BACKEND.md}
 * §"Swap-history lineage tracking"; spec linkage in SPEC §10.2.
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
     *   <li>output_index: 0 or 1-10 decimal digits, no leading zeros. Range
     *       enforced numerically below to allow the full 32-bit signed range
     *       that matches the DB column type ({@code INT}).</li>
     * </ul>
     */
    private static final Pattern INITIAL_OUTREF_PATTERN =
            Pattern.compile("^(?<tx>[0-9a-f]{64})_(?<idx>0|[1-9][0-9]{0,9})$");

    /** 28-byte payment-key hash as lowercase hex. */
    private static final Pattern PKH_HEX_PATTERN = Pattern.compile("^[0-9a-f]{56}$");
    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 100;

    private final ListingEventRepository listingEventRepository;

    @GetMapping(value = "/listings/{initialOutref}/history",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ListingHistoryDto> history(@PathVariable String initialOutref) {
        Matcher matcher = INITIAL_OUTREF_PATTERN.matcher(initialOutref);
        if (!matcher.matches()) {
            return ResponseEntity.badRequest().build();
        }
        long idx;
        try {
            idx = Long.parseLong(matcher.group("idx"));
        } catch (NumberFormatException nfe) {
            return ResponseEntity.badRequest().build();
        }
        if (idx < 0 || idx > Integer.MAX_VALUE) {
            return ResponseEntity.badRequest().build();
        }
        int outputIndex = (int) idx;
        byte[] txHashBytes = HexUtil.decodeHexString(matcher.group("tx"));

        List<ListingEventEntity> rows = listingEventRepository.findLineage(txHashBytes, outputIndex);
        if (rows.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        List<ListingHistoryEventDto> events = new ArrayList<>(rows.size() + 1);
        ListingEventEntity prev = null;
        for (ListingEventEntity row : rows) {
            events.add(toEvent(row, prev));
            prev = row;
        }
        // Terminal event for the most-recent row if it was consumed. The
        // mid-lineage rows are also "spent" (spent_action='swap' for each row
        // before the last), but those consumptions are already represented by
        // the next-row "swap" event in the lineage. Only the final row's
        // consumption stands alone.
        ListingEventEntity last = rows.get(rows.size() - 1);
        if (last.getSpentAction() != null) {
            events.add(terminalEvent(last));
        }

        return ResponseEntity.ok(ListingHistoryDto.builder()
                .initialOutref(OutRefDto.builder()
                        .txId(matcher.group("tx"))
                        .outputIndex(outputIndex)
                        .build())
                .events(events)
                .build());
    }

    static ListingHistoryEventDto toEvent(ListingEventEntity row, ListingEventEntity prev) {
        boolean isGenesis = row.getSwapIndex() == 0;
        String thisUnit = HexUtil.encodeHexString(row.getNftUnit());
        ListingHistoryEventDto.ListingHistoryEventDtoBuilder b = ListingHistoryEventDto.builder()
                .swapIndex(row.getSwapIndex())
                .txHash(HexUtil.encodeHexString(row.getTxHash()))
                .outputIndex(row.getOutputIndex())
                .slot(row.getCreatedAtSlot())
                .timestamp(row.getCreatedAt() == null ? null
                        : row.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .lovelace(row.getLovelace());
        if (isGenesis) {
            return b.action("create").nftUnit(thisUnit).build();
        }
        // Swap row: NA = the previous row's NFT (what LEFT this lineage),
        //           NB = this row's NFT (what ARRIVED).
        String prevUnit = prev == null ? null : HexUtil.encodeHexString(prev.getNftUnit());
        return b.action("swap")
                .naUnit(prevUnit)
                .nbUnit(thisUnit)
                .build();
    }

    static ListingHistoryEventDto terminalEvent(ListingEventEntity last) {
        return ListingHistoryEventDto.builder()
                // Terminal event has no own (tx, idx) — it's the slot at which
                // the LAST row was consumed.
                .slot(last.getSpentAtSlot())
                .timestamp(last.getSpentAt() == null ? null
                        : last.getSpentAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .action(last.getSpentAction())
                .build();
    }

    /**
     * All listing events a wallet participated in — as the original lister
     * OR as a swapper that consumed someone else's listing. Drives the FE's
     * {@code /me/history} feed (combined with the parallel
     * {@code /api/p2p/listings/by-pkh/{pkh}} for the p2p side).
     *
     * <p>Response is paginated, capped at {@value #MAX_PAGE_SIZE}, ordered
     * by most-recent activity (spend slot if spent, else created slot).
     */
    @GetMapping(value = "/listings/by-pkh/{pkhHex}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<ListingEventDto>> listingsByPkh(
            @PathVariable("pkhHex") String pkhHex,
            @RequestParam(value = "size", defaultValue = "" + DEFAULT_PAGE_SIZE) int size,
            @RequestParam(value = "page", defaultValue = "0") int page) {
        if (pkhHex == null || !PKH_HEX_PATTERN.matcher(pkhHex.toLowerCase()).matches()) {
            return ResponseEntity.badRequest().build();
        }
        int safeSize = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        int safePage = Math.max(0, page);
        byte[] pkh = HexUtil.decodeHexString(pkhHex.toLowerCase());

        List<ListingEventEntity> rows =
                listingEventRepository.findAllByPkh(pkh, PageRequest.of(safePage, safeSize));
        return ResponseEntity.ok(rows.stream().map(ListingHistoryController::toEventDto).toList());
    }

    static ListingEventDto toEventDto(ListingEventEntity e) {
        return ListingEventDto.builder()
                .txHash(HexUtil.encodeHexString(e.getTxHash()))
                .outputIndex(e.getOutputIndex())
                .initialTxHash(HexUtil.encodeHexString(e.getInitialTxHash()))
                .initialOutputIndex(e.getInitialOutputIndex())
                .swapIndex(e.getSwapIndex())
                .configNftPolicy(HexUtil.encodeHexString(e.getConfigNftPolicy()))
                .listerPkh(HexUtil.encodeHexString(e.getListerPkh()))
                .nftUnit(HexUtil.encodeHexString(e.getNftUnit()))
                .lovelace(e.getLovelace())
                .createdAtSlot(e.getCreatedAtSlot())
                .createdAt(e.getCreatedAt() == null ? null
                        : e.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .spentAtSlot(e.getSpentAtSlot())
                .spentAt(e.getSpentAt() == null ? null
                        : e.getSpentAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .spentByTxHash(e.getSpentByTxHash() == null ? null
                        : HexUtil.encodeHexString(e.getSpentByTxHash()))
                .spentAction(e.getSpentAction())
                .swapperPkh(e.getSwapperPkh() == null ? null
                        : HexUtil.encodeHexString(e.getSwapperPkh()))
                .build();
    }
}
