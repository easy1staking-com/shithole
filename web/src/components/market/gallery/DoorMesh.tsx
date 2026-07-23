"use client";

 

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { lintelTexture } from "./canvasTextures";
import type { DoorSpec } from "./rooms";

/**
 * A doorway: dark opening, concrete jambs, buzzing neon lintel with the
 * destination's name + listing count. Walk-through detection lives in
 * {@link Player} (distance trigger) — the mesh is purely visual.
 */
export function DoorMesh({
  door,
  leverDown = false,
}: {
  door: DoorSpec;
  /** True when the connected wallet already delegates to this pool. */
  leverDown?: boolean;
}) {
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
      {/* Delegation lever beside rug-pool doors. */}
      {door.lever ? (
        <DelegationLever ticker={door.lever.ticker} down={leverDown} />
      ) : null}
    </group>
  );
}

const LEVER_UP = -0.85;
const LEVER_DOWN = 0.85;

/**
 * The stake lever: pull it (click/E while focused) to re-delegate to
 * this door's pool. Down + green knob = this is YOUR pool. Animates
 * between positions so a successful delegation visibly slams it down.
 */
function DelegationLever({ ticker, down }: { ticker: string; down: boolean }) {
  const arm = useRef<THREE.Group>(null);
  const focus = useMemo(() => ({ focusId: `lever:${ticker}` }), [ticker]);
  const sign = useMemo(
    () =>
      lintelTexture({
        label: "delegate",
        sub: down ? "your pool" : "pull to switch",
        color: down ? "#4ade80" : "#9ca3af",
      }),
    [down],
  );
  useEffect(() => () => sign.dispose(), [sign]);

  useFrame(() => {
    const g = arm.current;
    if (!g) return;
    const target = down ? LEVER_DOWN : LEVER_UP;
    g.rotation.x += (target - g.rotation.x) * 0.12;
  });

  return (
    <group position={[1.55, 1.35, 0.08]}>
      {/* wall plate */}
      <mesh userData={focus}>
        <boxGeometry args={[0.3, 0.72, 0.06]} />
        <meshStandardMaterial color="#232227" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* arm pivots at the plate center */}
      <group ref={arm} rotation-x={down ? LEVER_DOWN : LEVER_UP}>
        <mesh position={[0, 0.24, 0.05]} userData={focus}>
          <boxGeometry args={[0.06, 0.48, 0.06]} />
          <meshStandardMaterial
            color="#4a4650"
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
        <mesh position={[0, 0.5, 0.05]} userData={focus}>
          <sphereGeometry args={[0.075, 10, 8]} />
          {down ? (
            <meshBasicMaterial key="on" color={[0.25, 2.2, 0.7]} toneMapped={false} />
          ) : (
            <meshStandardMaterial key="off" color="#a83232" roughness={0.5} />
          )}
        </mesh>
      </group>
      {/* mini sign under the lever */}
      <mesh position={[0, -0.62, 0.04]}>
        <planeGeometry args={[0.95, 0.356]} />
        <meshBasicMaterial map={sign} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
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
