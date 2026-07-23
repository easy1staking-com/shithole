"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { plaqueTexture, seedColor } from "./canvasTextures";
import { useNftTexture } from "./useNftTexture";
import type { FramePlacement } from "./rooms";

/** Frames only fetch their image once the player is this close (m). */
const ACTIVATE_DISTANCE = 13;

// Shared across every frame in every room — 150 listings otherwise mean
// ~450 identical geometry instances and hundreds of identical border
// materials.
const BORDER_GEO = new THREE.BoxGeometry(1.58, 1.58, 0.08);
const ART_GEO = new THREE.PlaneGeometry(1.4, 1.4);
const PLAQUE_GEO = new THREE.PlaneGeometry(1.12, 0.56);
const BORDER_IDLE = new THREE.MeshStandardMaterial({
  color: "#2e2c31",
  roughness: 0.8,
});
const BORDER_FOCUS = new THREE.MeshStandardMaterial({
  color: "#8a6a2f",
  emissive: "#8a6a2f",
  emissiveIntensity: 0.55,
  roughness: 0.8,
});

/**
 * One hung NFT: border frame + artwork plane + museum plaque. The
 * artwork uses an UNLIT material so images stay readable in the dim
 * rooms; the texture loads lazily on player proximity.
 */
export const FrameBox = memo(FrameBoxImpl, (prev, next) => {
  // Placements are rebuilt (new identity) whenever room data refreshes;
  // only re-render when something that changes pixels changed.
  const a = prev.placement;
  const b = next.placement;
  return (
    prev.focused === next.focused &&
    a.entry.key === b.entry.key &&
    a.entry.name === b.entry.name &&
    a.entry.priceText === b.entry.priceText &&
    a.entry.candidates.join("\n") === b.entry.candidates.join("\n") &&
    a.entry.poolTickers.join("|") === b.entry.poolTickers.join("|") &&
    a.rotationY === b.rotationY &&
    (a.scale ?? 1) === (b.scale ?? 1) &&
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2]
  );
});

function FrameBoxImpl({
  placement,
  focused,
}: {
  placement: FramePlacement;
  focused: boolean;
}) {
  const { entry, position, rotationY, scale = 1 } = placement;

  const [active, setActive] = useState(false);
  const tick = useRef(0);
  useFrame(({ camera }) => {
    if (active) return;
    if (tick.current++ % 20 !== 0) return;
    const dx = camera.position.x - position[0];
    const dz = camera.position.z - position[2];
    if (dx * dx + dz * dz < ACTIVATE_DISTANCE * ACTIVATE_DISTANCE) {
      setActive(true);
    }
  });

  const texture = useNftTexture(entry.candidates, active);

  // Join the array dep: poolTickers gets a fresh identity on every data
  // refresh, and each false-positive here costs a 512x256 canvas draw +
  // GPU texture upload.
  const poolsKey = entry.poolTickers.join("|");
  const plaque = useMemo(
    () =>
      plaqueTexture({
        name: entry.name,
        priceText: entry.priceText,
        pools: poolsKey ? poolsKey.split("|") : [],
        sub: entry.sub,
      }),
    [entry.name, entry.priceText, poolsKey, entry.sub],
  );
  useEffect(() => () => plaque.dispose(), [plaque]);

  const fallback = useMemo(() => seedColor(entry.seed), [entry.seed]);

  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      {/* Border frame — warms up when focused (shared materials). */}
      <mesh
        geometry={BORDER_GEO}
        material={focused ? BORDER_FOCUS : BORDER_IDLE}
      />
      {/* Artwork. userData.focusId is what the focus raycast reads. */}
      <mesh
        position-z={0.05}
        geometry={ART_GEO}
        userData={{ focusId: `frame:${entry.key}` }}
      >
        {/* Distinct keys force a NEW material when the texture arrives —
            mutating map on a live material needs a shader recompile that
            doesn't reliably happen, leaving the frame stuck on the
            fallback color even after the image loaded. */}
        {texture ? (
          <meshBasicMaterial key="art" map={texture} toneMapped={false} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial key="flat" color={fallback} side={THREE.DoubleSide} />
        )}
      </mesh>
      {/* Plaque. */}
      <mesh position={[0, -1.22, 0.03]} geometry={PLAQUE_GEO}>
        <meshBasicMaterial map={plaque} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
