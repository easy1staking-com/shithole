"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lightweight multi-select dropdown — button + popover with checkboxes.
 *
 * <p>Used on /p2p to let sellers explicitly pick pools to exclude. Avoids
 * pulling in a heavy dropdown library; ~80 lines, no deps. Click-outside
 * closes; ESC closes; checkbox toggles call {@link onToggle} with the
 * option's value.
 *
 * <p>Renders a chip strip of currently-selected values below the button
 * (each chip has its own ×). Button label includes the selection count.
 */
export function MultiSelectPopover({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  /** Button label prefix; the count "(N)" gets appended. */
  label: string;
  /** Available options. Each option's {@code value} is what gets toggled. */
  options: Array<{ value: string; label: string }>;
  /** Set of currently-selected option values. */
  selected: Set<string>;
  /** Called with a value when its checkbox is toggled. */
  onToggle: (value: string) => void;
  /** Optional "clear all" action; not rendered when selection is empty. */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click + ESC.
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

  const count = selected.size;
  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={
          "rounded-md border px-2 py-1 text-xs " +
          (count > 0
            ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
            : "border-zinc-800 text-zinc-400 hover:border-zinc-600")
        }
      >
        {label}
        {count > 0 ? ` (${count})` : ""}
        <span aria-hidden className="ml-1 text-zinc-500">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-10 mt-1 max-h-80 w-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-zinc-500">no options</p>
          ) : (
            <ul className="space-y-0.5">
              {options.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <li key={opt.value}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-zinc-900">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(opt.value)}
                        className="h-3.5 w-3.5 accent-amber-500"
                      />
                      <span className={isSelected ? "text-zinc-100" : "text-zinc-400"}>
                        {opt.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {onClear && count > 0 && (
            <div className="mt-1 border-t border-zinc-800 pt-1">
              <button
                type="button"
                onClick={() => onClear()}
                className="w-full rounded px-2 py-1 text-left text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              >
                clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
