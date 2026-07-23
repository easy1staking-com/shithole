"use client";

import { useEffect, useRef, useState } from "react";

import { highScore, saveScore } from "./arcadeScores";

/**
 * FLAPPY HOSKY — cabinet #2. The doggo flaps through gaps between red
 * candlestick charts. Space / click / W to flap; speed and gap tighten
 * as you survive. Physics runs on a delta-timed rAF loop (feel > grid).
 */

const W = 520;
const H = 600;
const GROUND_H = 64;
const BIRD_X = 130;
const BIRD_R = 16;
const GRAVITY = 1500;
const FLAP_VY = -430;
const PIPE_W = 74;
const BASE_SPEED = 165;
const BASE_GAP = 168;
const SPAWN_EVERY = 1.45;

type Pipe = { x: number; gapY: number; gapH: number; passed: boolean };

// The official HOSKY Token logo (Cardano token registry, vendored at
// public/arcade/). Loaded once per module; the hand-drawn doggo below
// stays as the fallback until it arrives.
let hoskyLogo: HTMLImageElement | null = null;
function ensureLogo() {
  if (!hoskyLogo && typeof window !== "undefined") {
    hoskyLogo = new Image();
    hoskyLogo.src = "/arcade/hosky-logo.png";
  }
}

type FState = {
  y: number;
  vy: number;
  pipes: Pipe[];
  score: number;
  started: boolean;
  dead: boolean;
  sinceSpawn: number;
  time: number;
};

function fresh(): FState {
  return {
    y: H / 2.4,
    vy: 0,
    pipes: [],
    score: 0,
    started: false,
    dead: false,
    sinceSpawn: SPAWN_EVERY, // first candle appears promptly
    time: 0,
  };
}

export function FlappyOverlay({ onClose }: { onClose: () => void }) {
  ensureLogo();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const game = useRef<FState>(fresh());
  const [status, setStatus] = useState({ dead: false, score: 0, newRecord: false });
  const [hi, setHi] = useState(() => highScore("flappy"));

  // Flap / restart input.
  useEffect(() => {
    const act = () => {
      const g = game.current;
      if (g.dead) {
        game.current = fresh();
        setStatus({ dead: false, score: 0, newRecord: false });
        return;
      }
      g.started = true;
      g.vy = FLAP_VY;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        act();
      }
    };
    const canvas = canvasRef.current;
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      act();
    };
    window.addEventListener("keydown", onKey);
    canvas?.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      canvas?.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  // Delta-timed rAF loop.
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.033);
      prev = now;
      const g = game.current;

      if (g.started && !g.dead) {
        g.time += dt;
        const speed = BASE_SPEED + g.time * 6;

        g.vy += GRAVITY * dt;
        g.y += g.vy * dt;
        if (g.y < BIRD_R) {
          g.y = BIRD_R;
          g.vy = 0;
        }

        g.sinceSpawn += dt;
        if (g.sinceSpawn >= SPAWN_EVERY) {
          g.sinceSpawn = 0;
          const gapH = Math.max(126, BASE_GAP - g.score * 1.5);
          const gapY = 70 + Math.random() * (H - GROUND_H - gapH - 140);
          g.pipes.push({ x: W + PIPE_W, gapY, gapH, passed: false });
        }
        for (const p of g.pipes) p.x -= speed * dt;
        g.pipes = g.pipes.filter((p) => p.x > -PIPE_W - 30);

        // Scoring + collisions.
        for (const p of g.pipes) {
          if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
            p.passed = true;
            g.score += 1;
            setStatus((s) => ({ ...s, score: g.score }));
          }
          const withinX =
            BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
          if (
            withinX &&
            (g.y - BIRD_R < p.gapY || g.y + BIRD_R > p.gapY + p.gapH)
          ) {
            g.dead = true;
          }
        }
        if (g.y + BIRD_R >= H - GROUND_H) {
          g.y = H - GROUND_H - BIRD_R;
          g.dead = true;
        }
        if (g.dead) {
          const newRecord = saveScore("flappy", g.score);
          setStatus({ dead: true, score: g.score, newRecord });
          setHi(highScore("flappy"));
        }
      } else if (!g.started) {
        // Attract bob.
        g.time += dt;
        g.y = H / 2.4 + Math.sin(g.time * 3) * 8;
      }

      draw(canvasRef.current, g);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-[560px] rounded-lg border border-amber-900 bg-zinc-950/95 p-4 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-sm font-bold uppercase tracking-widest text-amber-300">
            FLAPPY HOSKY
          </p>
          <p className="font-mono text-xs text-zinc-400">
            score <span className="text-amber-300">{status.score}</span>
            {"  ·  "}hi <span className="text-amber-300">{hi}</span>
          </p>
        </div>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="mt-3 w-full cursor-pointer rounded border border-zinc-800 bg-black"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            {status.dead
              ? status.newRecord
                ? "new record. still worth nothing. flap — again"
                : "rugged. flap — again"
              : "space / click / W — flap"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            walk away
          </button>
        </div>
      </div>
    </div>
  );
}

