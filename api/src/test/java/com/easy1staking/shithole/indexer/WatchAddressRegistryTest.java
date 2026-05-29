package com.easy1staking.shithole.indexer;

import com.bloxbean.cardano.client.common.model.Networks;
import com.easy1staking.shithole.entity.CuratedCollectionEntity;
import com.easy1staking.shithole.repository.ConfigRepository;
import com.easy1staking.shithole.repository.CuratedCollectionRepository;
import com.easy1staking.shithole.service.MarketplaceScriptAddressDeriver;
import com.easy1staking.shithole.service.WantedListingScriptAddressDeriver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link WatchAddressRegistry}. The repository is mocked so
 * the tests run without Spring or a DB.
 */
@ExtendWith(MockitoExtension.class)
class WatchAddressRegistryTest {

    @Mock
    private CuratedCollectionRepository repo;

    @Mock
    private ConfigRepository configRepo;

    @Mock
    private WantedListingScriptAddressDeriver wantedDeriver;

    @Mock
    private MarketplaceScriptAddressDeriver marketDeriver;

    private WatchAddressRegistry registry;

    @BeforeEach
    void setUp() {
        // Stub the deriver to a fixed dummy address. lenient() because some
        // tests don't trigger reconcile/registration paths that would call it.
        lenient().when(wantedDeriver.deriveAddress(anyString()))
                .thenReturn("addr_test1w_wanted_dummy");
        // Default: no config row known. Treasury / admin pkh come back null;
        // the registry still publishes the WatchedCollection — those fields
        // are non-load-bearing for "is this address watched" semantics.
        lenient().when(configRepo.findById(anyString())).thenReturn(Optional.empty());
        // Marketplace deriver returns null in these tests — they exercise the
        // per-collection registry, not the singleton marketplace branch.
        lenient().when(marketDeriver.deriveAddress()).thenReturn(null);
        registry = new WatchAddressRegistry(
                repo, configRepo, Networks.preprod(), wantedDeriver, marketDeriver);
    }

    @Test
    void loadsExistingRowsAtStartup() {
        CuratedCollectionEntity hosky = CuratedCollectionEntity.builder()
                .slug("hosky")
                .configNftPolicy("ab".repeat(28))
                .collectionPolicyId("cd".repeat(28))
                .listingScriptAddress("addr_test1w_hosky")
                .build();
        when(repo.findAll()).thenReturn(List.of(hosky));

        registry.reconcile();

        assertThat(registry.isWatched("addr_test1w_hosky")).isTrue();
        assertThat(registry.size()).isEqualTo(1);
        var wc = registry.get("addr_test1w_hosky");
        assertThat(wc).isNotNull();
        assertThat(wc.slug()).isEqualTo("hosky");
        assertThat(wc.configNftPolicy()).isEqualTo("ab".repeat(28));
        assertThat(wc.collectionPolicyId()).isEqualTo("cd".repeat(28));
    }

    @Test
    void skipsRowsWithNullOrBlankListingScriptAddress() {
        CuratedCollectionEntity bad = CuratedCollectionEntity.builder()
                .slug("ghost")
                .configNftPolicy("ab".repeat(28))
                .collectionPolicyId("cd".repeat(28))
                .listingScriptAddress(null)
                .build();
        CuratedCollectionEntity blank = CuratedCollectionEntity.builder()
                .slug("blank")
                .configNftPolicy("11".repeat(28))
                .collectionPolicyId("22".repeat(28))
                .listingScriptAddress("")
                .build();
        when(repo.findAll()).thenReturn(List.of(bad, blank));

        registry.reconcile();

        assertThat(registry.size()).isZero();
    }

    @Test
    void emptyRepositoryYieldsEmptyRegistry() {
        when(repo.findAll()).thenReturn(List.of());

        registry.reconcile();

        assertThat(registry.size()).isZero();
        assertThat(registry.isWatched("addr_test1w_anything")).isFalse();
        assertThat(registry.all()).isEmpty();
    }

    @Test
    void configRegisteredEventAddsNewWatch() {
        when(repo.findAll()).thenReturn(List.of());
        registry.reconcile();
        assertThat(registry.size()).isZero();

        ConfigRegisteredEvent event = new ConfigRegisteredEvent(
                this,
                "newcoll",
                "ee".repeat(28),
                "ff".repeat(28),
                "addr_test1w_newcoll");

        registry.onConfigRegistered(event);

        assertThat(registry.isWatched("addr_test1w_newcoll")).isTrue();
        assertThat(registry.size()).isEqualTo(1);
        assertThat(registry.get("addr_test1w_newcoll").slug()).isEqualTo("newcoll");
    }

    @Test
    void configRegisteredEventWithNullAddressIsIgnored() {
        when(repo.findAll()).thenReturn(List.of());
        registry.reconcile();

        ConfigRegisteredEvent event = new ConfigRegisteredEvent(
                this, "x", "ab".repeat(28), "cd".repeat(28), null);

        registry.onConfigRegistered(event);

        assertThat(registry.size()).isZero();
    }

    @Test
    void repositoryFailureDuringReconcileIsSwallowed() {
        when(repo.findAll()).thenThrow(new RuntimeException("DB hiccup"));

        // Should not throw — the indexer must survive a transient DB outage.
        registry.reconcile();

        assertThat(registry.size()).isZero();
    }

    @Test
    void isWatchedReturnsFalseForNullInput() {
        assertThat(registry.isWatched(null)).isFalse();
    }
}
