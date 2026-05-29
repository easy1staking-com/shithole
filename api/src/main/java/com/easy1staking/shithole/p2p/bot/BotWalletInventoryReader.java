package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.backend.api.BackendService;
import com.bloxbean.cardano.yaci.store.utxo.storage.impl.repository.UtxoRepository;
import com.easy1staking.cardano.util.UtxoUtil;
import com.easy1staking.shithole.matcher.MatcherHotWallet;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;

import java.util.Collection;

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

    private final UtxoRepository utxoRepository;

    private final MatcherHotWallet hotWallet;

    /**
     * Read the current wallet UTxO set and snapshot it as a
     * {@link BotWalletInventory}. Returns an empty inventory on transient
     * backend errors (logged at WARN) so the detector cycle continues
     * harmlessly — the next block will retry.
     */
    public BotWalletInventory read() {
        String address = hotWallet.getAddress();

        var all = utxoRepository.findUnspentByOwnerAddr(address, Pageable.unpaged())
            .stream()
            .flatMap(Collection::stream)
            .map(UtxoUtil::toUtxo)
            .toList();

        BotWalletInventory inventory = BotWalletInventory.from(all);
        log.debug("BotWalletInventoryReader: address={} utxos={} nfts={}",
            address, all.size(), inventory.totalCount());
        return inventory;
    }
}
