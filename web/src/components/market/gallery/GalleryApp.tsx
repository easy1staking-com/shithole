"use client";

import { Canvas } from "@react-three/fiber";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorView } from "@/components/ErrorView";
import { buildCandidates } from "@/components/NftImage";
import { fetchNftMetadata } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/hooks";
import { listPools, matchesPool } from "@/lib/market/poolTraits";
import {
  formatPriceQty,
  prettyAssetName,
  resolvePriceLabel,
  truncate,
} from "@/lib/market/priceDisplay";
import type { DecodedListing } from "@/lib/market/queryListings";
import { isSupportedCollection } from "@/lib/market/supportedCollections";
import { supportedPriceTokens } from "@/lib/market/supportedPriceTokens";
import { useDerivedMarketplaceManifest } from "@/lib/market/useDerivedMarketplaceManifest";
import { useMarketListings } from "@/lib/market/useMarketListings";

import { GalleryScene } from "./GalleryScene";
import { useAmbientAudio } from "./useAmbientAudio";
import {
  EYE,
  GALLERY_NAME,
  buildRoomModel,
  galleryCollections,
  groupByPolicy,
  type DoorSpec,
  type GalleryEntry,
  type RoomRef,
} from "./rooms";

/**
 * "the dump" — first-person 3D browse over the same live marketplace
 * data as /market. Desktop-first (pointer lock + WASD); every frame
 * deep-links into the existing 2D listing/buy flow, so no transaction
 * code lives here.
 */
