"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { countByPolicy, filterByLabel } from "@/lib/market/collectionPalette";
import type { DecodedListing } from "@/lib/market/queryListings";
import {
  supportedCollections,
  type SupportedCollection,
} from "@/lib/market/supportedCollections";

/**
 * Searchable command-palette collection switcher for /market — the sole
 * in-page switcher. Opens via ⌘K / Ctrl+K, `/` (outside text inputs), or
 * the trigger button; typeahead filters by label, arrows move a
 * highlight, Enter selects. Desktop renders a centered palette, mobile a
 * full-screen sheet (`md:` split, same idiom as {@link ../pit/PitPeek} /
 * {@link ../me/HistoryDrawer}).
 *
 * <p>Counts are derived client-side from the `listings` prop (no second
 * fetch) via {@link countByPolicy} — the same grouping
 * {@code CollectionStrip.tsx} uses. Renders "—" per row until `listings`
 * resolves so "zero live listings" isn't confused with "still loading".
 *
 * <p>Self-hides on single-collection networks (mainnet today) via the
 * `collections.length <= 1` guard.
 *
 * <p>`triggerLabel` and `triggerClassName` are optional presentational
 * overrides for the trigger button, letting a mount elsewhere (e.g. the
 * landing hero) swap in its own copy and styling without forking the
 * component.
 */
export function CollectionPalette({
  selected,
  onSelect,
  listings,
  loading,
  triggerLabel,
  triggerClassName,
}: {
  selected: string | null;
  onSelect: (policyId: string) => void;
  listings: DecodedListing[] | null;
  loading: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const collections = supportedCollections();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => countByPolicy(listings), [listings]);
  const rows = useMemo(
    () => filterByLabel(collections, query),
    [collections, query],
  );

  // Reset query + seed the highlight on the row matching the current
  // selection every time the palette opens, so reopening doesn't carry a
  // stale filter or highlight across.
  useEffect(() => {
    if (!open) return;
    // Reset local state to the open transition, not to query/rows changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    const idx = collections.findIndex(
      (c) => c.policyId.toLowerCase() === selected?.toLowerCase(),
    );
    setHighlight(idx >= 0 ? idx : 0);
    inputRef.current?.focus();
  }, [open, collections, selected]);

  // Global opener: ⌘K / Ctrl+K always; `/` only outside text inputs.
  useEffect(() => {
    if (collections.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "/") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable =
          tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
        if (!editable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collections.length]);

  // Body-scroll-lock + Esc-close + arrow/enter navigation while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, rows.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const c = rows[highlight];
        if (c) {
          onSelect(c.policyId);
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, rows, highlight, onSelect]);

  if (collections.length <= 1) return null;

  const selectRow = (c: SupportedCollection) => {
    onSelect(c.policyId);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        }
      >
        <span aria-hidden>⌕</span>
        {triggerLabel ?? "switch collection"}
        <span
          aria-hidden
          className="hidden rounded border border-zinc-700 px-1 py-0.5 text-[10px] normal-case tracking-normal text-zinc-500 md:inline"
        >
          ⌘K
        </span>
      </button>

      {/* Scrim */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => setOpen(false)}
        className={
          "fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm transition-opacity duration-300 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />

      {/* Desktop: centered palette. Mobile: full-screen sheet. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="switch collection"
        className={
          "fixed inset-0 z-50 flex flex-col transform bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out md:inset-x-0 md:top-16 md:bottom-auto md:mx-auto md:h-auto md:max-h-[70vh] md:w-full md:max-w-md md:rounded-lg md:border md:border-zinc-800 " +
          (open
            ? "translate-y-0"
            : "pointer-events-none translate-y-full md:translate-y-0 md:opacity-0")
        }
      >
        <div className="sticky top-0 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            placeholder="filter collections…"
            className="w-full bg-transparent font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {loading ? (
            <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
              resolving listing counts…
            </p>
          ) : null}
        </div>

        <ul className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-zinc-500">
              no collections match &quot;{query}&quot;
            </li>
          ) : (
            rows.map((c, i) => {
              const count =
                listings === null
                  ? "—"
                  : (counts.get(c.policyId.toLowerCase()) ?? 0);
              return (
                <li key={c.policyId}>
                  <button
                    type="button"
                    onClick={() => selectRow(c)}
                    onMouseEnter={() => setHighlight(i)}
                    aria-pressed={i === highlight}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${
                      i === highlight
                        ? "bg-zinc-900 text-zinc-100"
                        : "text-zinc-300"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: c.accentColor ?? "#71717a" }}
                    />
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="font-mono text-xs text-zinc-500">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}
