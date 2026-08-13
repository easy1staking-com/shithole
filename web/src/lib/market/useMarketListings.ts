"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchMarketListings,
  type DecodedListing,
} from "@/lib/market/queryListings";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { makeReadClient, type EvolutionClient } from "@/lib/tx/evolutionClient";

/**
 * Public, connect-free marketplace listings. Reads every UTxO at the
 * derived marketplace address via a wallet-less {@link makeReadClient}, so
 * the landing can show live NFTs before any wallet connects. Mirrors
 * MarketBrowse's fetch shape (useCallback + effect) so state updates stay
 * out of the effect body.
 */
export function useMarketListings(): {
  listings: DecodedListing[] | null;
  loading: boolean;
  error: unknown;
} {
  const { data: manifest } = useDerivedMarketplaceManifest();
  const marketplaceAddress = manifest?.marketplaceAddress ?? null;

  const [listings, setListings] = useState<DecodedListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!marketplaceAddress) return;
    setLoading(true);
    setError(null);
    try {
      const client = makeReadClient();
      // fetchMarketListings only calls client.getUtxos — a provider method
      // present on the read client. The cast bridges its wallet-typed
      // signature; no wallet is used at runtime.
      const found = await fetchMarketListings(
        client as unknown as EvolutionClient,
        marketplaceAddress,
      );
      setListings(found);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [marketplaceAddress]);

  useEffect(() => {
    // Fetch-on-mount: refresh() sets loading synchronously then awaits the
    // network. Intentional external-data sync, not an avoidable cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { listings, loading, error };
}
