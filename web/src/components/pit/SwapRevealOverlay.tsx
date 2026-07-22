"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { ErrorView } from "@/components/ErrorView";
import { NftImage } from "@/components/NftImage";
import { useNftMetadata } from "@/lib/api/hooks";

/**
 * Splash → swirl → reveal overlay that fires on swap submit. Animation
 * cadence is INDEPENDENT of chain latency (per Giovanni's call: "same
 * UX timing for everyone regardless of chain latency"). Phases:
 *
 * <ol>
 *   <li><b>splash</b> (700ms): NB plops in. Centered card scales down +
 *       falls into the pit.</li>
 *   <li><b>swirl</b> (≥ minimum 1500ms): bubbles / swirl glyph rotates;
 *       holds until both (a) the minimum dwell elapsed AND (b) the
 *       parent's {@code status} flips off "pending".</li>
 *   <li><b>reveal</b> (1200ms): NA emerges from the mud — scales up
 *       from below the pit.</li>
 *   <li><b>settled</b>: NA card sits centered with a "your new shit" tag
 *       + a dismiss button.</li>
 *   <li><b>stuck</b>: only reached if {@code status === "error"}. Replaces
 *       the reveal with a "your shit got stuck in the pipes" overlay.</li>
 * </ol>
 *
 * <p>The parent owns the tx lifecycle and toggles {@code status} from
 * {@code "pending"} → {@code "success"} | {@code "error"}. The component
 * uses {@code AnimatePresence} for the entry/exit transitions.
 */
export type SwapStatus = "pending" | "success" | "error";

/**
 * Independent of the animation phase: a chip shown in the settled phase
 * telling the user whether the chain has confirmed the submitted tx.
 * <ul>
 *   <li>{@code "confirming"} — submit succeeded, awaiting chain inclusion.</li>
 *   <li>{@code "confirmed"} — {@code lucid.awaitTx} resolved true.</li>
 *   <li>{@code "rejected"} — submit succeeded but the tx didn't make it
 *       (reorg / mempool eviction / await timeout). Surfaces a retry hint.</li>
 *   <li>{@code null} — no confirmation lifecycle to show (e.g. before submit).</li>
 * </ul>
 */
export type ConfirmationStatus = "confirming" | "confirmed" | "rejected" | null;

const SPLASH_MS = 700;
const SWIRL_MIN_MS = 1500;
const REVEAL_MS = 1200;

type Phase = "splash" | "swirl" | "reveal" | "settled" | "stuck";

