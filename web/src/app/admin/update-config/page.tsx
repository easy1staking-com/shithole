"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ErrorView } from "@/components/ErrorView";
import { Notice } from "@/components/Notice";
import { fetchCollection, fetchCurated } from "@/lib/api/client";
import { awaitTxConfirmation } from "@/lib/tx/awaitConfirmation";
import { makeClient } from "@/lib/tx/evolutionClient";
import { submitConfigUpdate } from "@/lib/tx/updateConfig";
import { getNetworkName, toEvolutionNetwork } from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";
import type { CollectionState, CuratedCollection } from "@/types/api";

/**
 * Hidden admin page — mutate an existing on-chain config (SPEC §5.2).
 * Not linked from the public nav; reachable only via the direct URL.
 *
 * <p>Spends the config UTxO and recreates it at the same script address
 * with updated `m / protocol_fee / lister_fee / treasury_addr`.
 * The connected wallet must be the current admin (its payment-key hash
 * must equal `cfg.admin_pkh` on chain) — the validator's C1 check
 * enforces this and a wrong signer would just make the tx fail.
 *
 * <p>Admin rotation is deliberately NOT supported in this flow because
 * it requires both the old AND new admin to sign the same tx, which a
 * single CIP-30 session can't satisfy.
 */
type Step =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "awaiting"; txHash: string }
  | { kind: "success"; txHash: string }
  // Caught failure → ErrorView (friendly Notice for known, debug box otherwise).
  | { kind: "error"; error: unknown }
  // Local pre-flight validation → warning Notice.
  | { kind: "invalid"; message: string };

type FormValues = {
  m: number;
  protocolFeeAda: number;
  listerFeeAda: number;
  treasuryAddrBech32: string;
};

