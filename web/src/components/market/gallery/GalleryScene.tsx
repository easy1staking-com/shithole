"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { signTexture } from "./canvasTextures";
import { DoorMesh } from "./DoorMesh";
import { FrameBox } from "./FrameBox";
import { Player } from "./Player";
import {
  GALLERY_TAGLINE,
  type DoorSpec,
  type RoomModel,
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
  onEnterDoor,
  onFocusChange,
  onLockChange,
}: {
  model: RoomModel;
  focusedKey: string | null;
  active: boolean;
  onEnterDoor: (door: DoorSpec) => void;
  onFocusChange: (entryKey: string | null) => void;
  onLockChange: (locked: boolean) => void;
}) {
  const framesGroup = useRef<THREE.Group | null>(null);

  return (
    <>
      <color attach="background" args={["#08080a"]} />
      <fogExp2 attach="fog" args={["#08080a", 0.045]} />
      <ambientLight intensity={0.55} />

      <RoomShell model={model} />

      {model.lights.map((p, i) => (
        <FlickerLight key={i} position={p} seed={i * 37.7} />
      ))}

      {model.sign ? <HubSign model={model} /> : null}

      {model.doors.map((d) => (
        <DoorMesh key={d.id} door={d} />
      ))}

      <group ref={framesGroup}>
        {model.frames.map((f) => (
          <FrameBox
            key={f.entry.key}
            placement={f}
            focused={f.entry.key === focusedKey}
          />
        ))}
      </group>

      <Player
        model={model}
        framesGroup={framesGroup}
        active={active}
        onEnterDoor={onEnterDoor}
        onFocusChange={onFocusChange}
        onLockChange={onLockChange}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

const FLOOR = "#141416";
const WALL = "#1d1c20";
const CEIL = "#0d0d0f";

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
          <meshStandardMaterial color={FLOOR} roughness={1} />
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
        <meshStandardMaterial color={FLOOR} roughness={1} />
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

/**
 * A ceiling light with cheap fluorescent flicker — mostly steady, with
 * pseudo-random dips. Only a handful per room, so per-frame updates are
 * negligible.
 */
function FlickerLight({
  position,
  seed,
}: {
  position: [number, number, number];
  seed: number;
}) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const l = ref.current;
    if (!l) return;
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
      color="#e8e3d0"
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
  return (
    <mesh position={[0, model.wallHeight - 0.9, -(r - 0.2)]}>
      <planeGeometry args={[6.4, 1.6]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
