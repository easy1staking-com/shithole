"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { NftImage } from "@/components/NftImage";
import { PoolChips } from "@/components/PoolChips";
import { useAssetPoolMembership, useNftMetadata } from "@/lib/api/hooks";
import type { Listing } from "@/types/api";

/**
 * "What's in the pit" browse — a side-drawer (desktop) / bottom-sheet
 * (mobile) overlay that shows every NFT currently locked in the pool,
 * with a pool-ticker filter chip row.
 *
 * <p>Browse-only by design — the pit's swap output is deterministic per
 * input UTxO (see {@link ../../../SPEC.md} §randomness), so the user
 * can't pick. The peek view is meant to inform "is this pool worth
 * tossing into" rather than "which one do I want."
 *
 * <p>Listings come pre-loaded from the parent page's
 * {@link useListings} fetch (capped at the page size — typically 50);
 * we don't refetch here. If the pool grows past that cap, bump the
 * caller's fetch size or add pagination to this view.
 */
export function PitPeek({
  open,
  onClose,
  listings,
  totalInPool,
  accentColor,
}: {
  open: boolean;
  onClose: () => void;
  listings: Listing[];
  /** Server-reported total; may exceed {@code listings.length} if paginated. */
  totalInPool: number;
  accentColor?: string | null;
}) {
  const accent = accentColor ?? "#b87333";
  const [filter, setFilter] = useState<string | null>(null);

  // Reset the filter every time the drawer reopens so the user starts
  // from an unfiltered view — closing + re-opening shouldn't carry
  // stale picks across.
  useEffect(() => {
    if (open) setFilter(null);
  }, [open]);

  // Esc closes — desktop niceness, harmless on touch.
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Batched pool-membership lookup — one API hit per drawer open instead
  // of per-card metadata fetches just for chip rendering.
  const assetNamesHex = useMemo(
    () => listings.map((l) => l.current_nft_unit.slice(56)),
    [listings],
  );
  const membership = useAssetPoolMembership(assetNamesHex, {
    enabled: open && assetNamesHex.length > 0,
  });

  // Tickers actually represented in this pit (sorted alphabetically).
  // Drives the filter chip row — no point offering a chip that filters
  // to an empty grid.
  const availableTickers = useMemo(() => {
    if (!membership.data) return [] as string[];
    const set = new Set<string>();
    for (const tickers of Object.values(membership.data)) {
      for (const t of tickers) set.add(t);
    }
    return Array.from(set).sort();
  }, [membership.data]);

  // Apply the active filter.
  const visible = useMemo(() => {
    if (!filter) return listings;
    if (!membership.data) return [];
    return listings.filter((l) => {
      const name = l.current_nft_unit.slice(56);
      return (membership.data?.[name] ?? []).includes(filter);
    });
  }, [filter, listings, membership.data]);

  return (
    <>
      {/* Scrim — same look as HistoryDrawer for visual consistency. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm transition-opacity duration-300 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />

      {/* Desktop: side panel anchored right. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="what's in the pit"
        className={
          "fixed right-0 top-0 z-50 hidden h-dvh w-full max-w-md transform border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out md:flex md:flex-col " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <PeekContents
          accent={accent}
          totalInPool={totalInPool}
          listingsCount={listings.length}
          filter={filter}
          setFilter={setFilter}
          availableTickers={availableTickers}
          visible={visible}
          membership={membership.data ?? {}}
          loading={membership.isLoading}
          onClose={onClose}
          closeBtnRef={closeBtnRef}
        />
      </aside>

      {/* Mobile: bottom sheet — taller than HistoryDrawer's because the
       *  grid benefits from vertical real estate. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="what's in the pit"
        className={
          "fixed inset-x-0 bottom-0 z-50 h-[88dvh] transform rounded-t-xl border-t border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out md:hidden " +
          (open ? "translate-y-0" : "translate-y-full")
        }
      >
        <PeekContents
          accent={accent}
          totalInPool={totalInPool}
          listingsCount={listings.length}
          filter={filter}
          setFilter={setFilter}
          availableTickers={availableTickers}
          visible={visible}
          membership={membership.data ?? {}}
          loading={membership.isLoading}
          onClose={onClose}
          closeBtnRef={closeBtnRef}
        />
      </aside>
    </>
  );
}

function PeekContents({
  accent,
  totalInPool,
  listingsCount,
  filter,
  setFilter,
  availableTickers,
  visible,
  membership,
  loading,
  onClose,
  closeBtnRef,
}: {
  accent: string;
  totalInPool: number;
  listingsCount: number;
  filter: string | null;
  setFilter: (t: string | null) => void;
  availableTickers: string[];
  visible: Listing[];
  membership: Record<string, string[]>;
  loading: boolean;
  onClose: () => void;
  closeBtnRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const showingPartialSample = listingsCount < totalInPool;
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-100">
            what&apos;s in the pit
          </h2>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            {listingsCount} of {totalInPool}{" "}
            {totalInPool === 1 ? "piece" : "pieces"} lurking
            {showingPartialSample ? " · partial sample" : ""}
          </p>
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          aria-label="close"
        >
          close
        </button>
      </header>

      {/* Filter chips */}
      {availableTickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-800/60 px-4 py-2">
          <FilterChip active={filter === null} onClick={() => setFilter(null)}>
            all
          </FilterChip>
          {availableTickers.map((t) => (
            <FilterChip
              key={t}
              active={filter === t}
              accent={accent}
              onClick={() => setFilter(filter === t ? null : t)}
            >
              {t}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="text-center text-xs text-zinc-500">
            sniffing the muck…
          </p>
        )}
        {!loading && visible.length === 0 && (
          <p className="text-center text-xs text-zinc-500">
            {filter ? "nothing here matches that filter" : "the pit is dry"}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((l) => (
            <PeekCard
              key={l.utxo_ref.tx_id + l.utxo_ref.output_index}
              listing={l}
              tickers={membership[l.current_nft_unit.slice(56)] ?? []}
              accent={accent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wider transition-colors"
      style={{
        backgroundColor: active ? (accent ?? "#b87333") : "transparent",
        color: active ? "#0a0a0a" : "#a1a1aa",
        borderColor: active ? (accent ?? "#b87333") : "#3f3f46",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function PeekCard({
  listing,
  tickers,
  accent,
}: {
  listing: Listing;
  tickers: string[];
  accent: string;
}) {
  const meta = useNftMetadata(listing.current_nft_unit);
  const name = meta.data?.name ?? prettyAssetName(listing.current_nft_unit);
  return (
    <div
      className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900"
      title={name}
    >
      <div className="aspect-square bg-zinc-950">
        <NftImage
          ipfsUri={meta.data?.image_ipfs_uri ?? null}
          url={meta.data?.image_url ?? null}
          alt={name}
          className="h-full w-full object-cover"
          fallback={
            <div
              className="grid h-full w-full place-items-center text-[0.6rem]"
              style={{ color: accent }}
            >
              …
            </div>
          }
        />
      </div>
      <div className="space-y-1 px-2 py-1.5">
        <p className="truncate text-[0.7rem] text-zinc-300">{name}</p>
        <PoolChips tickers={tickers} maxVisible={3} />
      </div>
    </div>
  );
}

function prettyAssetName(unit: string): string {
  const nameHex = unit.slice(56);
  if (!nameHex) return "(no name)";
  try {
    const bytes = new Uint8Array(
      nameHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    let s = "";
    for (const b of bytes) {
      if (b < 0x20 || b > 0x7e) return nameHex.slice(0, 12) + "…";
      s += String.fromCharCode(b);
    }
    return s;
  } catch {
    return nameHex.slice(0, 12) + "…";
  }
}
