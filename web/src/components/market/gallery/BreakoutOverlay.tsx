"use client";

import { useEffect, useRef, useState } from "react";

import { highScore, saveScore } from "./arcadeScores";

/**
 * BREAKOUT — cabinet #3. The bricks are the ACTUAL live listings:
 * GalleryApp passes the visible collections' image URLs and each brick
 * draws one as its face. Smash the floor price, literally. Mouse or
 * arrows to move, space to launch, 3 lives.
 *
 * Note on CORS: drawImage never reads pixels back, so IPFS gateway
 * images can be drawn without crossOrigin — tainting only blocks
 * readback, which we never do.
 */

const W = 520;
const H = 600;
const PADDLE_W = 92;
const PADDLE_H = 12;
const PADDLE_Y = H - 42;
const BALL_R = 7;
const COLS = 6;
const ROWS = 4;
const MARGIN = 12;
const GAP = 6;
const BRICK_W = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
const BRICK_H = 44;
const TOP = 64;
const BASE_SPEED = 300;

type Brick = { x: number; y: number; img: HTMLImageElement | null; hue: number; alive: boolean };

type BState = {
  paddleX: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  stuck: boolean; // ball riding the paddle pre-launch
  bricks: Brick[];
  score: number;
  lives: number;
  level: number;
  dead: boolean;
  keys: { left: boolean; right: boolean };
};

function buildBricks(images: HTMLImageElement[], level: number): Brick[] {
  const bricks: Brick[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = (level * ROWS * COLS + r * COLS + c) % Math.max(images.length, 1);
      bricks.push({
        x: MARGIN + c * (BRICK_W + GAP),
        y: TOP + r * (BRICK_H + GAP),
        img: images[i] ?? null,
        hue: ((r * COLS + c) * 47 + level * 131) % 360,
        alive: true,
      });
    }
  }
  return bricks;
}

function fresh(images: HTMLImageElement[]): BState {
  return {
    paddleX: W / 2,
    ballX: W / 2,
    ballY: PADDLE_Y - BALL_R - 2,
    vx: 0,
    vy: 0,
    stuck: true,
    bricks: buildBricks(images, 0),
    score: 0,
    lives: 3,
    level: 0,
    dead: false,
    keys: { left: false, right: false },
  };
}