export default function UpdateConfigPage() {
  const { api, paymentKeyHashHex } = useWalletStore();
  const networkName = getNetworkName();

  const curated = useQuery<CuratedCollection[], Error>({
    queryKey: ["curated"],
    queryFn: fetchCurated,
    staleTime: 60_000,
  });

  const [slug, setSlug] = useState<string>("");

  const collection = useQuery<CollectionState, Error>({
    queryKey: ["collection", slug],
    queryFn: () => fetchCollection(slug),
    enabled: !!slug,
    staleTime: 30_000,
  });

  const [values, setValues] = useState<FormValues | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });

  // When the BE returns the current config, pre-fill the form so the
  // admin only needs to edit the fields they care about. setState-in-
  // effect is the right pattern: the form is editable (uncontrolled-
  // then-controlled), and we seed it once from the async query result.
  useEffect(() => {
    if (!collection.data) return;
    const c = collection.data.config;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({
      m: c.m,
      protocolFeeAda: c.protocol_fee / 1_000_000,
      listerFeeAda: c.lister_fee / 1_000_000,
      treasuryAddrBech32: addressViewToBech32(collection.data),
    });
  }, [collection.data]);

  const isAdmin = useMemo(() => {
    if (!collection.data || !paymentKeyHashHex) return null;
    return (
      paymentKeyHashHex.toLowerCase() ===
      collection.data.config.admin_pkh.toLowerCase()
    );
  }, [collection.data, paymentKeyHashHex]);

  const handleSubmit = useCallback(async () => {
    if (!api) {
      setStep({ kind: "invalid", message: "connect a wallet first" });
      return;
    }
    if (!collection.data || !values) {
      setStep({ kind: "invalid", message: "no collection selected" });
      return;
    }
    if (isAdmin === false) {
      setStep({
        kind: "invalid",
        message:
          "connected wallet is not the admin for this collection — the tx would fail on-chain",
      });
      return;
    }
    setStep({ kind: "building" });
    try {
      const client = await makeClient(api);
      const result = await submitConfigUpdate(client, networkName, {
        configNftPolicyHex: collection.data.config_nft_policy,
        collectionPolicyIdHex: collection.data.collection_policy_id,
        network: toEvolutionNetwork(networkName),
        currentAdminPkhHex: collection.data.config.admin_pkh,
        newDatum: {
          m: values.m,
          protocolFeeLovelace: BigInt(
            Math.round(values.protocolFeeAda * 1_000_000),
          ),
          listerFeeLovelace: BigInt(
            Math.round(values.listerFeeAda * 1_000_000),
          ),
          treasuryAddrBech32: values.treasuryAddrBech32,
          adminPkhHex: collection.data.config.admin_pkh,
        },
      });
      setStep({ kind: "awaiting", txHash: result.txHash });
      await awaitTxConfirmation(client, result.txHash);
      setStep({ kind: "success", txHash: result.txHash });
    } catch (err) {
      setStep({ kind: "error", error: err });
    }
  }, [api, collection.data, values, networkName, isAdmin]);

  const running = step.kind === "building" || step.kind === "awaiting";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-mono text-2xl font-semibold text-zinc-100">
          update config
        </h1>
        <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">
          admin · {networkName} · hidden
        </p>
      </header>

      <section className="space-y-2">
        <label className="block text-xs uppercase tracking-widest text-zinc-500">
          collection
        </label>
        <select
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setStep({ kind: "idle" });
            setValues(null);
          }}
          disabled={curated.isLoading || running}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">— pick a pit —</option>
          {(curated.data ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.display_name} ({c.slug})
            </option>
          ))}
        </select>
        {curated.error && (
          <ErrorView error={curated.error} context={{ subject: "collections" }} />
        )}
      </section>

      {collection.isLoading && slug && (
        <p className="text-sm text-zinc-500">loading current config…</p>
      )}
      {collection.error && (
        <ErrorView error={collection.error} context={{ subject: "collection" }} />
      )}

      {collection.data && values && (
        <>
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-400">
            <p>
              <span className="text-zinc-500">config_nft_policy:</span>{" "}
              <span className="font-mono text-zinc-300">
                {collection.data.config_nft_policy}
              </span>
            </p>
            <p>
              <span className="text-zinc-500">collection_policy_id:</span>{" "}
              <span className="font-mono text-zinc-300">
                {collection.data.collection_policy_id}
              </span>
            </p>
            <p>
              <span className="text-zinc-500">current admin_pkh:</span>{" "}
              <span className="font-mono text-zinc-300">
                {collection.data.config.admin_pkh}
              </span>
            </p>
            {isAdmin === false && (
              <p className="mt-2 rounded border border-red-900/40 bg-red-950/30 px-2 py-1 text-red-300">
                connected wallet ({paymentKeyHashHex?.slice(0, 12)}…) is NOT
                the admin for this collection — the tx will fail on chain.
              </p>
            )}
            {isAdmin === true && (
              <p className="mt-2 rounded border border-emerald-900/40 bg-emerald-950/30 px-2 py-1 text-emerald-300">
                connected wallet matches the on-chain admin_pkh. ready.
              </p>
            )}
          </section>

          <section className="grid grid-cols-2 gap-4">
            <Field label="M (buckets)">
              <input
                type="number"
                min={1}
                value={values.m}
                onChange={(e) =>
                  setValues({ ...values, m: Number(e.target.value) })
                }
                disabled={running}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100"
              />
            </Field>
            <Field label="protocol fee (ADA)">
              <input
                type="number"
                min={0}
                step={0.1}
                value={values.protocolFeeAda}
                onChange={(e) =>
                  setValues({
                    ...values,
                    protocolFeeAda: Number(e.target.value),
                  })
                }
                disabled={running}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100"
              />
              <p className="mt-1 text-[0.65rem] text-zinc-500">
                set to 0 to enable the v2 zero-fee Swap path
              </p>
            </Field>
            <Field label="lister fee (ADA)">
              <input
                type="number"
                min={1}
                step={0.1}
                value={values.listerFeeAda}
                onChange={(e) =>
                  setValues({
                    ...values,
                    listerFeeAda: Number(e.target.value),
                  })
                }
                disabled={running}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100"
              />
              <p className="mt-1 text-[0.65rem] text-zinc-500">
                floor: 1 ADA (MIN_LISTER_FEE)
              </p>
            </Field>
            <Field label="treasury (bech32)" wide>
              <input
                type="text"
                value={values.treasuryAddrBech32}
                onChange={(e) =>
                  setValues({
                    ...values,
                    treasuryAddrBech32: e.target.value.trim(),
                  })
                }
                disabled={running}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
                spellCheck={false}
              />
            </Field>
          </section>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={running || !api || isAdmin === false}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "submitting…" : "submit update"}
          </button>

          {step.kind === "awaiting" && (
            <p className="text-sm text-zinc-400">
              tx submitted: <span className="font-mono">{step.txHash}</span> ·
              awaiting confirmation…
            </p>
          )}
          {step.kind === "success" && (
            <p className="rounded-md border border-emerald-900/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
              ✓ confirmed. tx hash:{" "}
              <span className="font-mono">{step.txHash}</span>
            </p>
          )}
          {step.kind === "invalid" && (
            <Notice severity="warning">{step.message}</Notice>
          )}
          {step.kind === "error" && (
            <ErrorView
              error={step.error}
              context={{ action: "updated", subject: "config" }}
            />
          )}
        </>
      )}
    </main>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : "col-span-1"}>
      <label className="block text-[0.65rem] uppercase tracking-widest text-zinc-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Re-serialize an {@link AddressView} (decomposed credentials) back to its
 * bech32 form. The BE returns the decomposed form because the on-chain
 * datum carries credentials directly; the FE update tx wants a bech32
 * string for {@link decomposeAddress} to round-trip cleanly.
 */
