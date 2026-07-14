"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  HistoryEmptyState,
  HistoryLoadError,
  HistoryRow,
  HistoryTabStrip,
  useHistoryFeed,
  type HistoryFilter,
} from "@/components/me/historyShared";
import { useWalletStore } from "@/lib/wallet/walletStore";

/**
 * Global wallet-history drawer.
 *
 * <p>Side panel on desktop (slides in from the right), bottom sheet on
 * mobile (slides up). A pull-tab handle pokes out from the edge when
 * closed; click/touch to toggle. The drawer mounts only when a wallet
 * is connected — no point teasing data the BE can't fetch.
 *
 * <p>Feed reuses {@code useHistoryFeed}; the full {@code /me/history}
 * page remains the canonical, shareable view linked from the footer.
 */
export function HistoryDrawer() {
  const paymentKeyHashHex = useWalletStore((s) => s.paymentKeyHashHex);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const { events, loading, errored } = useHistoryFeed(paymentKeyHashHex);

  // Scroll lock + escape close while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Drop focus inside the panel so keyboard users land somewhere sane.
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-close on wallet disconnect so we don't get stuck open with no
  // data + no handle to dismiss us.
  useEffect(() => {
    if (!paymentKeyHashHex) setOpen(false);
  }, [paymentKeyHashHex]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.source === filter);
  }, [events, filter]);

  if (!paymentKeyHashHex) return null;

  return (
    <>
      {/* Pull-tab handle. Two variants — desktop edge tab vs mobile
          bottom tab — toggled by Tailwind's responsive prefix. */}
      <DrawerHandle open={open} onClick={() => setOpen((v) => !v)} />

      {/* Backdrop. Always mounted so the click handler + transition
          fire smoothly; pointer-events-none when closed so it doesn't
          eat clicks. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={
          "fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm transition-opacity duration-300 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />

      {/* Desktop: side panel anchored right. */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="your history"
        className={
          "fixed right-0 top-0 z-50 hidden h-dvh w-full max-w-md transform border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out md:flex md:flex-col " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <DrawerContents
          filter={filter}
          setFilter={setFilter}
          filtered={filtered}
          loading={loading}
          errored={errored}
          onClose={() => setOpen(false)}
          closeBtnRef={closeBtnRef}
        />
      </aside>

      {/* Mobile: bottom sheet. Taller than the typical sheet because
          history rows benefit from vertical space. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="your history"
        className={
          "fixed inset-x-0 bottom-0 z-50 h-[85dvh] transform rounded-t-xl border-t border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out md:hidden " +
          (open ? "translate-y-0" : "translate-y-full")
        }
      >
        <DrawerContents
          filter={filter}
          setFilter={setFilter}
          filtered={filtered}
          loading={loading}
          errored={errored}
          onClose={() => setOpen(false)}
          closeBtnRef={closeBtnRef}
        />
      </aside>
    </>
  );
}

function DrawerHandle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <>
      {/* Desktop: half-circle tab on the right edge, vertically
          centered. Sits on top of the panel when open so the user has
          a click target in both states. */}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        aria-controls="history-drawer"
        aria-label={open ? "close history" : "open history"}
        title={open ? "close history" : "open history"}
        className={
          "fixed top-1/2 z-50 hidden h-16 -translate-y-1/2 transform items-center justify-center rounded-l-full border border-r-0 border-zinc-800 bg-zinc-900/95 px-2 text-zinc-300 backdrop-blur transition-all hover:bg-zinc-800 hover:text-zinc-100 md:flex " +
          // When open, sit on the LEFT edge of the panel so the user
          // can grab it to close. When closed, sit on the viewport edge.
          (open ? "right-[min(28rem,100%)]" : "right-0")
        }
      >
        <span
          aria-hidden
          className={
            "block h-4 w-4 transform text-sm transition-transform " +
            (open ? "rotate-180" : "")
          }
        >
          ‹
        </span>
      </button>

      {/* Mobile: pill tab on the bottom edge, horizontally centered.
          When the sheet is open it tucks onto the sheet's top edge. */}
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        aria-controls="history-drawer"
        aria-label={open ? "close history" : "open history"}
        className={
          "fixed left-1/2 z-50 flex h-7 -translate-x-1/2 transform items-center justify-center gap-1.5 rounded-t-full border border-b-0 border-zinc-800 bg-zinc-900/95 px-4 text-zinc-300 backdrop-blur transition-all hover:bg-zinc-800 hover:text-zinc-100 md:hidden " +
          // env(safe-area-inset-bottom) keeps the handle clear of the
          // iOS home indicator when closed; when open we move to the
          // sheet's top edge (85dvh from the bottom).
          (open
            ? "bottom-[85dvh]"
            : "bottom-[max(0.5rem,env(safe-area-inset-bottom))]")
        }
      >
        <span
          aria-hidden
          className={
            "text-xs transition-transform " + (open ? "rotate-180" : "")
          }
        >
          ˄
        </span>
        <span className="text-[10px] uppercase tracking-widest">history</span>
      </button>
    </>
  );
}

function DrawerContents({
  filter,
  setFilter,
  filtered,
  loading,
  errored,
  onClose,
  closeBtnRef,
}: {
  filter: HistoryFilter;
  setFilter: (f: HistoryFilter) => void;
  filtered: ReturnType<typeof useHistoryFeed>["events"];
  loading: boolean;
  errored: boolean;
  onClose: () => void;
  closeBtnRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div id="history-drawer" className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-zinc-200">
            your history
          </h2>
          <HistoryTabStrip filter={filter} setFilter={setFilter} />
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="close"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <span aria-hidden className="block h-4 w-4 text-base leading-none">
            ✕
          </span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {errored && <HistoryLoadError className="mb-4" />}
        {loading ? (
          <p className="text-sm text-zinc-500">scraping the chain…</p>
        ) : filtered.length === 0 ? (
          <HistoryEmptyState filter={filter} />
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => (
              <HistoryRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-zinc-800 px-5 py-3 text-center text-xs">
        <Link
          href={
            filter === "all"
              ? "/me/history"
              : `/me/history?type=${filter}`
          }
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100"
        >
          see all history →
        </Link>
      </footer>
    </div>
  );
}