export function GalleryApp() {
  const router = useRouter();
  const { data: manifest } = useDerivedMarketplaceManifest();
  const { listings, loading, error: err } = useMarketListings();

  // Whitelisted listings only — same rule as MarketBrowse.
  const whitelisted = useMemo<DecodedListing[]>(() => {
    if (!listings) return [];
    return listings.filter((l) => {
      const u = l.listedUnits[0];
      return Boolean(u && isSupportedCollection(u));
    });
  }, [listings]);

  // Metadata for pool assignment, names and image candidates. Shares
  // queryKeys.nft with the 2D surfaces, so nothing is fetched twice.
  const metaQueries = useQueries({
    queries: whitelisted.map((l) => {
      const unit = l.listedUnits[0] ?? "";
      return {
        queryKey: queryKeys.nft(unit),
        queryFn: () => fetchNftMetadata(unit),
        enabled: Boolean(unit),
        staleTime: 60_000,
      };
    }),
  });

  const entries = useMemo<GalleryEntry[]>(() => {
    const priceTokens = supportedPriceTokens();
    const pools = listPools();
    return whitelisted.map((l, i) => {
      const meta = metaQueries[i]?.data;
      const unit = l.listedUnits[0] ?? "";
      const price = resolvePriceLabel(l, priceTokens);
      const traits = meta?.traits ?? [];
      return {
        key: `${l.utxo.txHash}:${l.utxo.outputIndex}`,
        unit,
        policy: unit.slice(0, 56).toLowerCase(),
        detailHref: `/market/${unit}?utxo=${l.utxo.txHash}.${l.utxo.outputIndex}`,
        name: meta?.name ?? prettyAssetName(unit) ?? truncate(unit, 22),
        priceText: `${formatPriceQty(l.datum.priceQty, price.decimals)} ${price.label}`,
        sub:
          l.listedUnits.length > 1
            ? `bundle · ${l.listedUnits.length}`
            : null,
        poolTickers:
          traits.length === 0
            ? []
            : pools
                .filter((p) => matchesPool(traits, p).length > 0)
                .map((p) => p.ticker),
        metaLoaded: Boolean(meta),
        candidates: meta
          ? buildCandidates(meta.image_ipfs_uri, meta.image_url)
          : [],
        seed: unit,
      };
    });
  }, [whitelisted, metaQueries]);

  const data = useMemo(
    () => ({ collections: galleryCollections(), byPolicy: groupByPolicy(entries) }),
    [entries],
  );

  // --- room state + fade transitions --------------------------------
  const [roomRef, setRoomRef] = useState<RoomRef>({ kind: "hub" });
  const [fading, setFading] = useState(false);
  const fadingRef = useRef(false);
  const model = useMemo(() => buildRoomModel(roomRef, data), [roomRef, data]);

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // Hum + drips start on first lock (a user gesture), pause on unlock.
  useAmbientAudio(locked);

  const enterDoor = useCallback((door: DoorSpec) => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFading(true);
    setFocusedKey(null);
    window.setTimeout(() => {
      setRoomRef(door.target);
      window.setTimeout(() => {
        fadingRef.current = false;
        setFading(false);
      }, 120);
    }, 280);
  }, []);

  // --- open the focused listing (click or E while locked) -----------
  const focusedEntry = useMemo(
    () => model.frames.find((f) => f.entry.key === focusedKey)?.entry ?? null,
    [model, focusedKey],
  );
  const focusedRef = useRef<GalleryEntry | null>(null);
  useEffect(() => {
    focusedRef.current = focusedEntry;
  }, [focusedEntry]);

  useEffect(() => {
    const open = () => {
      const e = focusedRef.current;
      if (!e) return;
      document.exitPointerLock();
      router.push(e.detailHref);
    };
    // pointerLockElement is still null during the click that ACQUIRES
    // the lock (requestPointerLock is async), so entering never buys.
    const onClick = () => {
      if (document.pointerLockElement) open();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === "KeyE" && document.pointerLockElement) open();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  /* ------------------------------------------------------------------ */

  if (!manifest) {
    return (
      <Shell>
        <div className="m-auto max-w-md rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
          <p className="font-medium">marketplace not deployed yet</p>
          <p className="mt-1 text-amber-300/80">
            {GALLERY_NAME} needs the marketplace manifest. head to{" "}
            <Link className="underline" href="/market/dev-tools">
              /market/dev-tools
            </Link>{" "}
            first.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div id="dump-canvas" className="absolute inset-0">
        <Canvas
          dpr={[1, 1.75]}
          camera={{ fov: 72, near: 0.1, far: 80, position: [0, EYE, 0] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
        >
          {/* Key the CONTENTS, not the Canvas: a keyed Canvas creates a
              new WebGL context per room change, and browsers kill the
              oldest context after a handful — the postprocessing pass
              then dies with "Cannot read ... 'alpha'" on a null
              context. One context, remounted scene graph. */}
          <GalleryScene
            key={model.key}
            model={model}
            focusedKey={focusedKey}
            active={!fading}
            onEnterDoor={enterDoor}
            onFocusChange={setFocusedKey}
            onLockChange={setLocked}
          />
        </Canvas>
      </div>

      {/* room title */}
      <div className="pointer-events-none absolute left-4 top-4 max-w-sm">
        <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-zinc-100 drop-shadow">
          {model.title}
        </h1>
        {model.subtitle ? (
          <p className="mt-0.5 text-xs text-zinc-400">{model.subtitle}</p>
        ) : null}
      </div>

      {/* exit to 2D */}
      <div className="absolute right-4 top-4">
        <Link
          href="/market"
          className="rounded border border-zinc-700 bg-zinc-950/80 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          ← 2D market
        </Link>
      </div>

      {/* crosshair */}
      {locked ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-200/80 shadow" />
      ) : null}

      {/* listings fetch state */}
      {loading || listings === null ? (
        <p className="pointer-events-none absolute bottom-4 left-4 font-mono text-xs uppercase tracking-widest text-zinc-500">
          scanning the marketplace…
        </p>
      ) : null}
      {err ? (
        <div className="absolute bottom-4 left-4 max-w-sm">
          <ErrorView error={err} context={{ subject: "listings" }} />
        </div>
      ) : null}

      {/* focused listing card */}
      {locked && focusedEntry ? (
        <div className="pointer-events-none absolute bottom-8 left-1/2 w-full max-w-sm -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950/90 px-4 py-3 text-center shadow-xl">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {focusedEntry.name}
          </p>
          {focusedEntry.poolTickers.length > 0 ? (
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-sky-300">
              {focusedEntry.poolTickers.join(" · ")}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-base text-sky-400">
            {focusedEntry.priceText}
            {focusedEntry.sub ? (
              <span className="ml-2 text-xs text-amber-400">
                {focusedEntry.sub}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            click or E — open listing
          </p>
        </div>
      ) : null}

      {/* controls hint while walking, nothing focused */}
      {locked && !focusedEntry ? (
        <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[11px] uppercase tracking-widest text-zinc-600">
          wasd walk · shift run · walk into a door · esc release mouse
        </p>
      ) : null}

      {/* click-to-enter overlay */}
      {!locked && !fading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/90 px-6 py-5 text-center shadow-xl">
            <p className="font-mono text-lg font-bold uppercase tracking-widest text-amber-300">
              {GALLERY_NAME}
            </p>
            <p className="mt-2 text-sm text-zinc-300">click anywhere to enter</p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
              wasd — walk · mouse — look
              <br />
              walk into doors · click / E — open listing
              <br />
              esc — release mouse
            </p>
          </div>
        </div>
      ) : null}

      {/* room-change fade */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-300 ${
          fading ? "opacity-100" : "opacity-0"
        }`}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-black">
      {children}
    </div>
  );
}
