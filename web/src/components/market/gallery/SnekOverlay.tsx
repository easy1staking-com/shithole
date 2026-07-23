"use client";

import { useEffect, useRef, useState } from "react";

import { highScore, saveScore } from "./arcadeScores";

/**
 * SNEK — the arcade's finest. Classic grid snake on a 2D canvas,
 * rendered as an in-gallery overlay (pointer already released when this
 * opens). Eat the worthless coins, speed ramps, walls kill. Arrows or
 * WASD; space restarts after death.
 */

const GRID = 22;
const CANVAS = 528; // 22 × 24px cells
const CELL = CANVAS / GRID;
const START_MS = 130;
const MIN_MS = 62;

type Pt = { x: number; y: number };
type Dir = { x: number; y: number };

type GameState = {
  snake: Pt[];
  dir: Dir;
  /**
   * Buffered turns, applied one per tick. A queue (not a single slot)
   * is what makes rapid two-turn maneuvers land — with one slot the
   * second keypress overwrote the first and inputs felt laggy/eaten.
   */
  queue: Dir[];
  food: Pt;
  score: number;
  dead: boolean;
  tickMs: number;
};

function freshGame(): GameState {
  return {
    snake: [
      { x: 6, y: 11 },
      { x: 5, y: 11 },
      { x: 4, y: 11 },
    ],
    dir: { x: 1, y: 0 },
    queue: [],
    food: { x: 15, y: 11 },
    score: 0,
    dead: false,
    tickMs: START_MS,
  };
}

function placeFood(snake: Pt[]): Pt {
  while (true) {
    const p = {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
    };
    if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p;
  }
}

export function SnekOverlay({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const game = useRef<GameState>(freshGame());
  const [status, setStatus] = useState<{
    dead: boolean;
    score: number;
    newRecord: boolean;
  }>({ dead: false, score: 0, newRecord: false });
  const [hi, setHi] = useState(() => highScore("snek"));

  // Input.
  useEffect(() => {
    const DIRS: Record<string, Dir> = {
      ArrowUp: { x: 0, y: -1 },
      KeyW: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      KeyS: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      KeyA: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      KeyD: { x: 1, y: 0 },
    };
    const onKey = (e: KeyboardEvent) => {
      const g = game.current;
      const d = DIRS[e.code];
      if (d) {
        e.preventDefault();
        // Validate against the LAST queued turn (or current heading):
        // no 180° reversals, no duplicate presses clogging the queue.
        const ref = g.queue[g.queue.length - 1] ?? g.dir;
        const reversal = d.x === -ref.x && d.y === -ref.y;
        const duplicate = d.x === ref.x && d.y === ref.y;
        if (!reversal && !duplicate && g.queue.length < 3) g.queue.push(d);
        return;
      }
      if (e.code === "Space" && g.dead) {
        e.preventDefault();
        game.current = freshGame();
        setStatus({ dead: false, score: 0, newRecord: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Game loop — self-adjusting timeout chain (speed ramps on eat).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const g = game.current;
      if (!g.dead) {
        const turn = g.queue.shift();
        if (turn) g.dir = turn;
        const head = {
          x: g.snake[0].x + g.dir.x,
          y: g.snake[0].y + g.dir.y,
        };
        const hitWall =
          head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
        const hitSelf = g.snake.some((s) => s.x === head.x && s.y === head.y);
        if (hitWall || hitSelf) {
          g.dead = true;
          const newRecord = saveScore("snek", g.score);
          setStatus({ dead: true, score: g.score, newRecord });
          setHi(highScore("snek"));
        } else {
          g.snake.unshift(head);
          if (head.x === g.food.x && head.y === g.food.y) {
            g.score += 1;
            g.tickMs = Math.max(MIN_MS, g.tickMs - 4);
            g.food = placeFood(g.snake);
            setStatus((s) => ({ ...s, score: g.score }));
          } else {
            g.snake.pop();
          }
        }
      }
      draw(canvasRef.current, g);
      timer = setTimeout(tick, g.tickMs);
    };
    timer = setTimeout(tick, START_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-[600px] rounded-lg border border-emerald-900 bg-zinc-950/95 p-4 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-sm font-bold uppercase tracking-widest text-emerald-300">
            SNEK
          </p>
          <p className="font-mono text-xs text-zinc-400">
            score <span className="text-emerald-300">{status.score}</span>
            {"  ·  "}hi <span className="text-emerald-300">{hi}</span>
          </p>
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          className="mt-3 w-full rounded border border-zinc-800 bg-black"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            {status.dead
              ? status.newRecord
                ? "new record. still worth nothing. space — again"
                : "dead. space — again"
              : "arrows / wasd — steer"}
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

function draw(canvas: HTMLCanvasElement | null, g: GameState) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#03110a";
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  // Faint grid.
  ctx.strokeStyle = "rgba(52,211,153,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, CANVAS);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(CANVAS, i * CELL);
    ctx.stroke();
  }

  // The worthless coin.
  const fx = g.food.x * CELL + CELL / 2;
  const fy = g.food.y * CELL + CELL / 2;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(fx, fy, CELL * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#78350f";
  ctx.font = `700 ${Math.round(CELL * 0.5)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", fx, fy + 1);

  // Snek.
  g.snake.forEach((s, i) => {
    const t = i / Math.max(g.snake.length - 1, 1);
    ctx.fillStyle = g.dead
      ? `rgba(120, 60, 60, ${1 - t * 0.5})`
      : `rgba(52, 211, 153, ${1 - t * 0.55})`;
    ctx.fillRect(s.x * CELL + 1.5, s.y * CELL + 1.5, CELL - 3, CELL - 3);
  });
  // Eyes on the head.
  const head = g.snake[0];
  ctx.fillStyle = "#022c22";
  const hx = head.x * CELL;
  const hy = head.y * CELL;
  ctx.fillRect(hx + CELL * 0.25, hy + CELL * 0.25, 3.5, 3.5);
  ctx.fillRect(hx + CELL * 0.6, hy + CELL * 0.25, 3.5, 3.5);

  if (g.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.fillStyle = "#f87171";
    ctx.font = "700 56px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("RUGGED", CANVAS / 2, CANVAS / 2 - 30);
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "600 26px ui-monospace, Menlo, monospace";
    ctx.fillText(
      `${g.score} worthless coin${g.score === 1 ? "" : "s"} eaten`,
      CANVAS / 2,
      CANVAS / 2 + 24,
    );
  }
}