function draw(canvas: HTMLCanvasElement | null, g: FState) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;

  // Night sky.
  ctx.fillStyle = "#0a0c12";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let i = 0; i < 24; i++) {
    // Deterministic star field (no per-frame shimmer).
    const sx = ((i * 97) % W) + ((i * 31) % 13);
    const sy = ((i * 61) % (H - GROUND_H - 60)) + 20;
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Candles (pipes): red bodies + wicks through the gap edges.
  for (const p of g.pipes) {
    ctx.fillStyle = "#a51d24";
    ctx.strokeStyle = "#5f1115";
    ctx.lineWidth = 3;
    // Top candle body.
    ctx.fillRect(p.x, -4, PIPE_W, p.gapY + 4);
    ctx.strokeRect(p.x, -4, PIPE_W, p.gapY + 4);
    // Bottom candle body.
    const by = p.gapY + p.gapH;
    ctx.fillRect(p.x, by, PIPE_W, H - GROUND_H - by);
    ctx.strokeRect(p.x, by, PIPE_W, H - GROUND_H - by);
    // Wicks poking into the gap.
    ctx.strokeStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.moveTo(p.x + PIPE_W / 2, p.gapY);
    ctx.lineTo(p.x + PIPE_W / 2, p.gapY + 16);
    ctx.moveTo(p.x + PIPE_W / 2, by);
    ctx.lineTo(p.x + PIPE_W / 2, by - 16);
    ctx.stroke();
  }

  // Ground — scrolling hazard stripes.
  ctx.fillStyle = "#15151a";
  ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
  ctx.strokeStyle = "#26262e";
  ctx.lineWidth = 10;
  const shift = (g.time * 165) % 36;
  for (let x = -40; x < W + 40; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x - shift, H);
    ctx.lineTo(x - shift + 22, H - GROUND_H);
    ctx.stroke();
  }

  // The doggo — official logo when loaded, hand-drawn fallback.
  ctx.save();
  ctx.translate(BIRD_X, g.y);
  ctx.rotate(Math.max(-0.45, Math.min(1.0, g.vy / 620)));
  if (hoskyLogo?.complete && hoskyLogo.naturalWidth > 0) {
    // Circle-clip: the registry PNG is square with a solid background.
    const r = BIRD_R + 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(hoskyLogo, -r, -r, r * 2, r * 2);
  } else {
    // ears
    ctx.fillStyle = "#d97706";
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(-16, -24);
    ctx.lineTo(-2, -14);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10, -10);
    ctx.lineTo(16, -24);
    ctx.lineTo(2, -14);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    // snout
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.ellipse(5, 5, 8, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // nose + eye
    ctx.fillStyle = "#1c1917";
    ctx.beginPath();
    ctx.arc(9, 3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(1, -5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (!g.started) {
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "700 30px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("FLAP TO START", W / 2, H / 2 + 90);
  }

  if (g.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f87171";
    ctx.font = "700 58px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("RUGGED", W / 2, H / 2 - 34);
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "600 26px ui-monospace, Menlo, monospace";
    ctx.fillText(
      `${g.score} candle${g.score === 1 ? "" : "s"} survived`,
      W / 2,
      H / 2 + 22,
    );
  }
}
