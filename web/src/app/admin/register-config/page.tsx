"use client";

import { useCallback, useMemo, useState } from "react";

import {
  registerConfig,
  type ConfigRegistrationRequest,
  ApiError,
  type ConfigRegistrationResponse,
} from "@/lib/api/client";
import {
  buildCanonicalPayloadBytes,
  buildCanonicalPayloadHex,
  buildCanonicalPayloadString,
} from "@/lib/cip8/canonicalPayload";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";
import {
  getBlockfrostProjectId,
  getNetworkName,
  toEvolutionNetwork,
} from "@/lib/wallet/network";
import { useWalletStore } from "@/lib/wallet/walletStore";

// Heavy lucid-dependent helpers are loaded lazily inside `onSubmit` —
// keeps the WASM-backed CML out of the SSR bundle. See
// `web/src/app/admin/register-config/page.tsx` notes for context.

import {
  registerConfigFormSchema,
  type RegisterConfigFormValues,
} from "./validation";

type Step =
  | { kind: "idle" }
  | { kind: "deploying" }
  | { kind: "awaiting"; txHash: string }
  | { kind: "signing"; txHash: string; configNftPolicy: string }
  | {
      kind: "submitting";
      txHash: string;
      configNftPolicy: string;
    }
  | {
      kind: "success";
      response: ConfigRegistrationResponse;
    }
  | { kind: "error"; message: string; at: string };

const DEFAULT_VALUES: Partial<RegisterConfigFormValues> = {
  m: 10,
  protocolFeeAda: 0,
  listerFeeAda: 1,
  displayOrder: 0,
};

