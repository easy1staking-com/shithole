"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ErrorView } from "@/components/ErrorView";
import { submitDelegation } from "@/lib/tx/delegate";
import type { Cip30Api } from "@/lib/wallet/cip30";
import {
  DELEGATION_QUERY_KEY,
  devPoolAlias,
  leverTargetPoolId,
  type DelegationInfo,
} from "@/lib/wallet/useDelegation";
import { getNetworkName } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * The "you pulled a lever" confirmation sheet. Cost summary up front
 * (fee + one-time key deposit when the stake key is unregistered),
 * then build/sign/submit without ever leaving the gallery.
 */
export function DelegationPanel({
  ticker,
  walletApi,
  delegation,
  onClose,
}: {
  ticker: string;
  walletApi: Cip30Api;
  delegation: DelegationInfo | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<
    | { kind: "confirm" }
    | { kind: "submitting" }
    | { kind: "done"; txHash: string }
    | { kind: "error"; error: unknown }
  >({ kind: "confirm" });

  const targetPoolId = leverTargetPoolId(ticker);
  const needsRegistration = !(delegation?.registered ?? false);
  const currentLabel = delegation?.rugPool
    ? delegation.rugPool.ticker
    : delegation?.poolId
    ? `${delegation.poolId.slice(0, 14)}…`
    : "none (undelegated)";
  // Off mainnet the rug pools don't exist — the tx can only work when
  // the dev alias points this ticker at a local (preprod) pool.
  const offMainnetUnmapped =
    getNetworkName() !== "mainnet" &&
    devPoolAlias()?.ticker !== ticker.toUpperCase();

  const pull = async () => {
    if (!targetPoolId) return;
    setPhase({ kind: "submitting" });
    try {
      const { txHash } = await submitDelegation({
        walletApi,
        poolIdBech32: targetPoolId,
        needsRegistration,
      });
      setPhase({ kind: "done", txHash });
      // Lever position + zombie mood re-derive once the query refreshes.
      queryClient.invalidateQueries({ queryKey: [DELEGATION_QUERY_KEY] });
    } catch (error) {
      setPhase({ kind: "error", error });
    }
  };

  return (
    <Sheet onClose={phase.kind === "submitting" ? undefined : onClose}>
      <p className="font-mono text-sm font-bold uppercase tracking-widest text-amber-300">
        pull the {ticker} lever
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        re-delegates your entire stake to the {ticker} rug pool. your ADA
        never leaves your wallet — delegation is a pointer, not a
        transfer. rewards arrive as the worthless doggo coin, $HOSKY.
      </p>

      <dl className="mt-3 space-y-1.5 rounded border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
        <Row k="current pool" v={currentLabel} />
        <Row k="new pool" v={`${ticker} (${targetPoolId ? `${targetPoolId.slice(0, 14)}…` : "?"})`} />
        <Row k="network fee" v="~0.17 ₳" />
        {needsRegistration ? (
          <Row k="stake-key deposit" v="2 ₳ (one-time, refundable)" />
        ) : null}
      </dl>

      {offMainnetUnmapped ? (
        <p className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] text-amber-300">
          heads up: {ticker} only exists on mainnet. on{" "}
          {getNetworkName()} this tx will fail unless
          NEXT_PUBLIC_DEV_POOL_ALIAS maps a local pool to {ticker}.
        </p>
      ) : null}

      {phase.kind === "error" ? (
        <div className="mt-2">
          <ErrorView error={phase.error} context={{ subject: "delegation" }} />
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/30 p-3 text-xs text-emerald-200">
          <p className="font-semibold">the lever is down. welcome aboard.</p>
          <p className="mt-1 break-all font-mono text-[10px] text-emerald-300/70">
            tx {phase.txHash}
          </p>
          <p className="mt-1 text-emerald-300/80">
            takes effect after the current epoch boundary — the zombie
            will start thanking you shortly.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        {phase.kind === "done" ? (
          <Btn onClick={onClose} primary>
            back to the dump
          </Btn>
        ) : (
          <>
            <Btn onClick={onClose} disabled={phase.kind === "submitting"}>
              never mind
            </Btn>
            <Btn
              onClick={pull}
              primary
              disabled={phase.kind === "submitting" || !targetPoolId}
            >
              {phase.kind === "submitting"
                ? "check your wallet…"
                : "pull the lever"}
            </Btn>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Minimal in-gallery wallet connect — the zombie's demand. */
export function ConnectSheet({ onClose }: { onClose: () => void }) {
  const list = useWalletStore((s) => s.list);
  const connect = useWalletStore((s) => s.connect);
  const connecting = useWalletStore((s) => s.connecting);
  const error = useWalletStore((s) => s.error);
  const api = useWalletStore((s) => s.api);

  // Connected → the zombie got what it wanted.
  useEffect(() => {
    if (api) onClose();
  }, [api, onClose]);

  const wallets = list();

  return (
    <Sheet onClose={onClose}>
      <p className="font-mono text-sm font-bold uppercase tracking-widest text-amber-300">
        the zombie demands a wallet
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        connect so it can sniff your stake and judge your delegation.
      </p>
      {wallets.length === 0 ? (
        <p className="mt-3 text-xs text-amber-300">
          no CIP-30 wallet found in this browser (Eternl / Vespr / Lace…).
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {wallets.map((w) => (
            <Btn
              key={w.name}
              onClick={() => connect(w.name)}
              disabled={connecting}
              primary
            >
              {connecting ? "connecting…" : `connect ${w.name}`}
            </Btn>
          ))}
        </div>
      )}
      {error ? (
        <div className="mt-2">
          <ErrorView error={error} context={{ subject: "wallet" }} />
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Btn onClick={onClose}>flee</Btn>
      </div>
    </Sheet>
  );
}

function Sheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl">
        {children}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="absolute right-6 top-6 hidden"
          />
        ) : null}
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 font-mono text-xs uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
          : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="uppercase tracking-wider text-zinc-500">{k}</dt>
      <dd className="text-right font-mono text-zinc-200">{v}</dd>
    </div>
  );
}
