package com.easy1staking.shithole.controller;

import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.MarketplaceEventEntity;
import com.easy1staking.shithole.model.MarketplaceListingEventDto;
import com.easy1staking.shithole.repository.MarketplaceEventRepository;
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
import java.util.List;
import java.util.regex.Pattern;

/**
 * Marketplace wallet-history endpoint. Sibling of
 * {@link ListingHistoryController} (pit) and {@link P2pController}
 * (wanted-listings) — produces the third data source merged into
 * {@code /me/history}.
 *
 * <p>v1 exposes only the {@code by-pkh} feed (everything the wallet was
 * on either side of). Browse + per-listing history could come later;
 * the FE currently reads marketplace UTxOs directly from chain for the
 * live browse view.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class MarketController {

    /** 28-byte payment-key hash as lowercase hex. */
    private static final Pattern PKH_HEX_PATTERN = Pattern.compile("^[0-9a-f]{56}$");
    private static final int MAX_PAGE_SIZE = 200;
    private static final int DEFAULT_PAGE_SIZE = 100;

    private final MarketplaceEventRepository marketplaceEventRepository;

    /**
     * All marketplace events a wallet participated in — as the seller
     * OR as the buyer of a sold listing. Ordered by last-touched slot
     * (spent slot if spent, else created slot) DESC. Paginated; capped
     * at {@value #MAX_PAGE_SIZE}.
     */
    @GetMapping(value = "/market/listings/by-pkh/{pkhHex}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<MarketplaceListingEventDto>> listingsByPkh(
            @PathVariable("pkhHex") String pkhHex,
            @RequestParam(value = "size", defaultValue = "" + DEFAULT_PAGE_SIZE) int size,
            @RequestParam(value = "page", defaultValue = "0") int page) {
        if (pkhHex == null || !PKH_HEX_PATTERN.matcher(pkhHex.toLowerCase()).matches()) {
            return ResponseEntity.badRequest().build();
        }
        int safeSize = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        int safePage = Math.max(0, page);
        byte[] pkh = HexUtil.decodeHexString(pkhHex.toLowerCase());

        List<MarketplaceEventEntity> rows =
                marketplaceEventRepository.findAllByPkh(pkh, PageRequest.of(safePage, safeSize));
        return ResponseEntity.ok(rows.stream().map(MarketController::toDto).toList());
    }

    static MarketplaceListingEventDto toDto(MarketplaceEventEntity e) {
        return MarketplaceListingEventDto.builder()
                .txHash(HexUtil.encodeHexString(e.getTxHash()))
                .outputIndex(e.getOutputIndex())
                .sellerPkh(HexUtil.encodeHexString(e.getSellerPkh()))
                .sellerAddressBech32(e.getSellerAddressBech32())
                .pricePolicy(HexUtil.encodeHexString(e.getPricePolicy()))
                .priceName(HexUtil.encodeHexString(e.getPriceName()))
                .priceQty(e.getPriceQty())
                .accompanyingLovelace(e.getAccompanyingLovelace())
                .listedNftUnit(HexUtil.encodeHexString(e.getListedNftUnit()))
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
                .buyerPkh(e.getBuyerPkh() == null ? null
                        : HexUtil.encodeHexString(e.getBuyerPkh()))
                .build();
    }
}
