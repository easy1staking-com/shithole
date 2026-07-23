import * as THREE from "three";

/**
 * Canvas-drawn textures for the gallery — museum plaques, neon door
 * lintels, the hub sign. Drawing text on 2D canvases sidesteps webfont
 * loading inside WebGL entirely (no troika/CDN fetch) and gives us the
 * grimy look for free.
 *
 * Every function returns a fresh CanvasTexture the CALLER must dispose.
 */

const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  px: number,
  font: string,
  weight = "600",
): number {
  let size = px;
  do {
    ctx.font = `${weight} ${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  } while (size > 10);
  return size;
}

/** Museum label under each frame: name / pools / price. */
export function plaqueTexture(opts: {
  name: string;
  priceText: string;
  pools: string[];
  sub: string | null;
}): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 256);

  // Card ground — dark, slightly warm, with a worn border.
  ctx.fillStyle = "#131316";
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 500, 244);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // Name.
  ctx.fillStyle = "#f4f4f5";
  fitText(ctx, opts.name, 460, 44, SANS, "700");
  ctx.fillText(opts.name, 256, 62);

  // Pool tickers / sub line.
  const subLine = [
    opts.pools.slice(0, 4).join(" · ") +
      (opts.pools.length > 4 ? ` +${opts.pools.length - 4}` : ""),
    opts.sub ?? "",
  ]
    .filter(Boolean)
    .join("   ");
  if (subLine) {
    ctx.fillStyle = "#7dd3fc";
    fitText(ctx, subLine, 460, 26, MONO, "500");
    ctx.fillText(subLine, 256, 122);
  }

  // Price.
  ctx.fillStyle = "#38bdf8";
  fitText(ctx, opts.priceText, 460, 52, MONO, "700");
  ctx.fillText(opts.priceText, 256, subLine ? 190 : 165);

  return toTexture(c);
}

/** Buzzing neon sign above a door: big label + small sub line. */
export function lintelTexture(opts: {
  label: string;
  sub: string;
  color: string;
}): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 192);

  // Transparent ground — only the glow.
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const label = opts.label.toUpperCase();
  ctx.shadowColor = opts.color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = opts.color;
  // Width budget leaves room for the glow bleed at both ends.
  fitText(ctx, label, 430, 74, MONO, "700");
  ctx.fillText(label, 256, 74);
  // Second pass sharpens the core over the glow.
  ctx.shadowBlur = 8;
  ctx.fillText(label, 256, 74);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#a1a1aa";
  fitText(ctx, opts.sub, 470, 30, MONO, "500");
  ctx.fillText(opts.sub, 256, 150);

  return toTexture(c);
}

/** The hub's big flickery title sign. */
export function signTexture(title: string, tagline: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 256);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  ctx.shadowColor = "#eab308";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "#facc15";
  fitText(ctx, title.toUpperCase(), 890, 120, MONO, "700");
  ctx.fillText(title.toUpperCase(), 512, 96);
  ctx.shadowBlur = 12;
  ctx.fillText(title.toUpperCase(), 512, 96);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#71717a";
  fitText(ctx, tagline, 950, 36, MONO, "500");
  ctx.fillText(tagline, 512, 205);

  return toTexture(c);
}

/** Zombie speech bubble — rounded card, up to 4 short lines. */
export function bubbleTexture(lines: string[]): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 300);

  ctx.fillStyle = "#18181c";
  ctx.strokeStyle = "#52525b";
  ctx.lineWidth = 4;
  roundRect(ctx, 8, 8, 496, 240, 26);
  ctx.fill();
  ctx.stroke();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(226, 246);
  ctx.lineTo(256, 294);
  ctx.lineTo(286, 246);
  ctx.closePath();
  ctx.fillStyle = "#18181c";
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#d4d4d8";
  const n = Math.max(lines.length, 1);
  const lineH = Math.min(52, 200 / n);
  const startY = 128 - ((n - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    fitText(ctx, line, 460, 34, MONO, "600");
    ctx.fillText(line, 256, startY + i * lineH);
  });

  return toTexture(c);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Irregular blood splat decal — every rat dies differently. */
export function bloodSplatTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  // Main body: overlapping dark-red blobs around center.
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 16;
    const r = 10 + Math.random() * 17;
    ctx.globalAlpha = 0.55 + Math.random() * 0.35;
    ctx.fillStyle = i % 3 === 0 ? "#5a1114" : "#480d10";
    ctx.beginPath();
    ctx.ellipse(
      64 + Math.cos(a) * d,
      64 + Math.sin(a) * d,
      r,
      r * (0.6 + Math.random() * 0.4),
      Math.random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Droplet spray.
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 26 + Math.random() * 34;
    ctx.globalAlpha = 0.4 + Math.random() * 0.4;
    ctx.fillStyle = "#4d0f12";
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1.2 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

/** Deterministic dark fill for frames whose image hasn't loaded yet. */
export function seedColor(seed: string): string {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${acc % 360} 45% 14%)`;
}
