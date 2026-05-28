"use client";

import { listPools, type Pool } from "@/lib/market/poolTraits";
import {
  supportedPriceTokens,
  type SupportedPriceToken,
} from "@/lib/market/supportedPriceTokens";

/**
 * Top-of-page filter bar for /market: currency, stake pool, price sort.
 * Sort is intentionally disabled when "all" currencies are visible —
 * comparing 10 HOSKY against 10 USDM has no meaning.
 */
export type SortOrder = "none" | "asc" | "desc";

export type FilterState = {
  /**
   * Empty string = ALL (no filter); {@link ADA_PRICE_UNIT_SENTINEL} = ADA
   * only (matches listings whose pricePolicy+priceName are both empty hex);
   * any other value is a literal price-token unit hex.
   *
   * <p>Why ADA needs its own sentinel: in the supportedPriceTokens registry
   * ADA's {@code unit} is the empty string (since ADA has no policy/name).
   * Without a dedicated sentinel it collides with "no filter" and silently
   * widens the result set.
   */
  priceUnit: string;
  /** Empty string = no pool filter; otherwise the pool ticker. */
  poolTicker: string;
  /** Price sort. Disabled (forced to "none") when priceUnit is empty. */
  sort: SortOrder;
};

export const ALL_PRICE_UNIT_SENTINEL = "__all__";
export const ADA_PRICE_UNIT_SENTINEL = "__ada__";

export function FilterBar({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const priceTokens = supportedPriceTokens();
  const pools: Pool[] = listPools();

  const singleCurrency = filters.priceUnit !== "";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <Field label="currency">
        <select
          value={filters.priceUnit || ALL_PRICE_UNIT_SENTINEL}
          onChange={(e) => {
            const v = e.target.value;
            const next = v === ALL_PRICE_UNIT_SENTINEL ? "" : v;
            onChange({
              ...filters,
              priceUnit: next,
              // Sort across currencies is meaningless; reset it when
              // the user goes back to "all".
              sort: next === "" ? "none" : filters.sort,
            });
          }}
          className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
        >
          <option value={ALL_PRICE_UNIT_SENTINEL}>all currencies</option>
          {priceTokens.map((t) => (
            <option
              key={t.unit || "ada"}
              value={t.unit || ADA_PRICE_UNIT_SENTINEL}
            >
              {labelOf(t)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="stake pool">
        <select
          value={filters.poolTicker}
          onChange={(e) =>
            onChange({ ...filters, poolTicker: e.target.value })
          }
          className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-sky-700 focus:outline-none"
        >
          <option value="">any pool</option>
          {pools.map((p) => (
            <option key={p.ticker} value={p.ticker}>
              {p.ticker} ({p.traits.length} traits)
            </option>
          ))}
        </select>
      </Field>

      <Field label="sort">
        <div
          className={`inline-flex overflow-hidden rounded border ${
            singleCurrency ? "border-zinc-800" : "border-zinc-900 opacity-50"
          }`}
        >
          <SortChip
            active={filters.sort === "asc"}
            disabled={!singleCurrency}
            onClick={() =>
              onChange({
                ...filters,
                sort: filters.sort === "asc" ? "none" : "asc",
              })
            }
          >
            price ↑
          </SortChip>
          <SortChip
            active={filters.sort === "desc"}
            disabled={!singleCurrency}
            onClick={() =>
              onChange({
                ...filters,
                sort: filters.sort === "desc" ? "none" : "desc",
              })
            }
          >
            price ↓
          </SortChip>
        </div>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function SortChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-2 text-xs ${
        active
          ? "bg-sky-900/60 text-sky-200"
          : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
      } disabled:cursor-not-allowed disabled:bg-zinc-950 disabled:text-zinc-600`}
    >
      {children}
    </button>
  );
}

function labelOf(t: SupportedPriceToken): string {
  return t.label;
}
