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
import com.easy1staking.shithole.model.OutRefDto;
import com.easy1staking.shithole.model.ThemeDto;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.repository.ListingEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;
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
                .theme(ThemeDto.builder()
                        .backgroundUrl(curated.getBackgroundUrl())
                        .accentColor(curated.getAccentColor())
                        .mascotImageUrl(curated.getMascotImageUrl())
                        .build())
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