export function BreakoutOverlay({
  images,
  onClose,
}: {
  /** Listing image URLs — brick faces. Empty is fine (colored bricks). */
  images: string[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgs = useRef<HTMLImageElement[]>([]);
  const game = useRef<BState | null>(null);
  const [status, setStatus] = useState({ dead: false, score: 0, newRecord: false });
  const [hi, setHi] = useState(() => highScore("breakout"));

  // Load listing images once. No crossOrigin — see module comment.
  useEffect(() => {
    imgs.current = images.slice(0, 48).map((url) => {
      const im = new Image();
      im.src = url;
      return im;
    });
    game.current = fresh(imgs.current);
  }, [images]);

  // Input: mouse steers, arrows steer, space launches / restarts.
  useEffect(() => {
    const canvas = canvasRef.current;
    const onMove = (e: PointerEvent) => {
      const g = game.current;
      const rect = canvas?.getBoundingClientRect();
      if (!g || !rect) return;
      g.paddleX = ((e.clientX - rect.left) / rect.width) * W;
    };
    const launch = () => {
      const g = game.current;
      if (!g) return;
      if (g.dead) {
        game.current = fresh(imgs.current);
        setStatus({ dead: false, score: 0, newRecord: false });
        return;
      }
      if (g.stuck) {
        g.stuck = false;
        const angle = -Math.PI / 3 + Math.random() * (Math.PI / 6);
        const speed = BASE_SPEED * (1 + g.level * 0.12);
        g.vx = Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1);
        g.vy = Math.sin(angle) * speed;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const g = game.current;
      if (!g) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") g.keys.left = e.type === "keydown";
      if (e.code === "ArrowRight" || e.code === "KeyD") g.keys.right = e.type === "keydown";
      if (e.code === "Space" && e.type === "keydown") {
        e.preventDefault();
        launch();
      }
    };
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      launch();
    };
    canvas?.addEventListener("pointermove", onMove);
    canvas?.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      canvas?.removeEventListener("pointermove", onMove);
      canvas?.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
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
      if (!g) {
        raf = requestAnimationFrame(frame);
        return;
      }

      if (!g.dead) {
        // Paddle via keys (mouse sets absolute in the handler).
        const kv = 460 * dt;
        if (g.keys.left) g.paddleX -= kv;
        if (g.keys.right) g.paddleX += kv;
        g.paddleX = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, g.paddleX));

        if (g.stuck) {
          g.ballX = g.paddleX;
          g.ballY = PADDLE_Y - BALL_R - 2;
        } else {
          g.ballX += g.vx * dt;
          g.ballY += g.vy * dt;

          // Walls.
          if (g.ballX < BALL_R) {
            g.ballX = BALL_R;
            g.vx = Math.abs(g.vx);
          }
          if (g.ballX > W - BALL_R) {
            g.ballX = W - BALL_R;
            g.vx = -Math.abs(g.vx);
          }
          if (g.ballY < BALL_R) {
            g.ballY = BALL_R;
            g.vy = Math.abs(g.vy);
          }

          // Paddle — reflect angle by hit offset.
          if (
            g.vy > 0 &&
            g.ballY + BALL_R >= PADDLE_Y &&
            g.ballY + BALL_R <= PADDLE_Y + PADDLE_H + 8 &&
            Math.abs(g.ballX - g.paddleX) <= PADDLE_W / 2 + BALL_R
          ) {
            const off = (g.ballX - g.paddleX) / (PADDLE_W / 2);
            const speed = Math.hypot(g.vx, g.vy);
            const angle = -Math.PI / 2 + off * (Math.PI / 3);
            g.vx = Math.cos(angle) * speed;
            g.vy = Math.sin(angle) * speed;
            g.ballY = PADDLE_Y - BALL_R;
          }

          // Bricks — AABB vs circle, axis-of-least-penetration bounce.
          for (const b of g.bricks) {
            if (!b.alive) continue;
            const cx = Math.max(b.x, Math.min(g.ballX, b.x + BRICK_W));
            const cy = Math.max(b.y, Math.min(g.ballY, b.y + BRICK_H));
            const dx = g.ballX - cx;
            const dy = g.ballY - cy;
            if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
            b.alive = false;
            g.score += 1;
            setStatus((s) => ({ ...s, score: g.score }));
            if (Math.abs(dx) > Math.abs(dy)) g.vx = dx > 0 ? Math.abs(g.vx) : -Math.abs(g.vx);
            else g.vy = dy > 0 ? Math.abs(g.vy) : -Math.abs(g.vy);
            break;
          }

          // Level cleared → fresh wall, faster ball.
          if (g.bricks.every((b) => !b.alive)) {
            g.level += 1;
            g.bricks = buildBricks(imgs.current, g.level);
            g.stuck = true;
          }

          // Floor — lose a life.
          if (g.ballY - BALL_R > H) {
            g.lives -= 1;
            if (g.lives <= 0) {
              g.dead = true;
              const newRecord = saveScore("breakout", g.score);
              setStatus({ dead: true, score: g.score, newRecord });
              setHi(highScore("breakout"));
            } else {
              g.stuck = true;
            }
          }
        }
      }

      draw(canvasRef.current, g);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-[560px] rounded-lg border border-sky-900 bg-zinc-950/95 p-4 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-sm font-bold uppercase tracking-widest text-sky-300">
            BREAKOUT
          </p>
          <p className="font-mono text-xs text-zinc-400">
            score <span className="text-sky-300">{status.score}</span>
            {"  ·  "}hi <span className="text-sky-300">{hi}</span>
          </p>
        </div>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="mt-3 w-full cursor-none rounded border border-zinc-800 bg-black"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            {status.dead
              ? status.newRecord
                ? "new record. the floor thanks you. space — again"
                : "liquidated. space — again"
              : "mouse / arrows — move · space — launch"}
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

function draw(canvas: HTMLCanvasElement | null, g: BState) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#08090d";
  ctx.fillRect(0, 0, W, H);

  // HUD line: lives + level.
  ctx.fillStyle = "#3f3f46";
  ctx.font = "600 20px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`♥ ${g.lives}`, 14, 34);
  ctx.textAlign = "right";
  ctx.fillText(`floor ${g.level + 1}`, W - 14, 34);

  // Bricks — the merchandise.
  for (const b of g.bricks) {
    if (!b.alive) continue;
    if (b.img?.complete && b.img.naturalWidth > 0) {
      // Cover-crop the listing image into the brick.
      const iw = b.img.naturalWidth;
      const ih = b.img.naturalHeight;
      const scale = Math.max(BRICK_W / iw, BRICK_H / ih);
      const sw = BRICK_W / scale;
      const sh = BRICK_H / scale;
      ctx.drawImage(
        b.img,
        (iw - sw) / 2,
        (ih - sh) / 2,
        sw,
        sh,
        b.x,
        b.y,
        BRICK_W,
        BRICK_H,
      );
    } else {
      ctx.fillStyle = `hsl(${b.hue} 45% 26%)`;
      ctx.fillRect(b.x, b.y, BRICK_W, BRICK_H);
    }
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, BRICK_W, BRICK_H);
  }

  // Paddle.
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(g.paddleX - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H);

  // Ball.
  ctx.fillStyle = "#e4e4e7";
  ctx.beginPath();
  ctx.arc(g.ballX, g.ballY, BALL_R, 0, Math.PI * 2);
  ctx.fill();

  if (g.stuck && !g.dead) {
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "700 26px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SPACE / CLICK — SMASH THE FLOOR", W / 2, H / 2 + 60);
  }

  if (g.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f87171";
    ctx.font = "700 54px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("LIQUIDATED", W / 2, H / 2 - 30);
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "600 26px ui-monospace, Menlo, monospace";
    ctx.fillText(
      `${g.score} brick${g.score === 1 ? "" : "s"} of floor smashed`,
      W / 2,
      H / 2 + 24,
    );
  }
}
