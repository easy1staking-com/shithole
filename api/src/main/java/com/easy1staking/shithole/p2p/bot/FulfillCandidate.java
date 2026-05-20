package com.easy1staking.shithole.p2p.bot;

import com.bloxbean.cardano.client.api.model.Utxo;
import com.easy1staking.shithole.entity.WantedListingEventEntity;

/**
 * One detected auto-fulfillable wanted-listing — the bot holds an NFT
 * matching the listing's accepted_merkle_root and can submit a single
 * Fulfill tx to collect the bounty.
 *
 * <p>Invariants (enforced by {@link P2pAutoFulfillerDetector}):
 * <ul>
 *   <li>{@code depositAssetName} is a leaf in
 *       {@code listing.acceptedMerkleRoot}'s tree.</li>
 *   <li>{@code depositUtxo} is a wallet UTxO belonging to
 *       {@link com.easy1staking.shithole.matcher.MatcherHotWallet#getAddress()},
 *       and contains exactly one of
 *       {@code (collectionPolicy || depositAssetName)} at quantity 1.</li>
 * </ul>
 *
 * <p>{@code depositUtxo} is captured at detect-time so the tx-builder doesn't
 * have to re-page the wallet. The on-chain race remains: by tx-build time the
 * UTxO might be gone (another tx beat us); the builder handles this as a
 * "race lost" outcome.
 *
 * @param listing            the on-chain wanted-listing UTxO to fulfill
 * @param depositAssetName   the asset_name of the bot-held NFT that will be
 *                           deposited into the buyer's output (28..32 bytes)
 * @param depositUtxo        the wallet UTxO containing the NFT (forced into
 *                           tx inputs so the balancer doesn't pick a different
 *                           ADA-only UTxO and leave a negative-qty change)
 * @param estimatedNetLovelace ranking-only estimate; actual net is determined
 *                             after CCL balances the tx
 */
public record FulfillCandidate(
        WantedListingEventEntity listing,
        byte[] depositAssetName,
        Utxo depositUtxo,
        long estimatedNetLovelace) {

    /** Outref key of the listing — used to register in {@link P2pInFlightTracker}. */
    public String listingOutrefKey() {
        return P2pInFlightTracker.outrefKey(listing);
    }
}
