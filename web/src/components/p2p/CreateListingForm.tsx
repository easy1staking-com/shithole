"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { PoolPicker, PoolSummary } from "@/components/p2p/PoolPicker";
import { useCollection, useCurated } from "@/lib/api/hooks";
import type { Pool } from "@/types/api";

/**
 * The v3 P2P "find another idiot" create-listing flow. Mobile-first single
 * column, three sequential steps that unlock as the user fills them in:
 *
 *   1. Pick which SPO pool to bait (which delegators care about your NFT)
 *   2. Pick the NFT you want to offload from your wallet
 *   3. Set the bounty + confirm the swap math
 *
 * Reads {@code ?collection=<slug>} from the URL. If absent, falls back to a
 * collection picker so users who landed here from the global nav can pick.
 *
 * <p>Steps 2 and 3 are stubbed until the wallet-NFT picker + tx builder
 * land — this commit ships step 1 fully wired so the page is reachable +
 * the chosen pool can be reflected in URL state.
 */
export function CreateListingForm() {
  const params = useSearchParams();
  const collectionSlug = params.get("collection");

  if (!collectionSlug) {
    return <CollectionPickerStep />;
  }
  return <FlowForCollection slug={collectionSlug} />;
}

/* ============================================================ */
/* Stage 0 — collection picker (when no ?collection= present)   */
/* ============================================================ */

function CollectionPickerStep() {
  const { data: curated, isPending, isError, error } = useCurated();
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">first, what kind of s#!t are you offloading?</h2>
      <p className="text-sm text-zinc-400">
        each pit has its own crew of idiots delegated to specific pools. pick
        the collection — we&apos;ll find someone to take it.
      </p>
      {isPending && <p className="text-sm text-zinc-500">stirring the mud…</p>}
      {isError && (
        <p className="text-sm text-red-400" role="alert">
          could not load pits: {error.message}
        </p>
      )}
      {curated && curated.length === 0 && (
        <p className="text-sm text-zinc-500">no pits yet. come back when something dies.</p>
      )}
      {curated && curated.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {curated
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/p2p/new?collection=${encodeURIComponent(c.slug)}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-600"
                >
                  <span className="font-semibold">{c.display_name}</span>
                  <p className="mt-1 font-mono text-xs text-zinc-500">/p2p/new?collection={c.slug}</p>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/* ============================================================ */
/* Stage 1+ — picked a collection, run the 3-step flow          */
/* ============================================================ */

function FlowForCollection({ slug }: { slug: string }) {
  const collection = useCollection(slug);
  const router = useRouter();
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);

  const handleSelectPool = useCallback(
    (pool: Pool) => {
      setSelectedPool(pool);
      // Reflect the selection in the URL so a refresh / share preserves
      // state. Use replace, not push, so the back button still goes
      // somewhere useful.
      const sp = new URLSearchParams();
      sp.set("collection", slug);
      sp.set("pool", pool.ticker);
      router.replace(`/p2p/new?${sp.toString()}`, { scroll: false });
    },
    [router, slug],
  );

  if (collection.isPending) {
    return <p className="text-sm text-zinc-500">looking up the pit…</p>;
  }
  if (collection.isError) {
    return (
      <p className="text-sm text-red-400" role="alert">
        could not load &apos;{slug}&apos;: {collection.error.message}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          find another idiot
        </h1>
        <p className="text-sm text-zinc-400">
          offload your{" "}
          <span className="font-medium text-zinc-200">
            {collection.data.display_name}
          </span>{" "}
          to a delegator who actually wants its traits. you pay them; they
          take it.
        </p>
      </header>

      <Step number={1} title="which pool's idiots?" complete={!!selectedPool}>
        <PoolPicker
          selectedTicker={selectedPool?.ticker ?? null}
          onSelect={handleSelectPool}
        />
        {selectedPool && (
          <div className="flex items-center gap-2 pt-2">
            <span className="text-xs text-zinc-500">picked:</span>
            <PoolSummary pool={selectedPool} />
          </div>
        )}
      </Step>

      <Step
        number={2}
        title="pick the NFT you want to get rid of"
        complete={false}
        disabled={!selectedPool}
      >
        <p className="text-sm text-zinc-500">
          {selectedPool
            ? "wallet picker landing in the next commit — stay tuned."
            : "pick a pool first."}
        </p>
      </Step>

      <Step
        number={3}
        title="how generous are you feeling?"
        complete={false}
        disabled={!selectedPool}
      >
        <p className="text-sm text-zinc-500">
          bounty input landing in the next commit — minimum will be
          protocol_fee + 2 ADA. anything extra is your tip to attract a
          taker.
        </p>
      </Step>
    </div>
  );
}

/* ============================================================ */
/* Step shell                                                   */
/* ============================================================ */

function Step({
  number,
  title,
  children,
  complete,
  disabled,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  complete: boolean;
  disabled?: boolean;
}) {
  return (
    <section
      className={
        "space-y-3 rounded-lg border p-4 transition " +
        (disabled
          ? "border-zinc-900 bg-zinc-950/30 opacity-60"
          : complete
            ? "border-amber-700/60 bg-amber-950/10"
            : "border-zinc-800 bg-zinc-950/40")
      }
      aria-disabled={disabled || undefined}
    >
      <h2 className="flex items-center gap-2 text-base font-medium">
        <span
          className={
            "inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs " +
            (complete
              ? "bg-amber-500 text-zinc-950"
              : disabled
                ? "bg-zinc-800 text-zinc-600"
                : "bg-zinc-800 text-zinc-300")
          }
          aria-hidden
        >
          {complete ? "✓" : number}
        </span>
        <span className={disabled ? "text-zinc-500" : ""}>{title}</span>
      </h2>
      <div>{children}</div>
    </section>
  );
}
