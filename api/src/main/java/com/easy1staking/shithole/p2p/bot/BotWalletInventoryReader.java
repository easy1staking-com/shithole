package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.model.Result;
import com.bloxbean.cardano.client.api.model.Utxo;
import com.bloxbean.cardano.client.backend.api.BackendService;
import com.easy1staking.shithole.matcher.MatcherHotWallet;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Pages the hot-wallet UTxOs from Blockfrost (or whatever {@link BackendService}
 * is wired) and builds a {@link BotWalletInventory} snapshot. Extracted from
 * the detector so unit tests can stub a static inventory without spinning up
 * a Blockfrost client.
 *
 * <p>Wired only when the auto-fulfiller is enabled
 * ({@code shithole.p2p.auto-fulfill.enabled=true}) — the underlying
 * {@link MatcherHotWallet} requires the matcher's mnemonic env var to be set
 * (the auto-fulfiller piggy-backs on the same hot wallet by design, see
 * {@code api/docs/P2P_MATCHER.md} §Auto-fulfill loop).
 */
@Component
@ConditionalOnProperty(name = "shithole.p2p.auto-fulfill.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class BotWalletInventoryReader {

    /** Defensive cap: bot wallet inventory >50 pages * 100 = 5k UTxOs is a sign of bloat. */
    private static final int MAX_UTXO_PAGES = 50;
    private static final int UTXO_PAGE_SIZE = 100;

    private final BackendService backendService;
    private final MatcherHotWallet hotWallet;

    /**
     * Read the current wallet UTxO set and snapshot it as a
     * {@link BotWalletInventory}. Returns an empty inventory on transient
     * backend errors (logged at WARN) so the detector cycle continues
     * harmlessly — the next block will retry.
     */
    public BotWalletInventory read() {
        String address = hotWallet.getAddress();
        List<Utxo> all = new ArrayList<>();
        try {
            int page = 1;
            while (page <= MAX_UTXO_PAGES) {
                Result<List<Utxo>> result = backendService.getUtxoService()
                        .getUtxos(address, UTXO_PAGE_SIZE, page, OrderEnum.asc);
                if (result == null || !result.isSuccessful()) {
                    if (result != null && result.code() == 404) break;
                    log.warn("BotWalletInventoryReader: backend error code={} msg={}",
                            result == null ? "?" : result.code(),
                            result == null ? "(null)" : result.getResponse());
                    return BotWalletInventory.empty();
                }
                List<Utxo> batch = result.getValue();
                if (batch == null || batch.isEmpty()) break;
                all.addAll(batch);
                if (batch.size() < UTXO_PAGE_SIZE) break;
                page++;
            }
        } catch (Exception e) {
            log.warn("BotWalletInventoryReader: error reading wallet inventory at {}: {}",
                    address, e.getMessage());
            return BotWalletInventory.empty();
        }
        BotWalletInventory inventory = BotWalletInventory.from(all);
        log.debug("BotWalletInventoryReader: address={} utxos={} nfts={}",
                address, all.size(), inventory.totalCount());
        return inventory;
    }
}
