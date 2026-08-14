"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Shared top nav for every /market page. Desktop (sm+) shows the
 * destination links inline; on phones they collapse behind a hamburger
 * so the row can never exceed the viewport (uppercase + tracking-widest
 * made three inline links overflow small screens).
 *
 * The contextual back link stays visible on both. The current page and
 * the back target are filtered out of the destination list.
 */

const DESTINATIONS: Array<{ href: string; label: string }> = [
  { href: "/market/gallery", label: "walk the dump ⛝" },
  { href: "/market/new", label: "list something →" },
  { href: "/market/me", label: "your listings" },
  { href: "/", label: "home" },
];

export function MarketNav({
  back,
}: {
  back: { href: string; label: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  const items = DESTINATIONS.filter(
    (d) => d.href !== pathname && d.href !== back.href,
  );

  // Close on Escape or any tap outside the nav.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <nav
      ref={navRef}
      className="relative flex items-center justify-between text-xs uppercase tracking-widest text-zinc-500"
    >
      <Link
        href={back.href}
        className="whitespace-nowrap hover:text-zinc-300"
      >
        {back.label}
      </Link>

      {/* desktop: inline links */}
      <span className="hidden items-center gap-4 sm:flex">
        {items.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="whitespace-nowrap hover:text-zinc-300"
          >
            {d.label}
          </Link>
        ))}
      </span>

      {/* mobile: hamburger */}
      <button
        type="button"
        aria-label={open ? "close menu" : "open menu"}
        aria-expanded={open}
        aria-controls="market-nav-menu"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-zinc-800 px-2.5 py-1 font-mono text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 sm:hidden"
      >
        {open ? "✕" : "☰"}
      </button>

      {open ? (
        <div
          id="market-nav-menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-zinc-800 bg-zinc-950/95 py-1 shadow-xl backdrop-blur sm:hidden"
        >
          {items.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {d.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
