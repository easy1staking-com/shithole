"use client";

import { MeshReflectorMaterial, Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { signTexture } from "./canvasTextures";
import { DoorMesh } from "./DoorMesh";
import { FrameBox } from "./FrameBox";
import { Player } from "./Player";
import { Rat } from "./Rat";
import { Zombie, type ZombieState } from "./Zombie";
import {
  GALLERY_TAGLINE,
  type DoorSpec,
  type RoomModel,
  type RoomTheme,
} from "./rooms";

/**
 * Everything inside the <Canvas> for one room: shell (walls/floor/
 * ceiling), flickering lights, doors, hung frames, and the player.
 * Keyed by room in GalleryApp so a room change is a clean remount.
 */
export function GalleryScene({
  model,
  focusedKey,
  active,
  delegatedTicker,
  zombieState,
  onEnterDoor,
  onFocusChange,
}: {
  model: RoomModel;
  focusedKey: string | null;
  active: boolean;
  /** Rug pool the connected wallet delegates to — sets lever positions. */
  delegatedTicker: string | null;
  zombieState: ZombieState;
  onEnterDoor: (door: DoorSpec) => void;
  onFocusChange: (focusId: string | null) => void;
}) {
  const interactGroup = useRef<THREE.Group | null>(null);

  return (
    <>
      <color attach="background" args={[model.theme.fog]} />
      <fogExp2 attach="fog" args={[model.theme.fog, model.theme.fogDensity]} />
      <ambientLight intensity={0.55} />

      <RoomShell model={model} />
      <RoomDust model={model} />
      {/* One resident per dry room; the sewer keeps a family. */}
      {Array.from({ length: model.theme.wetFloor ? 3 : 1 }, (_, i) => (
        <Rat key={i} bounds={model.bounds} />
      ))}

      {/* Freestanding partitions (hero panels). */}
      {model.blockers.map((b, i) => (
        <mesh
          key={i}
          position={[
            (b.minX + b.maxX) / 2,
            model.wallHeight / 2,
            (b.minZ + b.maxZ) / 2,
          ]}
        >
          <boxGeometry
            args={[b.maxX - b.minX, model.wallHeight, b.maxZ - b.minZ]}
          />
          <meshStandardMaterial color={WALL} roughness={0.95} />
        </mesh>
      ))}

      {model.lights.map((p, i) => (
        <FlickerLight key={i} position={p} seed={i * 37.7} color={model.theme.light} />
      ))}

      {model.sign ? <HubSign model={model} /> : null}

      {/* One group for everything the focus raycast can hit. */}
      <group ref={interactGroup}>
        {model.doors.map((d) => (
          <DoorMesh
            key={d.id}
            door={d}
            leverDown={Boolean(
              d.lever && delegatedTicker === d.lever.ticker,
            )}
          />
        ))}

        {model.frames.map((f) => (
          <FrameBox
            key={f.entry.key}
            placement={f}
            focused={f.entry.key === focusedKey}
          />
        ))}

        {model.zombie ? (
          <Zombie position={[3.2, 0, -3.2]} state={zombieState} />
        ) : null}
      </group>

      <Player
        model={model}
        interactGroup={interactGroup}
        active={active}
        onEnterDoor={onEnterDoor}
        onFocusChange={onFocusChange}
      />

      {/* Neon actually glows; HDR pixels (rat eyes) smolder. */}
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.72} intensity={0.85} />
      </EffectComposer>
    </>
  );
}

/** Dust motes drifting through the light — cheap atmosphere. */
function RoomDust({ model }: { model: RoomModel }) {
  if (model.bounds.kind === "circle") {
    const r = model.bounds.radius;
    return (
      <Sparkles
        count={90}
        color={model.theme.sparkles}
        size={2.4}
        speed={0.22}
        opacity={0.4}
        scale={[r * 1.6, model.wallHeight * 0.8, r * 1.6]}
        position={[0, model.wallHeight * 0.45, 0]}
      />
    );
  }
  const { minX, maxX, minZ, maxZ } = model.bounds;
  return (
    <Sparkles
      count={Math.min(160, Math.round((maxX - minX) * 6))}
      color={model.theme.sparkles}
      size={2.4}
      speed={0.22}
      opacity={0.4}
      scale={[maxX - minX - 1, model.wallHeight * 0.8, maxZ - minZ - 1]}
      position={[(minX + maxX) / 2, model.wallHeight * 0.45, (minZ + maxZ) / 2]}
    />
  );
}