function addressViewToBech32(c: CollectionState): string {
  // The BE doesn't currently expose the bech32 form on the collection
  // envelope (just the credentials), so we reconstruct it via Evolution
  // SDK's address builders. Lazy require to keep WASM out of SSR.
  // For the v1 UX, the admin sees the addr they previously set and can
  // edit it; round-tripping a raw credential pair back into bech32 is
  // network-dependent and we want to be explicit here.
  // TODO: when the BE adds treasury_addr_bech32 to ConfigDatumView,
  // swap this for a direct field read.
  return reconstructBech32(c);
}

function reconstructBech32(c: CollectionState): string {
  // Lazy require() to keep Evolution's Address machinery out of the
  // SSR bundle for routes that don't render this admin page. A dynamic
  // import would be async; this helper is called synchronously from
  // multiple places, so require() is the pragmatic choice.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ev = require("@evolution-sdk/evolution") as {
    Address: typeof import("@evolution-sdk/evolution").Address;
    Credential: typeof import("@evolution-sdk/evolution").Credential;
    Bytes: typeof import("@evolution-sdk/evolution").Bytes;
  };
  const treasury = c.config.treasury_addr;
  const pay = treasury.payment_credential;
  const stake = treasury.stake_credential ?? null;
  const networkId = getNetworkName() === "mainnet" ? 1 : 0;
  const payCred =
    pay.type === "verification_key"
      ? ev.Credential.makeKeyHash(ev.Bytes.fromHex(pay.hash))
      : ev.Credential.makeScriptHash(ev.Bytes.fromHex(pay.hash));
  const stakeCred = stake
    ? stake.type === "verification_key"
      ? ev.Credential.makeKeyHash(ev.Bytes.fromHex(stake.hash))
      : ev.Credential.makeScriptHash(ev.Bytes.fromHex(stake.hash))
    : undefined;
  const addr = new ev.Address.Address({
    networkId,
    paymentCredential: payCred,
    stakingCredential: stakeCred,
  });
  return ev.Address.toBech32(addr);
}
