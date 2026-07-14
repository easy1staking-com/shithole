"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Small navigation dropdown — button + popover with link list. Used in
 * {@link AppHeader} to group related routes under a single top-level
 * label (e.g. "pit ▾ → the pits / your stash").
 *
 * <p>Same click-outside + ESC mechanics as {@link MultiSelectPopover};
 * additionally closes on route change so tapping a menu item dismisses
 * the popover on its way out. Highlights the top-level label when any
 * submenu route is active.
 */
export function NavMenu({
  label,
  items,
}: {
  /** Top-level button label (e.g. "pit", "p2p"). */
  label: string;
  /** Submenu links. Order is preserved. */
  items: Array<{ label: string; href: string }>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const menuId = useId();

  // Close on outside click + ESC. Closing on link-click is handled by
  // an onClick on each <Link> (route-change effect tripped a setState-
  // in-effect lint and is event-driven anyway — see below).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Active when any submenu route matches the current path. Special-
  // case "/" so it doesn't claim every page (every path startsWith "/").
  const isActive = items.some((it) =>
    it.href === "/" ? pathname === "/" : pathname.startsWith(it.href),
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        className={
          "rounded-md px-3 py-1.5 font-mono text-[15px] uppercase tracking-[0.08em] transition-colors " +
          (isActive
            ? "bg-zinc-900 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200")
        }
      >
        {label}
        <span aria-hidden className="ml-0.5 text-zinc-600">
          ▾
        </span>
      </button>
      {open && (
        <ul
          id={menuId}
          className="absolute left-0 z-20 mt-1 min-w-44 rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-lg"
        >
          {items.map((it) => {
            const active =
              it.href === "/"
                ? pathname === "/"
                : pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className={
                    "block rounded px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-zinc-900 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100")
                  }
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
