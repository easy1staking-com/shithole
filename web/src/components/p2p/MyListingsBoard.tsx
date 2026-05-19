"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useP2pListingsByBuyer } from "@/lib/api/hooks";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitReclaimP2p } from "@/lib/tx/reclaimP2p";
import { fetchUtxoByOutRef } from "@/lib/tx/swap";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { P2pListing } from "@/types/api";

/**
 * /me/p2p — listings YOU created. Each row has a "reclaim" button that
 * spends the listing UTxO back to the buyer's wallet via the Reclaim
 * redeemer (validator authorises on signed_by(buyer_pkh)).
 */
export function MyListingsBoard() {
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const api = useWalletStore((s) => s.api);

  const { data, isPending, isError, error, refetch } = useP2pListingsByBuyer(
    paymentKeyHashHex,
    { includeSpent: false },
  );

  if (!addressBech32) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          connect your wallet to see your open p2p listings.
        </p>
        <WalletConnectButton />
      </div>
    );
  }
  if (isPending) {
    return <p className="text-sm text-zinc-500">looking up your listings…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-red-400" role="alert">
        couldn&apos;t load: {error.message}
      </p>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        no open p2p listings.{" "}
        <Link
          href="/p2p/new"
          className="text-zinc-300 underline-offset-2 hover:underline"
        >
          create one →
        </Link>
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {data.map((l) => (
        <li key={`${l.tx_hash}#${l.output_index}`}>
          <MyListingRow listing={l} onChange={() => void refetch()} api={api} />
        </li>
      ))}
    </ul>
  );
}

function MyListingRow({
  listing,
  onChange,
  api,
}: {
  listing: P2pListing;
  onChange: () => void;
  api: ReturnType<typeof useWalletStore.getState>["api"];
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string } | null>(null);

  const onReclaim = useCallback(async () => {
    if (!api) {
      setErr("connect your wallet first");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const network = toEvolutionNetwork(getNetworkName());
      const client = await makeClient(api);
      const listingUtxo = await fetchUtxoByOutRef(
        client,
        listing.tx_hash,
        listing.output_index,
      );
      const r = await submitReclaimP2p(client, {
        network,
        configNftPolicyHex: listing.config_nft_policy,
        listingUtxo,
        buyerPkhHex: listing.buyer_pkh,
      });
      setResult(r);
      // Optimistic refresh — the BE indexer will mark the row spent in ~30-60s.
      setTimeout(() => onChange(), 5000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, listing, onChange]);

  const bountyAda = (Number(listing.lovelace) / 1_000_000).toFixed(2);
  const offered = listing.offered_nft_unit.slice(56);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm">
            {asciiOrShortHex(offered)}
          </p>
          <p className="text-[10px] text-zinc-500">
            bounty {bountyAda} ADA · root{" "}
            <span className="font-mono">
              {listing.accepted_merkle_root.slice(0, 8)}…
            </span>
          </p>
        </div>
        {result ? (
          <span className="text-xs text-amber-300">reclaim submitted</span>
        ) : (
          <button
            type="button"
            onClick={onReclaim}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-500"
          >
            {busy ? "reclaiming…" : "reclaim"}
          </button>
        )}
      </div>
      {err && (
        <p className="mt-2 text-[11px] text-red-400" role="alert">
          {err}
        </p>
      )}
      {result && (
        <p className="mt-2 break-all font-mono text-[10px] text-zinc-500">
          tx {result.txHash}
        </p>
      )}
    </div>
  );
}

function asciiOrShortHex(hex: string): string {
  if (!hex) return "(no name)";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.every((b) => b >= 0x20 && b <= 0x7e)) {
    return new TextDecoder().decode(bytes);
  }
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