export function SwapRevealOverlay({
  status,
  error,
  depositUnit,
  outcomeUnit,
  confirmation,
  accentColor,
  shareContext,
  onDismiss,
  onRetry,
}: {
  status: SwapStatus;
  error?: unknown;
  /** The NB NFT going in (deposit). */
  depositUnit: string;
  /** The NA NFT that will emerge (already known — bucket-matched off-chain). */
  outcomeUnit: string;
  /** Independent chain-confirmation chip. Shown on the settled phase. */
  confirmation: ConfirmationStatus;
  /** Pit accent color for swirl tinting. */
  accentColor?: string | null;
  /**
   * Context the settled phase needs to construct a share URL. Optional
   * — without it the share button is hidden. The {@code txHash} only
   * appears once submit returns; the URL still works without it, but
   * including it makes the share landing page more informative.
   */
  shareContext?: {
    slug: string;
    displayName: string;
    txHash?: string;
  };
  /** Called when the user clicks "done" or after the auto-dismiss timer. */
  onDismiss: () => void;
  /** Called when the user clicks the chain-rejected retry button. */
  onRetry?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("splash");
  // Stamped when we enter the swirl phase so the resolution effect can
  // enforce a minimum dwell regardless of how fast the chain resolves.
  // A ref (not state) is fine because the timestamp is only read inside
  // a setTimeout — no render needs to react to it.
  const swirlStartRef = useRef<number | null>(null);

  // splash → swirl, reveal → settled. Both transitions are pure timers,
  // so they live in async callbacks (lint accepts setState in timers).
  useEffect(() => {
    if (phase === "splash") {
      const t = window.setTimeout(() => setPhase("swirl"), SPLASH_MS);
      return () => window.clearTimeout(t);
    }
    if (phase === "swirl") {
      swirlStartRef.current = Date.now();
    }
    if (phase === "reveal") {
      const t = window.setTimeout(() => setPhase("settled"), REVEAL_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase]);

  // Swirl resolution: when phase is "swirl" AND status has resolved,
  // honor the minimum swirl dwell from swirl-start, then transition to
  // reveal (success) or stuck (error). The setTimeout callback is async,
  // so the setPhase call here doesn't count as "sync setState in effect".
  useEffect(() => {
    if (phase !== "swirl") return;
    if (status === "pending") return;
    const target: Phase = status === "success" ? "reveal" : "stuck";
    const sinceStart = swirlStartRef.current
      ? Date.now() - swirlStartRef.current
      : 0;
    const remaining = Math.max(0, SWIRL_MIN_MS - sinceStart);
    const t = window.setTimeout(() => setPhase(target), remaining);
    return () => window.clearTimeout(t);
  }, [phase, status]);

  const accent = accentColor ?? "#b87333";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-label="swap in flight"
    >
      <div className="relative flex w-full max-w-md flex-col items-center px-6">
        <AnimatePresence mode="wait">
          {phase === "splash" && (
            <SplashPhase key="splash" unit={depositUnit} accent={accent} />
          )}
          {phase === "swirl" && (
            <SwirlPhase key="swirl" accent={accent} pending={status === "pending"} />
          )}
          {phase === "reveal" && (
            <RevealPhase key="reveal" unit={outcomeUnit} accent={accent} />
          )}
          {phase === "settled" && (
            <SettledPhase
              key="settled"
              depositUnit={depositUnit}
              outcomeUnit={outcomeUnit}
              accent={accent}
              accentColor={accentColor}
              confirmation={confirmation}
              shareContext={shareContext}
              onDismiss={onDismiss}
              onRetry={onRetry}
            />
          )}
          {phase === "stuck" && (
            <StuckPhase
              key="stuck"
              accent={accent}
              error={error ?? null}
              onDismiss={onDismiss}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phases                                                                     */
/* -------------------------------------------------------------------------- */

function SplashPhase({ unit, accent }: { unit: string; accent: string }) {
  const meta = useNftMetadata(unit);
  const image = meta.data?.image_url ?? null;
  const name = meta.data?.name ?? unit.slice(56);
  return (
    <motion.div
      // Spin the card while it falls. 1.5 rotations gives a clear sense
      // of "tossed in" without the image becoming unreadable at any
      // single frame. The exit overshoots to one more half-rotation so
      // the handoff to the swirl phase feels continuous.
      initial={{ y: -120, scale: 1.1, opacity: 0, rotate: -30 }}
      animate={{ y: 80, scale: 0.55, opacity: 1, rotate: 540 }}
      exit={{ y: 140, scale: 0.3, opacity: 0, rotate: 720 }}
      transition={{ duration: SPLASH_MS / 1000, ease: [0.5, 0, 0.4, 1] }}
      className="flex flex-col items-center gap-3"
    >
      {image ? (
        <div
          className="rounded-xl"
          style={{ boxShadow: `0 12px 60px ${accent}cc` }}
        >
          <NftImage
            ipfsUri={meta.data?.image_ipfs_uri ?? null}
            url={image}
            alt={name}
            loading="eager"
            className="h-40 w-40 rounded-xl object-cover"
            fallback={<div className="h-40 w-40 rounded-xl bg-zinc-800" />}
          />
        </div>
      ) : (
        <div className="h-40 w-40 rounded-xl bg-zinc-800" />
      )}
      <p className="text-sm uppercase tracking-widest text-zinc-400">
        plop.
      </p>
    </motion.div>
  );
}

function SwirlPhase({
  accent,
  pending,
}: {
  accent: string;
  pending: boolean;
}) {
  // Offsets for the orbital dots — six dots at varied radii so their
  // overlapping motion reads as turbulent rather than uniform.
  const orbits = [
    { radius: 48, size: 10, speed: 1.4, dir: 1, phase: 0 },
    { radius: 62, size: 6, speed: 2.2, dir: -1, phase: 90 },
    { radius: 36, size: 8, speed: 1.0, dir: 1, phase: 180 },
    { radius: 70, size: 5, speed: 2.8, dir: -1, phase: 45 },
    { radius: 55, size: 7, speed: 1.7, dir: 1, phase: 270 },
    { radius: 42, size: 4, speed: 2.5, dir: -1, phase: 135 },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-6"
    >
      {/* Wobble container — the whole apparatus shifts in a tight
       *  Lissajous so the swirl has off-center drift instead of just
       *  rotating in place. */}
      <motion.div
        className="relative h-40 w-40"
        animate={{
          x: [0, 6, -4, 5, -3, 0],
          y: [0, -3, 5, -2, 4, 0],
        }}
        transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
      >
        {/* Two conic-gradient sweeps — the asymmetric color band is
         *  what actually reads as motion when the element rotates.
         *  Different speeds + opposite directions give a "swirly water"
         *  feel rather than a single spinning loader. */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${accent}aa 60deg, transparent 140deg, ${accent}55 220deg, transparent 320deg)`,
            mask: "radial-gradient(closest-side, transparent 35%, black 50%, black 95%, transparent 100%)",
            WebkitMask:
              "radial-gradient(closest-side, transparent 35%, black 50%, black 95%, transparent 100%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, ease: "linear", repeat: Infinity }}
          aria-hidden
        />
        <motion.div
          className="absolute inset-2 rounded-full"
          style={{
            background: `conic-gradient(from 90deg, transparent 0deg, ${accent}88 80deg, transparent 200deg, ${accent}44 280deg, transparent 360deg)`,
            mask: "radial-gradient(closest-side, transparent 30%, black 45%, black 95%, transparent 100%)",
            WebkitMask:
              "radial-gradient(closest-side, transparent 30%, black 45%, black 95%, transparent 100%)",
          }}
          animate={{ rotate: -360 }}
          transition={{ duration: 2.3, ease: "linear", repeat: Infinity }}
          aria-hidden
        />

        {/* Dark sunken center — gives the swirl a "hole" to be circling
         *  around. Pulses softly so it doesn't feel inert. */}
        <motion.div
          className="absolute inset-[28%] rounded-full"
          style={{
            background: `radial-gradient(closest-side, ${accent}33 0%, rgba(0,0,0,0.85) 60%, rgba(0,0,0,0.95) 100%)`,
          }}
          animate={{ scale: [1, 0.9, 1.05, 0.95, 1] }}
          transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }}
          aria-hidden
        />

        {/* Orbital dots — each one is a tiny dot pinned at a fixed
         *  off-center position, then its parent rotates around the
         *  swirl's center. Different radii + speeds + directions, so
         *  the dots cross each other constantly. */}
        {orbits.map((o, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{ x: -o.size / 2, y: -o.size / 2 }}
            animate={{ rotate: 360 * o.dir }}
            transition={{
              duration: o.speed,
              ease: "linear",
              repeat: Infinity,
              delay: i * 0.05,
            }}
            aria-hidden
          >
            <div
              style={{
                position: "absolute",
                left: o.radius,
                top: 0,
                width: o.size,
                height: o.size,
                borderRadius: "50%",
                backgroundColor: accent,
                boxShadow: `0 0 ${o.size * 1.5}px ${accent}`,
                transform: `rotate(${o.phase}deg)`,
              }}
            />
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        className="text-center"
        animate={{ opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
      >
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-300">
          swirling…
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {pending
            ? "the pit is digesting your s#!t"
            : "almost…"}
        </p>
      </motion.div>
    </motion.div>
  );
}

function RevealPhase({ unit, accent }: { unit: string; accent: string }) {
  const meta = useNftMetadata(unit);
  const image = meta.data?.image_url ?? null;
  const name = meta.data?.name ?? unit.slice(56);
  return (
    <motion.div
      initial={{ y: 140, scale: 0.3, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: REVEAL_MS / 1000, ease: [0.2, 0.7, 0.2, 1] }}
      className="flex flex-col items-center gap-3"
    >
      {image ? (
        <div
          className="rounded-xl"
          style={{ boxShadow: `0 20px 80px ${accent}aa` }}
        >
          <NftImage
            ipfsUri={meta.data?.image_ipfs_uri ?? null}
            url={image}
            alt={name}
            loading="eager"
            className="h-48 w-48 rounded-xl object-cover"
            fallback={<div className="h-48 w-48 rounded-xl bg-zinc-800" />}
          />
        </div>
      ) : (
        <div className="h-48 w-48 rounded-xl bg-zinc-800" />
      )}
      <p className="text-sm uppercase tracking-widest text-zinc-400">
        out comes…
      </p>
      <p className="max-w-xs truncate text-lg font-semibold text-zinc-100">
        {name}
      </p>
    </motion.div>
  );
}

function SettledPhase({
  depositUnit,
  outcomeUnit,
  accent,
  accentColor,
  confirmation,
  shareContext,
  onDismiss,
  onRetry,
}: {
  depositUnit: string;
  outcomeUnit: string;
  accent: string;
  /** Original accentColor prop (might be null) — preserved for the share URL. */
  accentColor?: string | null;
  confirmation: ConfirmationStatus;
  shareContext?: { slug: string; displayName: string; txHash?: string };
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const meta = useNftMetadata(outcomeUnit);
  const depositMeta = useNftMetadata(depositUnit);
  const image = meta.data?.image_url ?? null;
  const name = meta.data?.name ?? outcomeUnit.slice(56);

  const shareUrl = buildShareUrl({
    shareContext,
    accentColor,
    depositUnit,
    outcomeUnit,
    naName: meta.data?.name,
    nbName: depositMeta.data?.name,
    naImg: meta.data?.image_url,
    nbImg: depositMeta.data?.image_url,
  });
  const tweetUrl = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        `i just swapped some worthless s#!t for slightly different worthless s#!t on @Shithole_App`,
      )}&url=${encodeURIComponent(shareUrl)}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-5"
    >
      {image ? (
        <div
          className="rounded-xl"
          style={{ boxShadow: `0 16px 60px ${accent}99` }}
        >
          <NftImage
            ipfsUri={meta.data?.image_ipfs_uri ?? null}
            url={image}
            alt={name}
            loading="eager"
            className="h-48 w-48 rounded-xl object-cover"
            fallback={<div className="h-48 w-48 rounded-xl bg-zinc-800" />}
          />
        </div>
      ) : (
        <div className="h-48 w-48 rounded-xl bg-zinc-800" />
      )}
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          your new s#!t
        </p>
        <p className="mt-1 max-w-xs truncate text-lg font-semibold text-zinc-100">
          {name}
        </p>
      </div>
      <ConfirmationChip confirmation={confirmation} accent={accent} />
      {confirmation === "rejected" && onRetry ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
          >
            close
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-amber-50 hover:bg-amber-500"
          >
            try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {tweetUrl && (
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-5 py-2 text-center text-sm font-semibold uppercase tracking-wide hover:opacity-90"
              style={{ borderColor: accent, color: accent }}
            >
              share the carnage →
            </a>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-amber-600 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-amber-50 hover:bg-amber-500"
          >
            admire it
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Compose the absolute /share/swap URL with all the context the OG
 * card route needs. Returns null when {@code shareContext} is missing
 * (the parent didn't pass one — we hide the share button in that case
 * rather than emit a broken URL).
 */
function buildShareUrl(args: {
  shareContext?: { slug: string; displayName: string; txHash?: string };
  accentColor?: string | null;
  depositUnit: string;
  outcomeUnit: string;
  naName?: string;
  nbName?: string;
  naImg?: string;
  nbImg?: string;
}): string | null {
  const ctx = args.shareContext;
  if (!ctx) return null;
  if (typeof window === "undefined") return null;
  const qs = new URLSearchParams();
  qs.set("slug", ctx.slug);
  qs.set("display_name", ctx.displayName);
  qs.set("nb", args.depositUnit);
  qs.set("na", args.outcomeUnit);
  if (args.nbName) qs.set("nb_name", args.nbName);
  if (args.naName) qs.set("na_name", args.naName);
  // Pre-fill image URLs so the OG route renders without a BE round-trip
  // (the FE already has them resolved from the NFT metadata cache).
  if (args.nbImg) qs.set("nb_img", args.nbImg);
  if (args.naImg) qs.set("na_img", args.naImg);
  if (args.accentColor) {
    qs.set("accent", args.accentColor.replace(/^#/, ""));
  }
  if (ctx.txHash) qs.set("tx", ctx.txHash);
  return `${window.location.origin}/share/swap?${qs.toString()}`;
}

/**
 * Small status chip shown beneath the revealed NA. Splits the chain
 * confirmation from the animation: the reveal happens on consistent
 * timing, the chip honestly reports inclusion state. Keeps the UX
 * smooth while not lying about chain landing.
 */
function ConfirmationChip({
  confirmation,
  accent,
}: {
  confirmation: ConfirmationStatus;
  accent: string;
}) {
  if (confirmation === null) return null;
  if (confirmation === "confirming") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-zinc-900/80 px-3 py-1.5 ring-1 ring-zinc-700">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
          className="h-3 w-3 rounded-full border-2 border-transparent"
          style={{ borderTopColor: accent, borderRightColor: accent }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-zinc-300">
          settling on chain…
        </span>
      </div>
    );
  }
  if (confirmation === "confirmed") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-900/30 px-3 py-1.5 ring-1 ring-emerald-700/60">
        <span className="text-emerald-300" aria-hidden>✓</span>
        <span className="text-xs uppercase tracking-wide text-emerald-200">
          confirmed on chain
        </span>
      </div>
    );
  }
  // rejected
  return (
    <div className="flex items-center gap-2 rounded-full bg-red-900/30 px-3 py-1.5 ring-1 ring-red-700/60">
      <span className="text-red-300" aria-hidden>✗</span>
      <span className="text-xs uppercase tracking-wide text-red-200">
        chain didn&apos;t accept it
      </span>
    </div>
  );
}

function StuckPhase({
  accent,
  error,
  onDismiss,
}: {
  accent: string;
  error: unknown;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-5 text-center"
    >
      <div
        className="grid h-24 w-24 place-items-center rounded-full"
        style={{
          backgroundColor: `${accent}22`,
          boxShadow: `inset 0 0 30px ${accent}66`,
        }}
        aria-hidden
      >
        <span className="text-4xl">⌽</span>
      </div>
      <div>
        <p className="text-lg font-semibold text-zinc-100">
          your s#!t got stuck in the pipes
        </p>
        {error != null && (
          <div className="mx-auto mt-3 w-full max-w-sm text-left">
            <ErrorView error={error} context={{ action: "swapped", subject: "swap" }} />
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          your wallet and the pit are unchanged. try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md border border-zinc-700 px-4 py-2 text-sm uppercase tracking-wide text-zinc-300 hover:border-zinc-500"
      >
        close
      </button>
    </motion.div>
  );
}
