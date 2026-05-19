"use client";

import { SelectableWalletCard } from "@/components/pit/SelectableWalletCard";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import {
  useWalletCollectionNfts,
  type WalletCollectionNft,
} from "@/lib/wallet/useWalletCollectionNfts";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Step 2 of the p2p create flow — single-select NFT picker over the
 * connected wallet's holdings of {@code collectionPolicyHex}.
 *
 * <p>Unlike v2's list mode (multi-select batch), p2p creation is one NFT
 * per listing — the buyer locks ONE offered NFT + bounty per wanted-
 * listing UTxO. So the picker is radio-style (mutually exclusive).
 *
 * <p>States handled:
 * <ul>
 *   <li>no wallet connected → connect button + nudge</li>
 *   <li>loading wallet contents → muted text</li>
 *   <li>empty (no NFTs of this collection) → on-brand nudge</li>
 *   <li>populated → grid of {@link SelectableWalletCard}s</li>
 * </ul>
 *
 * <p>Selection state is owned by the parent (CreateListingForm).
 */
export function NftPickerStep({
  collectionPolicyHex,
  accent,
  selectedUnit,
  onSelect,
}: {
  collectionPolicyHex: string;
  accent: string;
  selectedUnit: string | null;
  onSelect: (nft: WalletCollectionNft) => void;
}) {
  const addressBech32 = useWalletStore((s) => s.addressBech32);
  const {
    data: nfts,
    isPending,
    isError,
    error,
  } = useWalletCollectionNfts(addressBech32, collectionPolicyHex);

  if (!addressBech32) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          connect your wallet so we can see what s#!t you&apos;re willing
          to part with.
        </p>
        <WalletConnectButton />
      </div>
    );
  }

  if (isPending) {
    return <p className="text-sm text-zinc-500">peeking inside your wallet…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-400" role="alert">
        could not read wallet contents: {error.message}
      </p>
    );
  }

  if (!nfts || nfts.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        your wallet has no s#!t from this pit. either you&apos;re already
        clean or you&apos;re in the wrong pit.
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="your NFTs from this collection"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
    >
      {nfts.map((nft) => (
        <SelectableWalletCard
          key={nft.unit}
          nft={nft}
          accent={accent}
          selected={nft.unit === selectedUnit}
          onToggle={() => onSelect(nft)}
        />
      ))}
    </div>
  );
}
