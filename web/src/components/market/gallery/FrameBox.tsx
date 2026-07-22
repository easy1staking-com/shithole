"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";

import { plaqueTexture, seedColor } from "./canvasTextures";
import { useNftTexture } from "./useNftTexture";
import type { FramePlacement } from "./rooms";

/** Frames only fetch their image once the player is this close (m). */
const ACTIVATE_DISTANCE = 13;

/**
 * One hung NFT: border frame + artwork plane + museum plaque. The
 * artwork uses an UNLIT material so images stay readable in the dim
 * rooms; the texture loads lazily on player proximity.
 */
export function FrameBox({
  placement,
  focused,
}: {
  placement: FramePlacement;
  focused: boolean;
}) {
  const { entry, position, rotationY } = placement;

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

  const plaque = useMemo(
    () =>
      plaqueTexture({
        name: entry.name,
        priceText: entry.priceText,
        pools: entry.poolTickers,
        sub: entry.sub,
      }),
    [entry.name, entry.priceText, entry.poolTickers, entry.sub],
  );
  useEffect(() => () => plaque.dispose(), [plaque]);

  const fallback = useMemo(() => seedColor(entry.seed), [entry.seed]);

  return (
    <group position={position} rotation-y={rotationY}>
      {/* Border frame — warms up when focused. */}
      <mesh>
        <boxGeometry args={[1.58, 1.58, 0.08]} />
        <meshStandardMaterial
          color={focused ? "#8a6a2f" : "#2e2c31"}
          emissive={focused ? "#8a6a2f" : "#000000"}
          emissiveIntensity={focused ? 0.55 : 0}
          roughness={0.8}
        />
      </mesh>
      {/* Artwork. userData.entryKey is what the focus raycast reads. */}
      <mesh position-z={0.05} userData={{ entryKey: entry.key }}>
        <planeGeometry args={[1.4, 1.4]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshBasicMaterial color={fallback} />
        )}
      </mesh>
      {/* Plaque. */}
      <mesh position={[0, -1.22, 0.03]}>
        <planeGeometry args={[1.12, 0.56]} />
        <meshBasicMaterial map={plaque} toneMapped={false} />
      </mesh>
    </group>
  );
}