/* ------------------------------------------------------------------ */

// Keep wall/floor clearly apart in value — with the dim flicker lighting
// they read as one surface if they're within a few % of each other.
const FLOOR = "#0e0e10";
const WALL = "#2e2b33";
const CEIL = "#0b0b0d";

function RoomShell({ model }: { model: RoomModel }) {
  const h = model.wallHeight;
  if (model.bounds.kind === "circle") {
    const r = model.bounds.radius;
    return (
      <group>
        <mesh position={[0, h / 2, 0]}>
          <cylinderGeometry args={[r, r, h, 48, 1, true]} />
          <meshStandardMaterial color={WALL} roughness={0.95} side={THREE.BackSide} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[r, 48]} />
          <FloorMaterial theme={model.theme} />
        </mesh>
        <mesh position={[0, h, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[r, 48]} />
          <meshStandardMaterial color={CEIL} roughness={1} />
        </mesh>
      </group>
    );
  }
  const { minX, maxX, minZ, maxZ } = model.bounds;
  const len = maxX - minX;
  const wid = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[len, wid]} />
        <FloorMaterial theme={model.theme} />
      </mesh>
      <mesh position={[cx, h, cz]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[len, wid]} />
        <meshStandardMaterial color={CEIL} roughness={1} />
      </mesh>
      {/* Long walls (frames hang just inside these). */}
      <mesh position={[cx, h / 2, minZ]}>
        <planeGeometry args={[len, h]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[cx, h / 2, maxZ]} rotation-y={Math.PI}>
        <planeGeometry args={[len, h]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      {/* End walls. */}
      <mesh position={[minX, h / 2, cz]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[wid, h]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[maxX, h / 2, cz]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[wid, h]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Dry rooms: matte concrete. The sewer: a mirror-wet slick. */
function FloorMaterial({ theme }: { theme: RoomTheme }) {
  if (!theme.wetFloor) {
    return <meshStandardMaterial color={FLOOR} roughness={1} />;
  }
  return (
    <MeshReflectorMaterial
      color="#101a14"
      metalness={0.6}
      roughness={0.35}
      mirror={0.8}
      resolution={512}
      blur={[160, 60]}
      mixBlur={0.6}
      mixStrength={14}
    />
  );
}


/**
 * A ceiling light with cheap fluorescent flicker — mostly steady, with
 * pseudo-random dips. Only a handful per room, so per-frame updates are
 * negligible.
 */
function FlickerLight({
  position,
  seed,
  color,
}: {
  position: [number, number, number];
  seed: number;
  color: string;
}) {
  const ref = useRef<THREE.PointLight>(null);
  // Photosensitivity guard: sudden luminance dropouts are exactly what
  // prefers-reduced-motion users opt out of. They keep a steady lamp.
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  useFrame(({ clock }) => {
    const l = ref.current;
    if (!l) return;
    if (reduceMotion) {
      l.intensity = 22 * 0.92;
      return;
    }
    const t = clock.elapsedTime + seed;
    // Layered sines make an organic buzz; the steep sin-product term
    // produces occasional near-dropouts.
    const buzz = 0.9 + 0.08 * Math.sin(t * 13.7) + 0.05 * Math.sin(t * 47.3);
    const dropout = Math.sin(t * 1.7) * Math.sin(t * 2.9) > 0.985 ? 0.35 : 1;
    l.intensity = 22 * buzz * dropout;
  });
  return (
    <pointLight
      ref={ref}
      position={position}
      intensity={22}
      distance={18}
      decay={1.6}
      color={color}
    />
  );
}

function HubSign({ model }: { model: RoomModel }) {
  const tex = useMemo(
    () => signTexture(model.sign ?? "", GALLERY_TAGLINE),
    [model.sign],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  const r = model.bounds.kind === "circle" ? model.bounds.radius : 8;
  // Inset past the cylinder wall's sag at the sign's half-width (3.2m),
  // otherwise the curved wall swallows the first/last letters.
  const inset = (3.2 * 3.2) / (2 * r) + 0.25;
  return (
    <mesh position={[0, model.wallHeight - 0.9, -(r - inset)]}>
      <planeGeometry args={[6.4, 1.6]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
