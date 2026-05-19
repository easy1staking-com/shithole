package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import com.easy1staking.shithole.entity.WantedListingEventEntity;
import com.easy1staking.shithole.model.AssetPoolMembershipRequest;
import com.easy1staking.shithole.model.P2pListingDto;
import com.easy1staking.shithole.model.PoolDto;
import com.easy1staking.shithole.model.ProofDto;
import com.easy1staking.shithole.p2p.PoolMerkleService;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import com.easy1staking.shithole.repository.WantedListingEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cardanofoundation.merkle.ProofItem;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * v3 wanted-listing public endpoints — read-only views over
 * {@code pool_merkle_roots} plus on-demand proof generation via
 * {@link PoolMerkleService}.
 *
 * <p>Drives the FE's wanted-listing UX:
 * <ul>
 *   <li>{@code GET /p2p/pools} — list active pools (carousel/picker).</li>
 *   <li>{@code GET /p2p/pools/{ticker}} — single active pool detail.</li>
 *   <li>{@code GET /p2p/pools/{root}/proofs/{asset_name}} — proof for a
 *       seller's Fulfill redeemer. Works for historical roots too.</li>
 *   <li>{@code GET /p2p/pools/by-root/{root}} — reverse lookup (which ticker
 *       does this root belong to?). Used by the FE to label a listing's
 *       accepted-pool when only the root is on-chain.</li>
 * </ul>
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class P2pController {

    private static final HexFormat HEX = HexFormat.of();
    private static final int MERKLE_ROOT_BYTES = 32;       // sha2_256
    private static final int ASSET_NAME_MIN_BYTES = 1;     // CIP-25 (Hosky uses 22)
    private static final int ASSET_NAME_MAX_BYTES = 32;    // CIP-25 hard cap

    private final PoolMerkleRootRepository poolMerkleRootRepository;
    private final PoolMerkleService poolMerkleService;
    private final WantedListingEventRepository wantedListingEventRepository;

    @GetMapping(value = "/p2p/pools", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<PoolDto>> activePools() {
        List<PoolDto> pools = poolMerkleRootRepository.findAllActive().stream()
                .map(P2pController::toSummaryDto)
                .toList();
        return ResponseEntity.ok(pools);
    }

    @GetMapping(value = "/p2p/pools/{ticker}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PoolDto> poolByTicker(@PathVariable("ticker") String ticker) {
        return poolMerkleRootRepository.findActiveByTicker(ticker)
                .map(P2pController::toSummaryDto)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping(value = "/p2p/pools/by-root/{merkleRootHex}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PoolDto> poolByRoot(@PathVariable("merkleRootHex") String merkleRootHex) {
        Optional<byte[]> rootOpt = parseHexExact(merkleRootHex, MERKLE_ROOT_BYTES);
        if (rootOpt.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        return poolMerkleRootRepository.findById(rootOpt.get())
                .map(P2pController::toSummaryDto)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping(value = "/p2p/pools/{merkleRootHex}/proofs/{assetNameHex}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ProofDto> proofFor(
            @PathVariable("merkleRootHex") String merkleRootHex,
            @PathVariable("assetNameHex") String assetNameHex) {
        Optional<byte[]> rootOpt = parseHexExact(merkleRootHex, MERKLE_ROOT_BYTES);
        Optional<byte[]> assetOpt =
                parseHexRange(assetNameHex, ASSET_NAME_MIN_BYTES, ASSET_NAME_MAX_BYTES);
        if (rootOpt.isEmpty() || assetOpt.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        Optional<List<ProofItem>> proof =
                poolMerkleService.getProof(rootOpt.get(), assetOpt.get());
        return proof
                .map(items -> ProofDto.builder()
                        .merkleRootHex(merkleRootHex.toLowerCase())
                        .assetNameHex(assetNameHex.toLowerCase())
                        .proof(items.stream().map(P2pController::toStepDto).toList())
                        .build())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Batch lookup — for each requested {@code asset_name_hex}, return the
     * tickers of all CURRENTLY-ACTIVE pools whose merkle tree includes it.
     * Drives the FE wallet picker's pool ribbons + "select unmatched" affordance.
     *
     * <p>The request bounds each asset_name to 1-32 bytes (CIP-25 max);
     * malformed entries are simply absent from the response rather than
     * failing the whole batch — the FE renders "no pools" for those.
     *
     * <p>Response shape: {@code { asset_name_hex_lowercase: [ticker, …] }}.
     * Keys are lowercase even if the request used uppercase, so the FE can
     * cache by a single normalised key.
     */
    @PostMapping(value = "/p2p/asset-pool-membership",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, List<String>>> assetPoolMembership(
            @RequestBody AssetPoolMembershipRequest req) {
        if (req == null || req.assetNamesHex() == null) {
            return ResponseEntity.badRequest().build();
        }
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (String raw : req.assetNamesHex()) {
            Optional<byte[]> parsed =
                    parseHexRange(raw, ASSET_NAME_MIN_BYTES, ASSET_NAME_MAX_BYTES);
            if (parsed.isEmpty()) continue;
            String norm = raw.toLowerCase();
            out.put(norm, poolMerkleService.getPoolMembership(norm));
        }
        return ResponseEntity.ok(out);
    }

    private static PoolDto toSummaryDto(PoolMerkleRootEntity e) {
        return PoolDto.builder()
                .ticker(e.getTicker())
                .poolIdHex(e.getPoolId() == null ? null : HEX.formatHex(e.getPoolId()))
                .merkleRootHex(HEX.formatHex(e.getMerkleRoot()))
                .totalAssets(e.getTotalAssets())
                .isActive(e.getIsActive())
                .build();
    }

    private static ProofDto.ProofStep toStepDto(ProofItem item) {
        if (item instanceof ProofItem.Left l) {
            return new ProofDto.ProofStep("left", HEX.formatHex(l.getHash()));
        }
        if (item instanceof ProofItem.Right r) {
            return new ProofDto.ProofStep("right", HEX.formatHex(r.getHash()));
        }
        throw new IllegalStateException("unknown ProofItem subtype: " + item);
    }

    /* ---- listings — browse + by-buyer ----------------------------------- */

    /**
     * Browse currently-active wanted listings, newest first. Optional
     * filters narrow by collection (configNftPolicy hex) or by accepted
     * merkle root (one or repeated query params).
     *
     * <p>Cap page size at 100 so a curious caller can't drag the whole
     * table over the wire. Default 50.
     */
    @GetMapping(value = "/p2p/listings", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<P2pListingDto>> activeListings(
            @RequestParam(value = "config", required = false) String configNftPolicyHex,
            @RequestParam(value = "root", required = false) List<String> merkleRootHexes,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestParam(value = "page", defaultValue = "0") int page) {
        int safeSize = Math.max(1, Math.min(100, size));
        int safePage = Math.max(0, page);
        var pageable = PageRequest.of(safePage, safeSize);

        List<WantedListingEventEntity> rows;
        if (merkleRootHexes != null && !merkleRootHexes.isEmpty()) {
            List<byte[]> rootsBytes = merkleRootHexes.stream()
                    .map(h -> parseHexExact(h, MERKLE_ROOT_BYTES))
                    .filter(Optional::isPresent)
                    .map(Optional::get)
                    .toList();
            if (rootsBytes.isEmpty()) {
                return ResponseEntity.badRequest().build();
            }
            rows = wantedListingEventRepository.findActiveByMerkleRoots(rootsBytes, pageable);
        } else if (configNftPolicyHex != null && !configNftPolicyHex.isEmpty()) {
            Optional<byte[]> policyOpt = parseHexExact(configNftPolicyHex, 28);
            if (policyOpt.isEmpty()) return ResponseEntity.badRequest().build();
            rows = wantedListingEventRepository.findActiveByConfigNftPolicy(
                    policyOpt.get(), pageable);
        } else {
            rows = wantedListingEventRepository.findAllActive(pageable);
        }
        return ResponseEntity.ok(rows.stream().map(P2pController::toListingDto).toList());
    }

    /**
     * "Your listings" view — by buyer pkh. {@code includeSpent=true} returns
     * both active + historical (good for a "past listings" subview);
     * default returns active only.
     */
    @GetMapping(value = "/p2p/listings/by-buyer/{buyerPkhHex}",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<P2pListingDto>> listingsByBuyer(
            @PathVariable("buyerPkhHex") String buyerPkhHex,
            @RequestParam(value = "includeSpent", defaultValue = "false") boolean includeSpent,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestParam(value = "page", defaultValue = "0") int page) {
        Optional<byte[]> pkhOpt = parseHexExact(buyerPkhHex, 28);
        if (pkhOpt.isEmpty()) return ResponseEntity.badRequest().build();
        int safeSize = Math.max(1, Math.min(100, size));
        int safePage = Math.max(0, page);
        var pageable = PageRequest.of(safePage, safeSize);

        List<WantedListingEventEntity> rows = includeSpent
                ? wantedListingEventRepository.findAllByBuyerPkh(pkhOpt.get(), pageable)
                : wantedListingEventRepository.findActiveByBuyerPkh(pkhOpt.get(), pageable);
        return ResponseEntity.ok(rows.stream().map(P2pController::toListingDto).toList());
    }

    /* ---- helpers -------------------------------------------------------- */

    private static P2pListingDto toListingDto(WantedListingEventEntity e) {
        return P2pListingDto.builder()
                .txHash(HEX.formatHex(e.getTxHash()))
                .outputIndex(e.getOutputIndex())
                .configNftPolicy(HEX.formatHex(e.getConfigNftPolicy()))
                .buyerPkh(HEX.formatHex(e.getBuyerPkh()))
                .buyerAddressBech32(e.getBuyerAddressBech32())
                .acceptedMerkleRoot(HEX.formatHex(e.getAcceptedMerkleRoot()))
                .offeredNftUnit(HEX.formatHex(e.getOfferedNftUnit()))
                .lovelace(e.getLovelace())
                .createdAtSlot(e.getCreatedAtSlot())
                .createdAt(e.getCreatedAt() == null ? null
                        : e.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .spentAction(e.getSpentAction())
                .spentAtSlot(e.getSpentAtSlot())
                .spentAt(e.getSpentAt() == null ? null
                        : e.getSpentAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
                .spentByTxHash(e.getSpentByTxHash() == null ? null
                        : HEX.formatHex(e.getSpentByTxHash()))
                .build();
    }

    /**
     * Hex parse with a byte-length range, used for asset_names (1-32 bytes
     * per CIP-25). Empty Optional means "respond 400 / skip".
     */
    private static Optional<byte[]> parseHexRange(String hex, int minLen, int maxLen) {
        if (hex == null || hex.isEmpty()) {
            return Optional.empty();
        }
        byte[] bytes;
        try {
            bytes = HEX.parseHex(hex);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        if (bytes.length < minLen || bytes.length > maxLen) {
            return Optional.empty();
        }
        return Optional.of(bytes);
    }

    /**
     * Strict hex parse — rejects malformed hex AND wrong-length inputs at the
     * controller boundary. Empty Optional means "respond 400". The DB has its
     * own CHECK constraints on these lengths, but failing fast here keeps
     * malformed inputs out of the service + DB altogether.
     */
    private static Optional<byte[]> parseHexExact(String hex, int expectedLen) {
        if (hex == null || hex.isEmpty()) {
            return Optional.empty();
        }
        byte[] bytes;
        try {
            bytes = HEX.parseHex(hex);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        if (bytes.length != expectedLen) {
            return Optional.empty();
        }
        return Optional.of(bytes);
    }
}
