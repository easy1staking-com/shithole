"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

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
  errorMessage,
  depositUnit,
  outcomeUnit,
  confirmation,
  accentColor,
  onDismiss,
  onRetry,
}: {
  status: SwapStatus;
  errorMessage?: string | null;
  /** The NB NFT going in (deposit). */
  depositUnit: string;
  /** The NA NFT that will emerge (already known — bucket-matched off-chain). */
  outcomeUnit: string;
  /** Independent chain-confirmation chip. Shown on the settled phase. */
  confirmation: ConfirmationStatus;
  /** Pit accent color for swirl tinting. */
  accentColor?: string | null;
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
              unit={outcomeUnit}
              accent={accent}
              confirmation={confirmation}
              onDismiss={onDismiss}
              onRetry={onRetry}
            />
          )}
          {phase === "stuck" && (
            <StuckPhase
              key="stuck"
              accent={accent}
              message={errorMessage ?? null}
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
      initial={{ y: -120, scale: 1.1, opacity: 0 }}
      animate={{ y: 80, scale: 0.55, opacity: 1 }}
      exit={{ y: 140, scale: 0.3, opacity: 0 }}
      transition={{ duration: SPLASH_MS / 1000, ease: [0.5, 0, 0.4, 1] }}
      className="flex flex-col items-center gap-3"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name}
          className="h-40 w-40 rounded-xl object-cover shadow-2xl"
          style={{ boxShadow: `0 12px 60px ${accent}cc` }}
        />
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
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-6"
    >
      <motion.div
        className="relative h-40 w-40"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.8, ease: "linear", repeat: Infinity }}
      >
        {/* Three nested rings of fading dots — a cheap swirl with no SVG. */}
        {[0, 1, 2].map((ring) => (
          <div
            key={ring}
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: `inset 0 0 ${30 + ring * 18}px ${ring * 6}px ${accent}${ring === 0 ? "cc" : ring === 1 ? "88" : "55"}`,
              transform: `scale(${1 - ring * 0.18})`,
            }}
            aria-hidden
          />
        ))}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(closest-side, transparent 55%, ${accent}33 60%, transparent 75%)`,
          }}
          aria-hidden
        />
      </motion.div>
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-300">
          swirling…
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {pending
            ? "the pit is digesting your s#!t"
            : "almost…"}
        </p>
      </div>
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name}
          className="h-48 w-48 rounded-xl object-cover shadow-2xl"
          style={{ boxShadow: `0 20px 80px ${accent}aa` }}
        />
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
  unit,
  accent,
  confirmation,
  onDismiss,
  onRetry,
}: {
  unit: string;
  accent: string;
  confirmation: ConfirmationStatus;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const meta = useNftMetadata(unit);
  const image = meta.data?.image_url ?? null;
  const name = meta.data?.name ?? unit.slice(56);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-5"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name}
          className="h-48 w-48 rounded-xl object-cover"
          style={{ boxShadow: `0 16px 60px ${accent}99` }}
        />
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
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md bg-amber-600 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-amber-50 hover:bg-amber-500"
        >
          admire it
        </button>
      )}
    </motion.div>
  );
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
  message,
  onDismiss,
}: {
  accent: string;
  message: string | null;
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
        {message && (
          <p className="mt-2 max-w-xs text-xs text-red-300/80">{message}</p>
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
