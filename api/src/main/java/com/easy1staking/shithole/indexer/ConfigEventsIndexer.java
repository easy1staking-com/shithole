package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.address.Address;
import com.bloxbean.cardano.client.address.AddressProvider;
import com.bloxbean.cardano.client.address.Credential;
import com.bloxbean.cardano.client.common.model.Network;
import com.bloxbean.cardano.client.util.HexUtil;
import com.bloxbean.cardano.yaci.store.common.domain.AddressUtxo;
import com.bloxbean.cardano.yaci.store.common.domain.Amt;
import com.bloxbean.cardano.yaci.store.events.EventMetadata;
import com.bloxbean.cardano.yaci.store.utxo.domain.AddressUtxoEvent;
import com.bloxbean.cardano.yaci.store.utxo.domain.TxInputOutput;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.PaymentCredential;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.StakeCredential;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.Script;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.paymentcredential.VerificationKey;
import com.easy1staking.shithole.blueprint.generated.cardano.address.model.stakecredential.Inline;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.ConfigDatum;
import com.easy1staking.shithole.blueprint.generated.shithole.types.model.converter.ConfigDatumConverter;
import com.easy1staking.shithole.entity.ConfigEntity;
import com.easy1staking.shithole.indexer.WatchAddressRegistry.WatchedCollection;
import com.easy1staking.shithole.repository.ConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;

/**
 * Keeps the {@code configs} table in sync with the on-chain config UTxO.
 *
 * <p>Lifecycle on chain (SPEC §5.1, §5.2, §6.2):
 * <ul>
 *   <li><b>Mint</b> — one-shot mint via the config validator's mint handler.
 *       New UTxO at the config script address with the config NFT
 *       (asset_name = collection_policy_id, qty 1) and an inline
 *       {@link ConfigDatum}. The {@code POST /api/configs} registration
 *       flow ALSO inserts the row; the indexer is the safety net + the
 *       source of truth for any subsequent change.</li>
 *   <li><b>Update</b> — admin spends the existing config UTxO and recreates
 *       it at the same address with a new datum (validator enforces
 *       continuity + admin sig). Pre-this-indexer the BE would serve the
 *       stale datum forever; now we observe the new output and UPSERT.</li>
 *   <li><b>Rollback</b> — chain reorg. v1 just logs a WARN; on the next
 *       legitimate update the row converges. A future improvement is to
 *       re-fetch the canonical config from chain on rollback.</li>
 * </ul>
 *
 * <p>Idempotency: each candidate output is diffed against the stored
 * ConfigEntity by datum fields + outref. A no-op write is skipped to
 * avoid spurious DB writes on indexer replay.
 *
 * <p>This indexer is a STRICT MIRROR of the latest on-chain config — it
 * doesn't keep history. Anyone needing prior values can query the chain
 * directly via tx history of the config UTxO outref lineage.
 */
