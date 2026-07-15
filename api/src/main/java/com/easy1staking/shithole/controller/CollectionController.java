package com.easy1staking.shithole.controller;

import com.bloxbean.cardano.client.util.HexUtil;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.entity.ListingEventEntity;
import com.easy1staking.shithole.model.AddressDto;
import com.easy1staking.shithole.model.CollectionStateDto;
import com.easy1staking.shithole.model.CollectionStatsDto;
import com.easy1staking.shithole.model.ConfigDatumDto;
import com.easy1staking.shithole.model.CredentialDto;
import com.easy1staking.shithole.model.ListingDto;
import com.easy1staking.shithole.model.ListingsResponseDto;
import com.easy1staking.shithole.model.MStalenessDto;
import com.easy1staking.shithole.model.MarketActivityDto;
import com.easy1staking.shithole.model.MarketCollectionStatsDto;
import com.easy1staking.shithole.model.OutRefDto;
import com.easy1staking.shithole.model.ThemeDto;
import com.easy1staking.shithole.entity.MarketplaceEventEntity;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.repository.ListingEventRepository;
import com.easy1staking.shithole.repository.MarketplaceEventRepository;
import com.easy1staking.shithole.service.PriceOracle;
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

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Per-collection state + listings. DB-backed: joins {@code curated_collections}
 * with {@code configs} and (for the listings endpoint) {@code listing_events}
 * filtered to active rows.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class CollectionController {

    /** Permits a-z, 0-9, and hyphen. Stops directory traversal and weird slugs. */
    private static final Pattern SAFE_SLUG = Pattern.compile("^[a-z0-9-]+$");

    private final CuratedCollectionRepository curatedCollectionRepository;
    private final ConfigRepository configRepository;
    private final ListingEventRepository listingEventRepository;
    private final MarketplaceEventRepository marketplaceEventRepository;
    private final PriceOracle priceOracle;

    @GetMapping(value = "/collections/{slug}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CollectionStateDto> collection(@PathVariable String slug) {
        if (!SAFE_SLUG.matcher(slug).matches()) {
            return ResponseEntity.badRequest().build();
        }
        Optional<CuratedCollectionEntity> curatedOpt = curatedCollectionRepository.findById(slug);
        if (curatedOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        CuratedCollectionEntity curated = curatedOpt.get();

        ThemeDto theme = ThemeDto.builder()
                .backgroundUrl(curated.getBackgroundUrl())
                .accentColor(curated.getAccentColor())
                .mascotImageUrl(curated.getMascotImageUrl())
                .build();

        // Marketplace-only collections have no on-chain config — serve their
        // identity + theme + default pricing token + active marketplace listing
        // count, with no config datum / M-staleness (both are pit concepts).
        if (curated.getConfigNftPolicy() == null) {
            long activeMarket = marketplaceEventRepository
                    .countByCollectionPolicyIdAndSpentActionIsNull(
                            HexUtil.decodeHexString(curated.getCollectionPolicyId()));
            return ResponseEntity.ok(CollectionStateDto.builder()
                    .slug(curated.getSlug())
                    .collectionPolicyId(curated.getCollectionPolicyId())
                    .displayName(curated.getDisplayName())
                    .theme(theme)
                    .surface(curated.getSurface())
                    .defaultPricePolicy(curated.getDefaultPricePolicy())
                    .defaultPriceName(curated.getDefaultPriceName())
                    .defaultPriceDecimals(curated.getDefaultPriceDecimals())
                    .priceTokenLabel(curated.getPriceTokenLabel())
                    .stats(CollectionStatsDto.builder()
                            .nValidListings((int) activeMarket)
                            .totalAccruedLovelace(0L)
                            .swapCount24h(0L)
                            .build())
                    .build());
        }

        Optional<ConfigEntity> configOpt = configRepository.findById(curated.getConfigNftPolicy());
        if (configOpt.isEmpty()) {
            // Curated row points at a missing config — shouldn't happen post
            // registration, but defend.
            log.warn("collection state requested for slug={} but config row missing for policy={}",
                    slug, curated.getConfigNftPolicy());
            return ResponseEntity.notFound().build();
        }
        ConfigEntity config = configOpt.get();
        byte[] policyBytes = HexUtil.decodeHexString(curated.getConfigNftPolicy());
        long activeCount = listingEventRepository
                .countByConfigNftPolicyAndSpentActionIsNull(policyBytes);

        int currentM = config.getM();
        // recommended_m = ceil(N/3); SPEC §10.2 staleness math.
        int recommendedM = activeCount == 0 ? 1 : (int) Math.max(1, (activeCount + 2) / 3);
        double ratio = recommendedM == 0 ? 0.0 : (double) currentM / recommendedM;

        return ResponseEntity.ok(CollectionStateDto.builder()
                .slug(curated.getSlug())
                .configNftPolicy(curated.getConfigNftPolicy())
                .collectionPolicyId(curated.getCollectionPolicyId())
                .displayName(curated.getDisplayName())
                .theme(theme)
                .surface(curated.getSurface())
                .defaultPricePolicy(curated.getDefaultPricePolicy())
                .defaultPriceName(curated.getDefaultPriceName())
                .defaultPriceDecimals(curated.getDefaultPriceDecimals())
                .priceTokenLabel(curated.getPriceTokenLabel())
                .config(ConfigDatumDto.builder()
                        .m(config.getM())
                        .protocolFee(config.getProtocolFee())
                        .listerFee(config.getListerFee())
                        .adminPkh(config.getAdminPkh())
                        .treasuryAddr(AddressDto.builder()
                                .paymentCredential(credentialOf(
                                        config.getTreasuryAddrPaymentCredType(),
                                        config.getTreasuryAddrPaymentCredHash()))
                                .stakeCredential(credentialOf(
                                        config.getTreasuryAddrStakeCredType(),
                                        config.getTreasuryAddrStakeCredHash()))
                                .build())
                        .build())
                .listingScriptAddress(curated.getListingScriptAddress())
                .stats(CollectionStatsDto.builder()
                        .nValidListings((int) activeCount)
                        // The next two fields require richer indexer data
                        // (lister-fee accruals + 24h swap window). Left at
                        // 0 until those land.
                        .totalAccruedLovelace(0L)
                        .swapCount24h(0L)
                        .build())
                .mStaleness(MStalenessDto.builder()
                        .currentM(currentM)
                        .recommendedM(recommendedM)
                        .recommendedMRatio(ratio)
                        .build())
                .build());
    }

    @GetMapping(value = "/collections/{slug}/listings", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ListingsResponseDto> listings(@PathVariable String slug) {
        if (!SAFE_SLUG.matcher(slug).matches()) {
            return ResponseEntity.badRequest().build();
        }
        Optional<CuratedCollectionEntity> curatedOpt = curatedCollectionRepository.findById(slug);
        if (curatedOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        CuratedCollectionEntity curated = curatedOpt.get();
        byte[] policyBytes = HexUtil.decodeHexString(curated.getConfigNftPolicy());
        List<ListingEventEntity> events = listingEventRepository.findActiveByConfigNftPolicy(policyBytes);
        List<ListingDto> data = events.stream().map(CollectionController::toListingDto).toList();
        return ResponseEntity.ok(ListingsResponseDto.builder()
                .total(data.size())
                .page(0)
                .size(data.size())
                .data(data)
                .build());
    }

    // ---- Public per-collection marketplace activity + stats ---------------

    @GetMapping(value = "/collections/{slug}/activity", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<MarketActivityDto>> activity(
            @PathVariable String slug,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (!SAFE_SLUG.matcher(slug).matches()) return ResponseEntity.badRequest().build();
        byte[] policy = resolveCollectionPolicy(slug);
        if (policy == null) return ResponseEntity.notFound().build();
        int sz = Math.min(Math.max(size, 1), 100);
        List<MarketActivityDto> out = marketplaceEventRepository
                .findByCollectionPolicyId(policy, PageRequest.of(Math.max(page, 0), sz))
                .stream().map(this::toActivity).toList();
        return ResponseEntity.ok(out);
    }

    @GetMapping(value = "/collections/{slug}/stats", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<MarketCollectionStatsDto> stats(@PathVariable String slug) {
        if (!SAFE_SLUG.matcher(slug).matches()) return ResponseEntity.badRequest().build();
        byte[] policy = resolveCollectionPolicy(slug);
        if (policy == null) return ResponseEntity.notFound().build();

        long active = marketplaceEventRepository.countByCollectionPolicyIdAndSpentActionIsNull(policy);
        List<MarketplaceEventEntity> sold = marketplaceEventRepository
                .findSoldSince(policy, OffsetDateTime.now().minusHours(24));
        BigDecimal volAda = null;
        Set<String> traders = new HashSet<>();
        for (MarketplaceEventEntity e : sold) {
            BigDecimal ada = estimateFor(e).adaEstimate();
            if (ada != null) volAda = (volAda == null ? BigDecimal.ZERO : volAda).add(ada);
            traders.add(HexUtil.encodeHexString(e.getSellerPkh()));
            if (e.getBuyerPkh() != null) traders.add(HexUtil.encodeHexString(e.getBuyerPkh()));
        }
        final BigDecimal vol = volAda;
        BigDecimal volUsd = vol == null ? null
                : priceOracle.adaUsdPrice().map(vol::multiply).orElse(null);

        return ResponseEntity.ok(MarketCollectionStatsDto.builder()
                .activeListings((int) active)
                .sales24h(sold.size())
                .uniqueTraders24h(traders.size())
                .volume24hAda(vol)
                .volume24hUsd(volUsd)
                .floor(computeFloor(marketplaceEventRepository.findActiveByCollectionPolicyId(policy)))
                .build());
    }

    /** slug → collection policy bytes; null when the slug is unknown or config-less-but-policy-less. */
    private byte[] resolveCollectionPolicy(String slug) {
        return curatedCollectionRepository.findById(slug)
                .map(CuratedCollectionEntity::getCollectionPolicyId)
                .filter(p -> p != null && !p.isBlank())
                .map(HexUtil::decodeHexString)
                .orElse(null);
    }

    private static String hex(byte[] b) {
        return b == null || b.length == 0 ? "" : HexUtil.encodeHexString(b);
    }

    private String priceLabel(MarketplaceEventEntity e) {
        return PriceOracle.labelFor(hex(e.getPricePolicy()), hex(e.getPriceName()));
    }

    private PriceOracle.PriceEstimate estimateFor(MarketplaceEventEntity e) {
        String label = priceLabel(e);
        return priceOracle.estimate(e.getPriceQty(), hex(e.getPricePolicy()), hex(e.getPriceName()),
                PriceOracle.decimalsFor(label));
    }

    private MarketActivityDto toActivity(MarketplaceEventEntity e) {
        String label = priceLabel(e);
        PriceOracle.PriceEstimate est = estimateFor(e);
        String action = e.getSpentAction();
        String event;
        String wallet;
        String ts;
        if (action == null) {
            event = "listed";
            wallet = hex(e.getSellerPkh());
            ts = iso(e.getCreatedAt());
        } else if ("sold".equals(action)) {
            event = "sold";
            wallet = hex(e.getBuyerPkh() != null ? e.getBuyerPkh() : e.getSellerPkh());
            ts = iso(e.getSpentAt());
        } else if ("cancelled".equals(action)) {
            event = "cancelled";
            wallet = hex(e.getSellerPkh());
            ts = iso(e.getSpentAt());
        } else {
            event = "spent";
            wallet = hex(e.getSellerPkh());
            ts = iso(e.getSpentAt());
        }
        return MarketActivityDto.builder()
                .event(event)
                .nftUnit(HexUtil.encodeHexString(e.getListedNftUnit()))
                .price(MarketActivityDto.Price.builder()
                        .nativeQty(e.getPriceQty().toString())
                        .tokenLabel(label == null ? "?" : label)
                        .decimals(PriceOracle.decimalsFor(label))
                        .build())
                .adaEstimate(est.adaEstimate())
                .usdEstimate(est.usdEstimate())
                .wallet(wallet)
                .ts(ts)
                .build();
    }

    private MarketCollectionStatsDto.Floor computeFloor(List<MarketplaceEventEntity> actives) {
        MarketplaceEventEntity best = null;
        BigDecimal bestAda = null;
        for (MarketplaceEventEntity e : actives) {
            BigDecimal ada = estimateFor(e).adaEstimate();
            if (ada == null) continue;
            if (bestAda == null || ada.compareTo(bestAda) < 0) {
                bestAda = ada;
                best = e;
            }
        }
        if (best == null) return null;
        String label = priceLabel(best);
        PriceOracle.PriceEstimate est = estimateFor(best);
        return MarketCollectionStatsDto.Floor.builder()
                .nativeQty(best.getPriceQty().toString())
                .tokenLabel(label == null ? "?" : label)
                .decimals(PriceOracle.decimalsFor(label))
                .adaEstimate(est.adaEstimate())
                .usdEstimate(est.usdEstimate())
                .build();
    }

    private static String iso(OffsetDateTime t) {
        return t == null ? null : t.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    static ListingDto toListingDto(ListingEventEntity e) {
        return ListingDto.builder()
                .utxoRef(OutRefDto.builder()
                        .txId(HexUtil.encodeHexString(e.getTxHash()))
                        .outputIndex(e.getOutputIndex())
                        .build())
                .configNftPolicy(HexUtil.encodeHexString(e.getConfigNftPolicy()))
                .listerPkh(HexUtil.encodeHexString(e.getListerPkh()))
                .currentNftUnit(HexUtil.encodeHexString(e.getNftUnit()))
                .lovelace(e.getLovelace())
                // accrued_lovelace = lovelace - min_utxo; we don't track
                // min_utxo per row yet, so report 0 for now.
                .accruedLovelace(0L)
                // update_ref is the (hash → previous outref) resolution
                // documented in BACKEND.md. The indexer phase still needs
                // to wire the lookup-by-hash path; for now leave null on
                // genesis rows.
                .updateRef(null)
                .createdAt(e.getCreatedAt() == null
                        ? null
                        : e.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .build();
    }

    static CredentialDto credentialOf(String type, String hash) {
        if (type == null && hash == null) return null;
        return CredentialDto.builder().type(type).hash(hash).build();
    }
}
