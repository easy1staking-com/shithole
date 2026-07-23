"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { bloodSplatTexture } from "./canvasTextures";
import type { RoomBounds } from "./rooms";
import { playRatSplat } from "./useAmbientAudio";

/** GalleryApp dispatches this with detail = the rat's focusId. */
export const SHOOT_RAT_EVENT = "shithole:shoot-rat";

const SPEED = 3.2; // m/s — properly startled
const PARTICLE_COUNT = 16;
const EXPLOSION_S = 0.85;
const STAIN_HOLD_S = 25;
const STAIN_FADE_S = 20;

type Run = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
  /** Fraction of the run where it stops to stare at you. */
  pauseAt: number;
  pauseDur: number;
  pauseStart: number | null;
  pauseDone: boolean;
};

type Stain = { key: number; x: number; z: number; rot: number; scale: number };

/**
 * A resident — now a TARGET. Scurries wall to wall; most runs it stops
 * midway, rears up and stares straight at the camera (that's your shot
 * window). Focus it and click/E → squeak, meat confetti, and a blood
 * splat that soaks the floor for ~45s. Another rat eventually replaces
 * it, because rats. Skipped for prefers-reduced-motion users.
 */
export function Rat({ id, bounds }: { id: string; bounds: RoomBounds }) {
  const group = useRef<THREE.Group>(null);
  const run = useRef<Run | null>(null);
  // -1 = unset; stamped with a random first-appearance time on the
  // first frame (Math.random in a render-phase initializer is impure).
  const nextAt = useRef(-1);
  const focus = useMemo(() => ({ focusId: `rat:${id}` }), [id]);

  // Explosion state: particles integrate in refs; React only mounts/
  // unmounts the particle meshes and the stains.
  const [exploding, setExploding] = useState(false);
  const explosion = useRef<{ start: number } | null>(null);
  const particles = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3 }[]>([]);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const [stains, setStains] = useState<Stain[]>([]);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const onShoot = (e: Event) => {
      if ((e as CustomEvent).detail !== `rat:${id}`) return;
      const g = group.current;
      // No corpse desecration: ignore when hidden or already popping.
      if (!g || explosion.current || g.position.y < -0.5) return;
      const at = g.position.clone();
      particles.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        pos: at.clone().add(new THREE.Vector3(0, 0.12, 0)),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3.6,
          1.2 + Math.random() * 2.8,
          (Math.random() - 0.5) * 3.6,
        ),
      }));
      explosion.current = { start: -1 };
      playRatSplat();
      setExploding(true);
      setStains((s) => [
        ...s.slice(-5),
        {
          key: Date.now() + Math.random(),
          x: at.x,
          z: at.z,
          rot: Math.random() * Math.PI * 2,
          scale: 0.6 + Math.random() * 0.5,
        },
      ]);
      g.position.y = -1; // hide the body instantly
      run.current = null;
    };
    window.addEventListener(SHOOT_RAT_EVENT, onShoot);
    return () => window.removeEventListener(SHOOT_RAT_EVENT, onShoot);
  }, [id]);

  useFrame(({ camera, clock }, rawDelta) => {
    const t = clock.elapsedTime;
    const delta = Math.min(rawDelta, 0.05);
    if (nextAt.current < 0) nextAt.current = t + 4 + Math.random() * 9;

    // --- explosion particles ---------------------------------------
    if (explosion.current) {
      if (explosion.current.start < 0) explosion.current.start = t;
      const age = t - explosion.current.start;
      particles.current.forEach((p, i) => {
        p.vel.y -= 9.8 * delta;
        p.pos.addScaledVector(p.vel, delta);
        if (p.pos.y < 0.02) {
          p.pos.y = 0.02;
          p.vel.set(0, 0, 0); // giblets rest where they land
        }
        const m = particleRefs.current[i];
        if (m) {
          m.position.copy(p.pos);
          const s = Math.max(0.001, 1 - (age / EXPLOSION_S) * 0.9);
          m.scale.setScalar(s);
        }
      });
      if (age > EXPLOSION_S) {
        explosion.current = null;
        setExploding(false);
        nextAt.current = t + 14 + Math.random() * 18; // the next of kin
      }
      return;
    }

    const g = group.current;
    if (!g) return;

    // --- spawn a new run ---------------------------------------------
    if (!run.current) {
      if (t < nextAt.current) return;
      const [from, to] = pickPath(bounds);
      run.current = {
        from,
        to,
        start: t,
        duration: from.distanceTo(to) / SPEED,
        pauseAt: 0.3 + Math.random() * 0.4,
        pauseDur: 1.3 + Math.random() * 1.5,
        pauseStart: null,
        // ~30% of runs don't pause — keeps them unpredictable.
        pauseDone: Math.random() < 0.3,
      };
      g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      g.rotation.x = 0;
      return;
    }

    const r = run.current;

    // --- paused: rear up and stare at the player ---------------------
    if (r.pauseStart !== null) {
      const targetYaw = Math.atan2(
        camera.position.x - g.position.x,
        camera.position.z - g.position.z,
      );
      const diff =
        THREE.MathUtils.euclideanModulo(
          targetYaw - g.rotation.y + Math.PI,
          Math.PI * 2,
        ) - Math.PI;
      g.rotation.y += diff * 0.15;
      g.rotation.x = -0.35; // rearing up, nose toward you
      g.position.y = 0.05 + Math.sin(t * 9) * 0.012; // nervous tremble
      if (t - r.pauseStart > r.pauseDur) {
        // Resume the run where it left off.
        r.start += t - r.pauseStart;
        r.pauseStart = null;
        r.pauseDone = true;
        g.rotation.x = 0;
        g.rotation.y = Math.atan2(r.to.x - r.from.x, r.to.z - r.from.z);
      }
      return;
    }

    // --- running -----------------------------------------------------
    const k = (t - r.start) / r.duration;
    if (!r.pauseDone && k >= r.pauseAt) {
      r.pauseStart = t;
      return;
    }
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
    <>
      <group ref={group} position={[0, -1, 0]}>
        {/* body */}
        <mesh position={[0, 0.09, 0]} scale={[0.8, 0.62, 1.5]} userData={focus}>
          <sphereGeometry args={[0.11, 10, 8]} />
          <meshStandardMaterial color="#232122" roughness={1} />
        </mesh>
        {/* head */}
        <mesh position={[0, 0.1, 0.16]} scale={[0.7, 0.6, 1]} userData={focus}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshStandardMaterial color="#232122" roughness={1} />
        </mesh>
        {/* ears */}
        <mesh position={[-0.035, 0.16, 0.14]} userData={focus}>
          <sphereGeometry args={[0.02, 6, 5]} />
          <meshStandardMaterial color="#2c2628" roughness={1} />
        </mesh>
        <mesh position={[0.035, 0.16, 0.14]} userData={focus}>
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

      {/* meat confetti */}
      {exploding
        ? Array.from({ length: PARTICLE_COUNT }, (_, i) => (
            <mesh
              key={i}
              ref={(m) => {
                particleRefs.current[i] = m;
              }}
            >
              <boxGeometry args={[0.045, 0.045, 0.045]} />
              <meshBasicMaterial
                color={i % 4 === 0 ? "#7a1a1e" : "#521014"}
                toneMapped={false}
              />
            </mesh>
          ))
        : null}

      {/* what remains */}
      {stains.map((s) => (
        <BloodStain
          key={s.key}
          stain={s}
          onGone={() =>
            setStains((xs) => xs.filter((x) => x.key !== s.key))
          }
        />
      ))}
    </>
  );
}

function BloodStain({ stain, onGone }: { stain: Stain; onGone: () => void }) {
  const tex = useMemo(() => bloodSplatTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const born = useRef<number | null>(null);
  const gone = useRef(false);

  useFrame(({ clock }) => {
    born.current ??= clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    const opacity =
      age < STAIN_HOLD_S
        ? 0.9
        : Math.max(0, 0.9 * (1 - (age - STAIN_HOLD_S) / STAIN_FADE_S));
    if (mat.current) mat.current.opacity = opacity;
    if (age > STAIN_HOLD_S + STAIN_FADE_S && !gone.current) {
      gone.current = true;
      onGone();
    }
  });

  return (
    <mesh
      position={[stain.x, 0.012, stain.z]}
      rotation={[-Math.PI / 2, 0, stain.rot]}
      scale={stain.scale}
    >
      <planeGeometry args={[0.9, 0.9]} />
      <meshBasicMaterial
        ref={mat}
        map={tex}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </mesh>
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
