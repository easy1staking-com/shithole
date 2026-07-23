"use client";

 

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { bubbleTexture } from "./canvasTextures";

export type ZombieState =
  | { kind: "connect" }
  | { kind: "checking" }
  | { kind: "thanks"; ticker: string }
  | { kind: "pitch" };

function linesFor(state: ZombieState): string[] {
  switch (state.kind) {
    case "connect":
      return [
        "BRAAAINS… i mean WALLET.",
        "connect your wallet, mortal,",
        "and let me sniff your stake.",
      ];
    case "checking":
      return ["hold still…", "i'm sniffing your stake…"];
    case "thanks":
      return [
        `you feed ${state.ticker}.`,
        "a true rug enjoyer —",
        "may worthless $HOSKY",
        "rain upon you.",
      ];
    case "pitch":
      return [
        "you stake with a RESPECTABLE",
        "pool? disgusting. pull a lever,",
        "join a rug pool, and earn the",
        "worthless doggo coin: $HOSKY.",
      ];
  }
}

const SKIN = "#7d936c";
const RAGS = "#3c4238";

/**
 * The rug-pool lobby's undead delegation evangelist. Procedural (same
 * school as the rat), slowly turns to face the player, sways on the
 * spot, and holds a speech bubble whose text tracks the wallet's
 * delegation state. Bloom catches the eyes.
 */
export function Zombie({
  position,
  state,
}: {
  position: [number, number, number];
  state: ZombieState;
}) {
  const group = useRef<THREE.Group>(null);

  const bubble = useMemo(() => bubbleTexture(linesFor(state)), [state]);
  useEffect(() => () => bubble.dispose(), [bubble]);

  useFrame(({ camera, clock }) => {
    const g = group.current;
    if (!g) return;
    // Face the player (y only), with undead sluggishness.
    const target = Math.atan2(
      camera.position.x - position[0],
      camera.position.z - position[2],
    );
    const diff = THREE.MathUtils.euclideanModulo(
      target - g.rotation.y + Math.PI,
      Math.PI * 2,
    ) - Math.PI;
    g.rotation.y += diff * 0.03;
    // Idle sway + slow breathing bob. The bob band sits fully ABOVE the
    // floor (base +0.05, ±0.02) — centered at 0 it dipped the feet into
    // the concrete and the floor plane clipped the legs.
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 0.7) * 0.03;
    g.position.y = position[1] + 0.05 + Math.sin(t * 1.3) * 0.02;
  });

  const focus = { focusId: "zombie" };

  return (
    <group ref={group} position={position}>
      {/* legs */}
      <mesh position={[-0.12, 0.45, 0]} userData={focus}>
        <boxGeometry args={[0.16, 0.9, 0.18]} />
        <meshStandardMaterial color={RAGS} roughness={1} />
      </mesh>
      <mesh position={[0.13, 0.42, 0.04]} rotation-x={0.08} userData={focus}>
        <boxGeometry args={[0.16, 0.84, 0.18]} />
        <meshStandardMaterial color={RAGS} roughness={1} />
      </mesh>
      {/* torso — slouched */}
      <mesh position={[0, 1.25, 0.03]} rotation-x={0.12} userData={focus}>
        <boxGeometry args={[0.52, 0.75, 0.3]} />
        <meshStandardMaterial color={RAGS} roughness={1} />
      </mesh>
      {/* arms — classic zombie reach */}
      <mesh
        position={[-0.24, 1.42, 0.38]}
        rotation-x={-Math.PI / 2.15}
        userData={focus}
      >
        <boxGeometry args={[0.12, 0.62, 0.12]} />
        <meshStandardMaterial color={SKIN} roughness={1} />
      </mesh>
      <mesh
        position={[0.24, 1.38, 0.36]}
        rotation-x={-Math.PI / 2.4}
        userData={focus}
      >
        <boxGeometry args={[0.12, 0.6, 0.12]} />
        <meshStandardMaterial color={SKIN} roughness={1} />
      </mesh>
      {/* head — tilted */}
      <mesh position={[0.03, 1.82, 0.05]} rotation-z={-0.14} userData={focus}>
        <sphereGeometry args={[0.19, 12, 10]} />
        <meshStandardMaterial color={SKIN} roughness={1} />
      </mesh>
      {/* eyes — HDR red, bloom smolder */}
      <mesh position={[-0.05, 1.85, 0.21]}>
        <sphereGeometry args={[0.02, 6, 5]} />
        <meshBasicMaterial color={[2.5, 0.2, 0.2]} toneMapped={false} />
      </mesh>
      <mesh position={[0.1, 1.83, 0.21]}>
        <sphereGeometry args={[0.024, 6, 5]} />
        <meshBasicMaterial color={[2.5, 0.2, 0.2]} toneMapped={false} />
      </mesh>
      {/* speech bubble */}
      <mesh position={[0, 2.75, 0.1]}>
        <planeGeometry args={[1.9, 1.11]} />
        <meshBasicMaterial
          map={bubble}
          transparent
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