@Component
@ConditionalOnProperty(name = "shithole.indexer.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
@Slf4j
public class ConfigEventsIndexer {

    private final WatchAddressRegistry registry;
    private final ConfigRepository configRepository;
    private final Network appNetwork;

    @EventListener
    @Transactional
    public void onAddressUtxoEvent(AddressUtxoEvent event) {
        if (event == null) return;
        if (registry.allConfigAddresses().isEmpty()) {
            // No curated collections yet (or no config addresses derivable).
            return;
        }
        List<TxInputOutput> txs = event.getTxInputOutputs();
        if (txs == null || txs.isEmpty()) return;

        EventMetadata meta = event.getMetadata();
        long slot = meta != null ? meta.getSlot() : 0L;
        OffsetDateTime at = meta != null && meta.getBlockTime() > 0
                ? OffsetDateTime.ofInstant(Instant.ofEpochSecond(meta.getBlockTime()), ZoneOffset.UTC)
                : OffsetDateTime.now(ZoneOffset.UTC);

        for (TxInputOutput tx : txs) {
            try {
                processTx(tx, slot, at);
            } catch (RuntimeException e) {
                log.error("ConfigEventsIndexer: error processing tx {}: {}",
                        tx != null ? tx.getTxHash() : "<null>", e.getMessage(), e);
            }
        }
    }

    private void processTx(TxInputOutput tx, long slot, OffsetDateTime at) {
        if (tx == null || tx.getTxHash() == null) return;
        List<AddressUtxo> outputs = tx.getOutputs();
        if (outputs == null || outputs.isEmpty()) return;

        for (AddressUtxo out : outputs) {
            if (out == null) continue;
            String addr = out.getOwnerAddr();
            if (addr == null) continue;
            WatchedCollection wc = registry.getByConfigAddress(addr);
            if (wc == null) continue;

            // Strict shape: exactly one NFT under config_nft_policy with
            // asset_name = collection_policy_id, qty 1, and an inline datum
            // that decodes as ConfigDatum.
            if (!carriesExpectedConfigNft(out, wc.configNftPolicy(), wc.collectionPolicyId())) {
                log.debug("ConfigEventsIndexer: skip {}#{} at {} — config NFT shape mismatch (slug={})",
                        out.getTxHash(), out.getOutputIndex(), addr, wc.slug());
                continue;
            }
            Optional<ConfigDatum> decoded = decodeConfigDatum(out.getInlineDatum());
            if (decoded.isEmpty()) {
                log.debug("ConfigEventsIndexer: skip {}#{} at {} — inline datum not a ConfigDatum (slug={})",
                        out.getTxHash(), out.getOutputIndex(), addr, wc.slug());
                continue;
            }
            ConfigDatum datum = decoded.get();
            TreasuryAddressFields treasury;
            try {
                treasury = decodeTreasuryAddress(datum);
            } catch (RuntimeException e) {
                log.warn("ConfigEventsIndexer: skip {}#{} (slug={}) — treasury decode failed: {}",
                        out.getTxHash(), out.getOutputIndex(), wc.slug(), e.getMessage());
                continue;
            }
            upsertConfig(wc, out, datum, treasury, slot, at);
        }
    }

    /**
     * UPSERT the configs row from the decoded on-chain state. Skips the
     * write entirely if every persisted field already matches the new
     * value AND the row already points at this output ref — avoids
     * churn on indexer replays.
     */
    private void upsertConfig(WatchedCollection wc, AddressUtxo out,
                              ConfigDatum datum, TreasuryAddressFields treasury,
                              long slot, OffsetDateTime at) {
        String policy = wc.configNftPolicy().toLowerCase(Locale.ROOT);
        Optional<ConfigEntity> existingOpt = configRepository.findById(policy);

        ConfigEntity row = existingOpt.orElseGet(() ->
                ConfigEntity.builder().configNftPolicy(policy).build());

        Integer newM = datum.getM().intValueExact();
        Long newProtocolFee = datum.getProtocolFee().longValueExact();
        Long newListerFee = datum.getListerFee().longValueExact();
        String newAdminPkh = hex(datum.getAdminPkh().bytes());
        String newTxId = out.getTxHash();
        Integer newOutIdx = out.getOutputIndex();

        if (existingOpt.isPresent()
                && Objects.equals(row.getM(), newM)
                && Objects.equals(row.getProtocolFee(), newProtocolFee)
                && Objects.equals(row.getListerFee(), newListerFee)
                && Objects.equals(row.getTreasuryAddrBech32(), treasury.bech32())
                && Objects.equals(row.getTreasuryAddrPaymentCredType(), treasury.paymentCredType())
                && Objects.equals(row.getTreasuryAddrPaymentCredHash(), treasury.paymentCredHash())
                && Objects.equals(row.getTreasuryAddrStakeCredType(), treasury.stakeCredType())
                && Objects.equals(row.getTreasuryAddrStakeCredHash(), treasury.stakeCredHash())
                && Objects.equals(row.getAdminPkh(), newAdminPkh)
                && Objects.equals(row.getUtxoTxId(), newTxId)
                && Objects.equals(row.getUtxoOutputIndex(), newOutIdx)) {
            return;
        }

        row.setUtxoTxId(newTxId);
        row.setUtxoOutputIndex(newOutIdx);
        row.setM(newM);
        row.setProtocolFee(newProtocolFee);
        row.setListerFee(newListerFee);
        row.setTreasuryAddrBech32(treasury.bech32());
        row.setTreasuryAddrPaymentCredType(treasury.paymentCredType());
        row.setTreasuryAddrPaymentCredHash(treasury.paymentCredHash());
        row.setTreasuryAddrStakeCredType(treasury.stakeCredType());
        row.setTreasuryAddrStakeCredHash(treasury.stakeCredHash());
        row.setAdminPkh(newAdminPkh);
        row.setUpdatedAtSlot(slot);
        row.setUpdatedAt(at);

        configRepository.save(row);
        log.info("configs upsert slug={} policy={} m={} protocol_fee={} lister_fee={} admin={} @ {}#{}",
                wc.slug(), policy, newM, newProtocolFee, newListerFee, newAdminPkh,
                newTxId, newOutIdx);
    }

    /**
     * Verify the output strictly carries one NFT under {@code config_nft_policy}
     * with asset name = {@code collection_policy_id} (28 bytes, hex), quantity
     * exactly 1, and no other non-ADA assets.
     */
    private boolean carriesExpectedConfigNft(AddressUtxo out, String policyHex, String collectionPolicyIdHex) {
        if (out.getAmounts() == null || policyHex == null) return false;
        String wantPolicy = policyHex.toLowerCase(Locale.ROOT);
        String wantAssetName = collectionPolicyIdHex == null
                ? null
                : collectionPolicyIdHex.toLowerCase(Locale.ROOT);
        Amt match = null;
        for (Amt a : out.getAmounts()) {
            if (a == null) continue;
            if (a.getPolicyId() == null) continue;
            if (a.getPolicyId().isEmpty()
                    || "lovelace".equalsIgnoreCase(a.getUnit())) continue;
            if (wantPolicy.equalsIgnoreCase(a.getPolicyId())) {
                if (a.getQuantity() == null || a.getQuantity().compareTo(BigInteger.ONE) != 0) {
                    return false;
                }
                String name = a.getAssetName();
                if (name == null || name.isEmpty()) return false;
                if (wantAssetName != null && !wantAssetName.equalsIgnoreCase(name)) {
                    return false;
                }
                if (match != null) return false;
                match = a;
            } else {
                // Co-tenant under a different policy not allowed for a legit config UTxO.
                return false;
            }
        }
        return match != null;
    }

    /**
     * Decode the inline datum hex as a {@link ConfigDatum}. Returns
     * {@link Optional#empty()} on any decode failure — never throws.
     */
    private Optional<ConfigDatum> decodeConfigDatum(String inlineDatumHex) {
        if (inlineDatumHex == null || inlineDatumHex.isBlank()) return Optional.empty();
        try {
            return Optional.ofNullable(new ConfigDatumConverter().deserialize(inlineDatumHex));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /**
     * Lifted from {@code ConfigRegistrationService.decodeTreasuryAddress} so
     * the indexer doesn't need a cyclic dep on the registration service. The
     * two implementations should be kept in sync — TODO: dedupe into a
     * common helper.
     */
    private TreasuryAddressFields decodeTreasuryAddress(ConfigDatum datum) {
        PaymentCredential pc = datum.getTreasuryAddr().getPaymentCredential();
        Optional<StakeCredential> sc = datum.getTreasuryAddr().getStakeCredential();

        Credential paymentCcl;
        String paymentType;
        String paymentHash;
        if (pc instanceof VerificationKey vk) {
            byte[] h = vk.getVerificationKeyHash().bytes();
            paymentCcl = Credential.fromKey(h);
            paymentType = "verification_key";
            paymentHash = hex(h);
        } else if (pc instanceof Script s) {
            byte[] h = s.getScriptHash().bytes();
            paymentCcl = Credential.fromScript(h);
            paymentType = "script";
            paymentHash = hex(h);
        } else {
            throw new IllegalArgumentException(
                    "unsupported PaymentCredential variant: "
                            + (pc == null ? "null" : pc.getClass().getName()));
        }

        Credential stakeCcl = null;
        String stakeType = null;
        String stakeHash = null;
        if (sc != null && sc.isPresent()) {
            StakeCredential stake = sc.get();
            if (stake instanceof Inline inline) {
                var inner = inline.getCredential();
                if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.VerificationKey vk) {
                    byte[] h = vk.getVerificationKeyHash().bytes();
                    stakeCcl = Credential.fromKey(h);
                    stakeType = "verification_key";
                    stakeHash = hex(h);
                } else if (inner instanceof com.easy1staking.shithole.blueprint.generated.cardano.address.model.credential.Script s) {
                    byte[] h = s.getScriptHash().bytes();
                    stakeCcl = Credential.fromScript(h);
                    stakeType = "script";
                    stakeHash = hex(h);
                } else {
                    throw new IllegalArgumentException(
                            "unsupported stake inner Credential variant: "
                                    + (inner == null ? "null" : inner.getClass().getName()));
                }
            } else {
                throw new IllegalArgumentException(
                        "pointer / non-inline stake credentials are not supported for treasury_addr");
            }
        }

        Address bech32Address = stakeCcl == null
                ? AddressProvider.getEntAddress(paymentCcl, appNetwork)
                : AddressProvider.getBaseAddress(paymentCcl, stakeCcl, appNetwork);

        return new TreasuryAddressFields(
                bech32Address.toBech32(),
                paymentType, paymentHash, stakeType, stakeHash);
    }

    private static String hex(byte[] b) {
        if (b == null) return null;
        return HexUtil.encodeHexString(b);
    }

    private record TreasuryAddressFields(
            String bech32,
            String paymentCredType,
            String paymentCredHash,
            String stakeCredType,
            String stakeCredHash) {}
}
