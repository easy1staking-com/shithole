"use client";

import {
  supportedCollections,
  type SupportedCollection,
} from "@/lib/market/supportedCollections";

/**
 * Collection filter tabs for /market — "all" plus one pill per whitelisted
 * collection, each with its accent dot. Selection is a policy id (null =
 * all) so it plugs straight into the browse filter and the activity/stats
 * endpoints (which accept raw policy ids).
 */
export function CollectionTabs({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (policyId: string | null) => void;
}) {
  const collections = supportedCollections();
  if (collections.length <= 1) return null;

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Tab
        label="all"
        active={selected === null}
        onClick={() => onSelect(null)}
      />
      {collections.map((c) => (
        <Tab
          key={c.policyId}
          label={c.label}
          accent={c.accentColor}
          active={selected?.toLowerCase() === c.policyId.toLowerCase()}
          onClick={() => onSelect(c.policyId)}
        />
      ))}
    </div>
  );
}

function Tab({
  label,
  accent,
  active,
  onClick,
}: {
  label: string;
  accent?: SupportedCollection["accentColor"];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-none items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
        active
          ? "border-zinc-500 bg-zinc-900 text-zinc-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      {accent ? (
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ background: accent, opacity: active ? 1 : 0.6 }}
        />
      ) : null}
      {label}
    </button>
  );
}
