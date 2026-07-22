"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { RoomBounds } from "./rooms";

const SPEED = 3.2; // m/s — properly startled

/**
 * A resident. Low-poly, procedural (no model file), faintly glowing red
 * eyes so the bloom pass catches them in the dark. Every 12–30s it
 * scurries across the floor between two random points near the walls,
 * with a nervous bob; between runs it hides under the floor. Skipped
 * entirely for prefers-reduced-motion users.
 */
export function Rat({ bounds }: { bounds: RoomBounds }) {
  const group = useRef<THREE.Group>(null);
  const run = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    start: number;
    duration: number;
  } | null>(null);
  const nextAt = useRef(6); // first appearance ~6s in

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;

    if (!run.current) {
      if (t < nextAt.current) return;
      const [from, to] = pickPath(bounds);
      run.current = {
        from,
        to,
        start: t,
        duration: from.distanceTo(to) / SPEED,
      };
      g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      return;
    }

    const r = run.current;
    const k = (t - r.start) / r.duration;
    if (k >= 1) {
      run.current = null;
      nextAt.current = t + 12 + Math.random() * 18;
      g.position.y = -1; // hide until next run
      return;
    }
    g.position.lerpVectors(r.from, r.to, k);
    // Nervous gallop bob.
    g.position.y = 0.02 + Math.abs(Math.sin(k * r.duration * 18)) * 0.05;
  });

  if (reduceMotion) return null;

  return (
    <group ref={group} position={[0, -1, 0]}>
      {/* body */}
      <mesh position={[0, 0.09, 0]} scale={[0.8, 0.62, 1.5]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#232122" roughness={1} />
      </mesh>
      {/* head */}
      <mesh position={[0, 0.1, 0.16]} scale={[0.7, 0.6, 1]}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshStandardMaterial color="#232122" roughness={1} />
      </mesh>
      {/* ears */}
      <mesh position={[-0.035, 0.16, 0.14]}>
        <sphereGeometry args={[0.02, 6, 5]} />
        <meshStandardMaterial color="#2c2628" roughness={1} />
      </mesh>
      <mesh position={[0.035, 0.16, 0.14]}>
        <sphereGeometry args={[0.02, 6, 5]} />
        <meshStandardMaterial color="#2c2628" roughness={1} />
      </mesh>
      {/* eyes — HDR red so the bloom pass makes them smolder */}
      <mesh position={[-0.025, 0.11, 0.21]}>
        <sphereGeometry args={[0.008, 6, 5]} />
        <meshBasicMaterial color={[3, 0.15, 0.15]} toneMapped={false} />
      </mesh>
      <mesh position={[0.025, 0.11, 0.21]}>
        <sphereGeometry args={[0.008, 6, 5]} />
        <meshBasicMaterial color={[3, 0.15, 0.15]} toneMapped={false} />
      </mesh>
      {/* tail */}
      <mesh position={[0, 0.07, -0.2]} rotation-x={Math.PI / 2.3}>
        <cylinderGeometry args={[0.006, 0.014, 0.24, 5]} />
        <meshStandardMaterial color="#3a3234" roughness={1} />
      </mesh>
    </group>
  );
}

/** Two random floor points near opposite walls. */
function pickPath(bounds: RoomBounds): [THREE.Vector3, THREE.Vector3] {
  if (bounds.kind === "rect") {
    const x = bounds.minX + 1.5 + Math.random() * (bounds.maxX - bounds.minX - 3);
    const x2 = Math.min(
      bounds.maxX - 1,
      Math.max(bounds.minX + 1, x + (Math.random() - 0.5) * 6),
    );
    return [
      new THREE.Vector3(x, 0, bounds.minZ + 0.35),
      new THREE.Vector3(x2, 0, bounds.maxZ - 0.35),
    ];
  }
  const a = Math.random() * Math.PI * 2;
  const b = a + Math.PI * (0.7 + Math.random() * 0.6);
  const r = bounds.radius - 0.5;
  return [
    new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
    new THREE.Vector3(Math.cos(b) * r, 0, Math.sin(b) * r),
  ];
}
