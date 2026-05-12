package com.easy1staking.shithole.indexer;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * Published by
 * {@link com.easy1staking.shithole.service.ConfigRegistrationService} after a
 * row has been persisted in {@code curated_collections}. The indexer's
 * {@link WatchAddressRegistry} listens for this event and registers the new
 * listing-script address so subsequent on-chain activity is picked up without
 * waiting for the 60s reconciliation backstop.
 */
@Getter
public class ConfigRegisteredEvent extends ApplicationEvent {

    private final String slug;
    private final String configNftPolicy;
    private final String collectionPolicyId;
    private final String listingScriptAddress;

    public ConfigRegisteredEvent(Object source,
                                 String slug,
                                 String configNftPolicy,
                                 String collectionPolicyId,
                                 String listingScriptAddress) {
        super(source);
        this.slug = slug;
        this.configNftPolicy = configNftPolicy;
        this.collectionPolicyId = collectionPolicyId;
        this.listingScriptAddress = listingScriptAddress;
    }
}
