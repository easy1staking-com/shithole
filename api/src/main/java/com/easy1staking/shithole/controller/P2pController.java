package com.easy1staking.shithole.controller;

import com.easy1staking.shithole.entity.PoolMerkleRootEntity;
import com.easy1staking.shithole.model.PoolDto;
import com.easy1staking.shithole.model.ProofDto;
import com.easy1staking.shithole.p2p.PoolMerkleService;
import com.easy1staking.shithole.repository.PoolMerkleRootRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cardanofoundation.merkle.ProofItem;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HexFormat;
import java.util.List;
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
    private static final int MERKLE_ROOT_BYTES = 32; // sha2_256
    private static final int ASSET_NAME_BYTES = 28;  // CIP-25 max

    private final PoolMerkleRootRepository poolMerkleRootRepository;
    private final PoolMerkleService poolMerkleService;

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
        Optional<byte[]> assetOpt = parseHexExact(assetNameHex, ASSET_NAME_BYTES);
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