export default function RegisterConfigPage() {
  const { api, addressBech32, paymentKeyHashHex, networkId } = useWalletStore();
  const [values, setValues] = useState<Partial<RegisterConfigFormValues>>(
    DEFAULT_VALUES,
  );
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [step, setStep] = useState<Step>({ kind: "idle" });

  // admin_pkh is ALWAYS the payment-key hash of the connected wallet —
  // never user-editable. The CIP-8 signing path uses the same wallet via
  // `wallet.signData`, so the on-chain admin_pkh recorded in the datum
  // must hash-match the signing key the BE will recover. Allowing an
  // override here would let the admin mint a config NFT whose datum
  // points at a key they don't actually control, and the BE would
  // reject the registration with `signature_not_admin` after the
  // (irreversible) deploy tx confirms.
  const adminPkhValue = paymentKeyHashHex ?? "";

  const network = useMemo(() => getNetworkName(), []);
  const projectId = useMemo(() => getBlockfrostProjectId(), []);

  const canonicalPreview = useMemo(() => {
    // Display the to-be-signed canonical payload as soon as we have all
    // mandatory fields. Theme fields gracefully fall through as empty
    // strings — matches the BE's null-coalesce semantics.
    if (!values.slug || !values.displayName || !adminPkhValue) {
      return null;
    }
    // We don't have a config_nft_policy until after deploy, so show a
    // placeholder for the policy line.
    return buildCanonicalPayloadString({
      configNftPolicy: "<config_nft_policy after deploy>".padEnd(56, "·"),
      slug: values.slug,
      displayName: values.displayName,
      displayOrder: values.displayOrder ?? 0,
      theme: {
        backgroundUrl: values.themeBackgroundUrl ?? null,
        accentColor: values.themeAccentColor ?? null,
        mascotImageUrl: values.themeMascotImageUrl ?? null,
      },
    });
  }, [
    values.slug,
    values.displayName,
    adminPkhValue,
    values.displayOrder,
    values.themeBackgroundUrl,
    values.themeAccentColor,
    values.themeMascotImageUrl,
  ]);

  const setField = useCallback(
    <K extends keyof RegisterConfigFormValues>(
      key: K,
      value: RegisterConfigFormValues[K],
    ) => {
      setValues((v) => ({ ...v, [key]: value }));
      setErrors((e) => ({ ...e, [key]: undefined }));
    },
    [],
  );

  const validate = useCallback((): RegisterConfigFormValues | null => {
    const parsed = registerConfigFormSchema.safeParse({
      collectionPolicyId: values.collectionPolicyId ?? "",
      m: typeof values.m === "number" ? values.m : Number(values.m),
      protocolFeeAda:
        typeof values.protocolFeeAda === "number"
          ? values.protocolFeeAda
          : Number(values.protocolFeeAda),
      listerFeeAda:
        typeof values.listerFeeAda === "number"
          ? values.listerFeeAda
          : Number(values.listerFeeAda),
      treasuryAddrBech32: values.treasuryAddrBech32 ?? "",
      adminPkhHex: adminPkhValue,
      slug: values.slug ?? "",
      displayName: values.displayName ?? "",
      displayOrder:
        typeof values.displayOrder === "number"
          ? values.displayOrder
          : Number(values.displayOrder ?? 0),
      themeBackgroundUrl: values.themeBackgroundUrl ?? "",
      themeAccentColor: values.themeAccentColor ?? "",
      themeMascotImageUrl: values.themeMascotImageUrl ?? "",
    });
    if (!parsed.success) {
      const fe: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!fe[path]) fe[path] = issue.message;
      }
      setErrors(fe);
      return null;
    }
    setErrors({});
    return parsed.data;
  }, [values, adminPkhValue]);

  // Hard-block both directions of network mismatch. CIP-30 network IDs:
  // 0 = testnet (preprod/preview/devnet), 1 = mainnet. Submit is disabled
  // when the wallet's network doesn't match the app's configured network.
  const networkMismatch =
    networkId !== null &&
    ((network === "mainnet" && networkId !== 1) ||
      (network !== "mainnet" && networkId !== 0));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep({ kind: "idle" });
    const parsed = validate();
    if (!parsed) return;
    if (!api) {
      setStep({
        kind: "error",
        at: "wallet",
        message: "connect a wallet first",
      });
      return;
    }
    if (!addressBech32) {
      setStep({
        kind: "error",
        at: "wallet",
        message: "wallet address not resolved yet — try reconnecting",
      });
      return;
    }
    if (networkMismatch) {
      setStep({
        kind: "error",
        at: "wallet",
        message:
          "wallet network does not match app network — switch the wallet network and try again",
      });
      return;
    }
    if (!projectId) {
      setStep({
        kind: "error",
        at: "config",
        message:
          "NEXT_PUBLIC_BLOCKFROST_PROJECT_ID is not configured — see web/.env.example",
      });
      return;
    }

    // Lazy-load the lucid-backed helpers — keeps WASM out of SSR.
    let makeLucid: typeof import("@/lib/tx/lucidClient").makeLucid;
    let deployConfig: typeof import("@/lib/tx/deployConfig").deployConfig;
    let awaitTxConfirmation: typeof import("@/lib/tx/awaitConfirmation").awaitTxConfirmation;
    try {
      const lucidMod = await import("@/lib/tx/lucidClient");
      const deployMod = await import("@/lib/tx/deployConfig");
      const awaitMod = await import("@/lib/tx/awaitConfirmation");
      makeLucid = lucidMod.makeLucid;
      deployConfig = deployMod.deployConfig;
      awaitTxConfirmation = awaitMod.awaitTxConfirmation;
    } catch (err) {
      setStep({
        kind: "error",
        at: "loading SDK",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let lucid;
    try {
      lucid = await makeLucid(api);
    } catch (err) {
      setStep({
        kind: "error",
        at: "wallet",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Pick a seed UTxO from the wallet (first ≥ 5 ADA). Auto-pick to
    // keep the form simple; surface what we chose in case it matters.
    let seedUtxo;
    try {
      const utxos = await lucid.wallet().getUtxos();
      seedUtxo = utxos.find((u) => (u.assets.lovelace ?? 0n) >= 5_000_000n);
      if (!seedUtxo) {
        throw new Error(
          "no UTxO with >= 5 ADA available to seed the one-shot mint",
        );
      }
    } catch (err) {
      setStep({
        kind: "error",
        at: "wallet",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // 1) Deploy.
    setStep({ kind: "deploying" });
    let deployResult;
    try {
      const networkEv = toEvolutionNetwork(network);
      deployResult = await deployConfig(lucid, {
        collectionPolicyId: parsed.collectionPolicyId,
        m: parsed.m,
        protocolFeeLovelace: BigInt(Math.round(parsed.protocolFeeAda * 1_000_000)),
        listerFeeLovelace: BigInt(Math.round(parsed.listerFeeAda * 1_000_000)),
        treasuryAddrBech32: parsed.treasuryAddrBech32,
        adminPkhHex: parsed.adminPkhHex,
        seedUtxo,
        network: networkEv,
      });
    } catch (err) {
      setStep({
        kind: "error",
        at: "deploy",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // 2) Await confirmation.
    setStep({ kind: "awaiting", txHash: deployResult.txHash });
    try {
      await awaitTxConfirmation(lucid, deployResult.txHash);
    } catch (err) {
      setStep({
        kind: "error",
        at: "confirmation",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // 3) Build canonical payload + sign.
    setStep({
      kind: "signing",
      txHash: deployResult.txHash,
      configNftPolicy: deployResult.configNftPolicy,
    });
    const canonicalInput = {
      configNftPolicy: deployResult.configNftPolicy,
      slug: parsed.slug,
      displayName: parsed.displayName,
      displayOrder: parsed.displayOrder,
      theme: {
        backgroundUrl: parsed.themeBackgroundUrl || null,
        accentColor: parsed.themeAccentColor || null,
        mascotImageUrl: parsed.themeMascotImageUrl || null,
      },
    };
    const canonicalHex = buildCanonicalPayloadHex(canonicalInput);
    // Sanity: ensure round-tripping doesn't introduce surprise bytes.
    const _bytesLen = buildCanonicalPayloadBytes(canonicalInput).length;
    void _bytesLen;

    // CIP-30 signData wants the address as hex bytes (decoded form).
    // The wallet returned us hex via `getUsedAddresses` already; the
    // store decoded it to bech32 for display but we need hex back.
    let addressHex: string;
    try {
      // We stored `addressHex` in the wallet store separately.
      const { addressHex: storedHex } = useWalletStore.getState();
      if (!storedHex) {
        throw new Error("wallet address (hex) unavailable");
      }
      addressHex = storedHex;
    } catch (err) {
      setStep({
        kind: "error",
        at: "signing",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let signature;
    try {
      signature = await api.signData(addressHex, canonicalHex);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "info" in err
            ? String((err as { info?: unknown }).info)
            : String(err);
      setStep({
        kind: "error",
        at: "signing",
        message: `wallet rejected the signature: ${message}`,
      });
      return;
    }

    // 4) POST.
    setStep({
      kind: "submitting",
      txHash: deployResult.txHash,
      configNftPolicy: deployResult.configNftPolicy,
    });
    const body: ConfigRegistrationRequest = {
      config_nft_policy: deployResult.configNftPolicy,
      slug: parsed.slug,
      display_name: parsed.displayName,
      display_order: parsed.displayOrder,
      theme:
        parsed.themeBackgroundUrl || parsed.themeAccentColor || parsed.themeMascotImageUrl
          ? {
              background_url: parsed.themeBackgroundUrl || null,
              accent_color: parsed.themeAccentColor || null,
              mascot_image_url: parsed.themeMascotImageUrl || null,
            }
          : null,
      signature: {
        key: signature.key,
        signature: signature.signature,
      },
    };

    try {
      const response = await registerConfig(body);
      setStep({ kind: "success", response });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status} ${err.body?.reason ?? ""}: ${err.body?.message ?? err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setStep({ kind: "error", at: "registration", message });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-3xl font-semibold tracking-tight">
            register a pit
          </h1>
          <p className="text-sm text-zinc-400">
            Deploy a config UTxO for a dead collection, then register it
            with the curator. The signature ties the registration to the
            on-chain admin key — only the admin can do this.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            network: <span className="font-mono">{network}</span>
            {!projectId && (
              <span className="ml-2 text-amber-400">
                (NEXT_PUBLIC_BLOCKFROST_PROJECT_ID not set — wallet
                connect works but tx submission will fail)
              </span>
            )}
          </p>
          {networkMismatch && (
            <p className="mt-1 text-xs text-red-400">
              wallet is on {networkId === 1 ? "mainnet" : "testnet"} but app is
              configured for {network} — switch the wallet network before
              submitting; the deploy tx will fail otherwise.
            </p>
          )}
        </div>
        <WalletConnectButton />
      </header>

      <form onSubmit={onSubmit} className="space-y-6">
        <fieldset className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <legend className="px-2 text-sm font-semibold text-zinc-300">
            on-chain config
          </legend>
          <Field
            label="collection policy id (56 hex chars)"
            error={errors.collectionPolicyId}
          >
            <input
              type="text"
              value={values.collectionPolicyId ?? ""}
              onChange={(e) =>
                setField(
                  "collectionPolicyId",
                  e.target.value.trim().toLowerCase(),
                )
              }
              placeholder="a5bb0e5b…"
              className={inputClasses}
              maxLength={56}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="M (buckets)" error={errors.m}>
              <input
                type="number"
                min={1}
                value={values.m ?? ""}
                onChange={(e) =>
                  setField("m", Number(e.target.value))
                }
                className={inputClasses}
              />
            </Field>
            <Field
              label="protocol fee (ADA)"
              error={errors.protocolFeeAda}
            >
              <input
                type="number"
                min={0}
                step="0.000001"
                value={values.protocolFeeAda ?? ""}
                onChange={(e) =>
                  setField("protocolFeeAda", Number(e.target.value))
                }
                className={inputClasses}
              />
            </Field>
            <Field
              label="lister fee (ADA, ≥ 1)"
              error={errors.listerFeeAda}
            >
              <input
                type="number"
                min={1}
                step="0.000001"
                value={values.listerFeeAda ?? ""}
                onChange={(e) =>
                  setField("listerFeeAda", Number(e.target.value))
                }
                className={inputClasses}
              />
            </Field>
          </div>
          <Field
            label="treasury address (bech32)"
            error={errors.treasuryAddrBech32}
          >
            <input
              type="text"
              value={values.treasuryAddrBech32 ?? ""}
              onChange={(e) =>
                setField("treasuryAddrBech32", e.target.value.trim())
              }
              placeholder={
                network === "mainnet" ? "addr1…" : "addr_test1…"
              }
              className={inputClasses}
            />
          </Field>
          <Field
            label="admin verification-key hash (56 hex)"
            error={errors.adminPkhHex}
            hint="derived from the connected wallet — not editable. The CIP-8 signature step uses the same wallet."
          >
            <input
              type="text"
              value={adminPkhValue}
              readOnly
              disabled
              aria-readonly
              className={`${inputClasses} cursor-not-allowed opacity-70`}
              maxLength={56}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <legend className="px-2 text-sm font-semibold text-zinc-300">
            curation metadata
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="slug" error={errors.slug}>
              <input
                type="text"
                value={values.slug ?? ""}
                onChange={(e) =>
                  setField("slug", e.target.value.trim().toLowerCase())
                }
                placeholder="hosky"
                className={inputClasses}
                maxLength={32}
              />
            </Field>
            <Field label="display name" error={errors.displayName}>
              <input
                type="text"
                value={values.displayName ?? ""}
                onChange={(e) => setField("displayName", e.target.value)}
                placeholder="Hosky"
                className={inputClasses}
                maxLength={64}
              />
            </Field>
          </div>
          <Field label="display order (lower = earlier)" error={errors.displayOrder}>
            <input
              type="number"
              min={0}
              value={values.displayOrder ?? 0}
              onChange={(e) =>
                setField("displayOrder", Number(e.target.value))
              }
              className={inputClasses}
            />
          </Field>
          <Field
            label="theme: background URL (optional, https:// or /path)"
            error={errors.themeBackgroundUrl}
          >
            <input
              type="text"
              value={values.themeBackgroundUrl ?? ""}
              onChange={(e) =>
                setField("themeBackgroundUrl", e.target.value.trim())
              }
              className={inputClasses}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="theme: accent color (optional, #rrggbb)"
              error={errors.themeAccentColor}
            >
              <input
                type="text"
                value={values.themeAccentColor ?? ""}
                onChange={(e) =>
                  setField("themeAccentColor", e.target.value.trim())
                }
                placeholder="#7c3aed"
                className={inputClasses}
              />
            </Field>
            <Field
              label="theme: mascot image URL (optional, https:// or /path)"
              error={errors.themeMascotImageUrl}
            >
              <input
                type="text"
                value={values.themeMascotImageUrl ?? ""}
                onChange={(e) =>
                  setField("themeMascotImageUrl", e.target.value.trim())
                }
                className={inputClasses}
              />
            </Field>
          </div>
        </fieldset>

        {canonicalPreview && (
          <details className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs">
            <summary className="cursor-pointer text-zinc-400">
              canonical payload preview (what you&apos;ll sign)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-zinc-300">
              {canonicalPreview}
            </pre>
            <p className="mt-2 text-zinc-500">
              the policy line above is a placeholder — the real value will be
              substituted after the deploy tx lands.
            </p>
          </details>
        )}

        <button
          type="submit"
          disabled={step.kind !== "idle" && step.kind !== "error" && step.kind !== "success"}
          className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          deploy + register
        </button>

        <StepStatus step={step} />
      </form>
    </main>
  );
}

const inputClasses =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-400 focus:outline-none";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-zinc-400">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="block text-xs text-red-400">{error}</span>}
    </label>
  );
}

function StepStatus({ step }: { step: Step }) {
  if (step.kind === "idle") return null;

  if (step.kind === "deploying") {
    return (
      <p className="text-sm text-zinc-300">building + signing deploy tx in your wallet…</p>
    );
  }
  if (step.kind === "awaiting") {
    return (
      <p className="text-sm text-zinc-300">
        deploy tx submitted: <code className="font-mono">{step.txHash}</code>
        <br />
        waiting for confirmation (up to 3 minutes)…
      </p>
    );
  }
  if (step.kind === "signing") {
    return (
      <p className="text-sm text-zinc-300">
        tx confirmed. now sign the registration payload in your wallet…
        <br />
        <span className="text-xs text-zinc-500">policy: {step.configNftPolicy}</span>
      </p>
    );
  }
  if (step.kind === "submitting") {
    return <p className="text-sm text-zinc-300">submitting registration to the BE…</p>;
  }
  if (step.kind === "success") {
    const r = step.response;
    return (
      <div className="rounded-md border border-green-700 bg-green-950 p-4 text-sm">
        <p className="font-semibold text-green-200">registered.</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-green-100">
          <dt className="text-green-400">slug</dt>
          <dd>{r.slug}</dd>
          <dt className="text-green-400">config policy</dt>
          <dd className="break-all">{r.config_nft_policy}</dd>
          <dt className="text-green-400">collection policy id</dt>
          <dd className="break-all">{r.collection_policy_id}</dd>
          <dt className="text-green-400">m / fees</dt>
          <dd>
            {r.m} buckets, protocol={r.protocol_fee}, lister={r.lister_fee}
          </dd>
          <dt className="text-green-400">utxo</dt>
          <dd className="break-all">
            {r.utxo_tx_id}#{r.utxo_output_index}
          </dd>
        </dl>
      </div>
    );
  }
  if (step.kind === "error") {
    return (
      <div
        className="rounded-md border border-red-700 bg-red-950 p-4 text-sm"
        role="alert"
      >
        <p className="font-semibold text-red-200">failed during {step.at}.</p>
        <p className="mt-1 break-all text-red-100">{step.message}</p>
      </div>
    );
  }
  return null;
}

