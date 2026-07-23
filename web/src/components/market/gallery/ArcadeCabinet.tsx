"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { lintelTexture } from "./canvasTextures";
import type { CabinetSpec } from "./rooms";
import { SNEK_HI_EVENT, snekHighScore } from "./snekScore";

/**
 * A CRT arcade cabinet. The attract screen is a canvas texture showing
 * title + hi-score + "PRESS E"; it re-renders when the game saves a new
 * high score (custom window event — localStorage writes in the same tab
 * don't fire 'storage'). Focus/E handling lives in GalleryApp.
 */
export function ArcadeCabinet({ spec }: { spec: CabinetSpec }) {
  const focus = useMemo(() => ({ focusId: `cabinet:${spec.game}` }), [spec.game]);

  // Lazy initializer reads localStorage once at mount (client-only
  // component — no SSR mismatch); the event keeps it fresh afterwards.
  const [hi, setHi] = useState(() => snekHighScore());
  useEffect(() => {
    const onHi = () => setHi(snekHighScore());
    window.addEventListener(SNEK_HI_EVENT, onHi);
    return () => window.removeEventListener(SNEK_HI_EVENT, onHi);
  }, []);

  const screen = useMemo(() => attractTexture(hi), [hi]);
  useEffect(() => () => screen.dispose(), [screen]);

  const marquee = useMemo(
    () => lintelTexture({ label: "SNEK", sub: "insert nothing", color: "#34d399" }),
    [],
  );
  useEffect(() => () => marquee.dispose(), [marquee]);

  return (
    <group position={spec.position} rotation-y={spec.rotationY}>
      {/* body */}
      <mesh position={[0, 1, 0]} userData={focus}>
        <boxGeometry args={[1.0, 2.0, 0.85]} />
        <meshStandardMaterial color="#17161b" roughness={0.7} />
      </mesh>
      {/* side accent stripes */}
      <mesh position={[-0.505, 1.1, 0.1]}>
        <planeGeometry args={[0.62, 1.7]} />
        <meshBasicMaterial color="#123324" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.505, 1.1, 0.1]}>
        <planeGeometry args={[0.62, 1.7]} />
        <meshBasicMaterial color="#123324" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* screen — slightly tilted back, unlit so it glows in the dark */}
      <mesh position={[0, 1.42, 0.44]} rotation-x={-0.1} userData={focus}>
        <planeGeometry args={[0.74, 0.62]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      {/* control deck */}
      <mesh position={[0, 1.02, 0.5]} rotation-x={-0.5} userData={focus}>
        <boxGeometry args={[0.9, 0.06, 0.34]} />
        <meshStandardMaterial color="#26242c" roughness={0.6} />
      </mesh>
      {/* joystick ball — a tiny red glow for the bloom */}
      <mesh position={[-0.2, 1.14, 0.52]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshBasicMaterial color={[1.6, 0.2, 0.2]} toneMapped={false} />
      </mesh>
      {/* marquee */}
      <mesh position={[0, 2.12, 0.42]} rotation-x={0.15}>
        <planeGeometry args={[1.05, 0.39]} />
        <meshBasicMaterial map={marquee} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function attractTexture(hi: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 430;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");

  ctx.fillStyle = "#03110a";
  ctx.fillRect(0, 0, 512, 430);
  // CRT scanlines.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 0; y < 430; y += 4) ctx.fillRect(0, y, 512, 2);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const mono = "700 92px ui-monospace, Menlo, monospace";

  ctx.shadowColor = "#34d399";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#34d399";
  ctx.font = mono;
  ctx.fillText("SNEK", 256, 110);
  ctx.shadowBlur = 10;
  ctx.fillText("SNEK", 256, 110);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#a7f3d0";
  ctx.font = "600 34px ui-monospace, Menlo, monospace";
  ctx.fillText(`HI-SCORE ${hi}`, 256, 215);

  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 30px ui-monospace, Menlo, monospace";
  ctx.fillText("PRESS E TO PLAY", 256, 300);

  ctx.fillStyle = "#52525b";
  ctx.font = "600 24px ui-monospace, Menlo, monospace";
  ctx.fillText("PRIZE: NOTHING", 256, 375);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
