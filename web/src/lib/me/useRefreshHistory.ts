"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Returns a stable callback that invalidates every React Query feeding
 * the wallet-history surface (pit + p2p + market lists by pkh). Call it
 * after {@code awaitTxConfirmation} resolves on any FE tx flow so the
 * history drawer + {@code /me/history} page reflect the new chain state
 * without the user reloading.
 *
 * <p>Targets the prefix of each {@code listingsByPkh}-family queryKey
 * so all pages/sizes for the current wallet are refreshed in one shot.
 */
export function useRefreshHistory(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ["listingsByPkh"] });
    qc.invalidateQueries({ queryKey: ["p2pListingsByPkh"] });
    qc.invalidateQueries({ queryKey: ["marketListingsByPkh"] });
  }, [qc]);
}
