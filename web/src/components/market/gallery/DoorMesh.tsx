"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { lintelTexture } from "./canvasTextures";
import type { DoorSpec } from "./rooms";

/**
 * A doorway: dark opening, concrete jambs, buzzing neon lintel with the
 * destination's name + listing count. Walk-through detection lives in
 * {@link Player} (distance trigger) — the mesh is purely visual.
 */
export function DoorMesh({ door }: { door: DoorSpec }) {
  const lintel = useMemo(
    () => lintelTexture({ label: door.label, sub: door.sub, color: door.color }),
    [door.label, door.sub, door.color],
  );
  useEffect(() => () => lintel.dispose(), [lintel]);

  return (
    <group position={door.position} rotation-y={door.rotationY}>
      {/* The void you walk into. */}
      <mesh position={[0, 1.35, 0.02]}>
        <planeGeometry args={[1.7, 2.7]} />
        <meshBasicMaterial color="#020203" side={THREE.DoubleSide} />
      </mesh>
      {/* Jambs + header. */}
      <mesh position={[-0.95, 1.35, 0.06]}>
        <boxGeometry args={[0.2, 2.7, 0.12]} />
        <meshStandardMaterial color="#28262b" roughness={0.9} />
      </mesh>
      <mesh position={[0.95, 1.35, 0.06]}>
        <boxGeometry args={[0.2, 2.7, 0.12]} />
        <meshStandardMaterial color="#28262b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.8, 0.06]}>
        <boxGeometry args={[2.1, 0.2, 0.12]} />
        <meshStandardMaterial color="#28262b" roughness={0.9} />
      </mesh>
      {/* Neon lintel. */}
      <mesh position={[0, 3.45, 0.05]}>
        <planeGeometry args={[2.6, 0.975]} />
        <meshBasicMaterial map={lintel} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Pool emblem on the door void (vendored logos only). */}
      {door.logo ? <DoorLogo path={door.logo} /> : null}
    </group>
  );
}

function DoorLogo({ path }: { path: string }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(path, (t) => {
      if (cancelled) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      // 64px sources — nearest-ish filtering keeps them crisp instead
      // of a blurry smear at door scale.
      t.magFilter = THREE.NearestFilter;
      loaded = t;
      setTex(t);
    });
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [path]);
  if (!tex) return null;
  return (
    <mesh position={[0, 1.85, 0.06]}>
      <planeGeometry args={[0.8, 0.8]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
