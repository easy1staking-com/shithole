"use client";

/* eslint-disable react-hooks/immutability --
 * react-three-fiber's render loop works by MUTATING three.js objects
 * (camera position/rotation, scratch vectors) inside useFrame — that's
 * the library's core idiom, not accidental render-phase mutation. The
 * compiler lint can't distinguish the two, so it's off for this file. */

import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  EYE,
  type Blocker,
  type DoorSpec,
  type RoomBounds,
  type RoomModel,
} from "./rooms";

const WALK_SPEED = 3.8;
const RUN_SPEED = 6.2;
const DOOR_TRIGGER = 1.25; // walk this close → through the door
const FOCUS_RANGE = 8;

/**
 * First-person player: pointer-lock look, WASD walk, room-bounds clamp,
 * door triggers, and the center-screen focus raycast that drives the
 * HUD's listing card. Remounted (keyed) on every room change so spawn
 * position/yaw reset cleanly.
 */
/**
 * Pointer-lock controls that OUTLIVE room changes. Rendered once per
 * Canvas (not inside the keyed scene): if the controls remounted with
 * the room, the browser kept the pointer captured but the fresh
 * instance didn't know it was locked — mouse-look froze until an extra
 * click. One persistent instance = walk through doors without ever
 * re-clicking.
 */
export function LockControls() {
  return <PointerLockControls selector="#dump-canvas" />;
}

export function Player({
  model,
  interactGroup,
  active,
  onEnterDoor,
  onFocusChange,
}: {
  model: RoomModel;
  /** Everything the center-screen raycast may focus (frames, levers, zombie). */
  interactGroup: React.RefObject<THREE.Group | null>;
  /** False while the room-change fade runs — freezes input + triggers. */
  active: boolean;
  onEnterDoor: (door: DoorSpec) => void;
  /** Emits the focused object's userData.focusId ("frame:…", "lever:…", "zombie"). */
  onFocusChange: (focusId: string | null) => void;
}) {
  const camera = useThree((s) => s.camera);

  // Spawn — runs once per room mount.
  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.position.set(...model.spawn.position);
    camera.rotation.set(0, model.spawn.yaw, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard state.
  const keys = useRef<Set<string>>(new Set());
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    r.far = FOCUS_RANGE;
    return r;
  }, []);
  const lastFocus = useRef<string | null>(null);
  const mountedAt = useRef<number | null>(null);
  const tick = useRef(0);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const move = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, rawDelta) => {
    if (mountedAt.current === null) mountedAt.current = state.clock.elapsedTime;
    if (!active) return;
    const delta = Math.min(rawDelta, 0.05);
    const k = keys.current;

    // --- movement -------------------------------------------------
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();

    move.set(0, 0, 0);
    if (k.has("KeyW") || k.has("ArrowUp")) move.add(fwd);
    if (k.has("KeyS") || k.has("ArrowDown")) move.sub(fwd);
    if (k.has("KeyD") || k.has("ArrowRight")) move.add(right);
    if (k.has("KeyA") || k.has("ArrowLeft")) move.sub(right);
    if (move.lengthSq() > 0) {
      const speed =
        k.has("ShiftLeft") || k.has("ShiftRight") ? RUN_SPEED : WALK_SPEED;
      move.normalize().multiplyScalar(speed * delta);
      camera.position.add(move);
    }
    camera.position.y = EYE;
    clampToBounds(camera.position, model.bounds);
    for (const b of model.blockers) pushOut(camera.position, b);

    // --- door triggers ---------------------------------------------
    // Short grace period after spawn so a door near the spawn point
    // can't immediately bounce the player back.
    if (state.clock.elapsedTime - mountedAt.current > 0.6) {
      for (const door of model.doors) {
        const dx = camera.position.x - door.position[0];
        const dz = camera.position.z - door.position[2];
        if (dx * dx + dz * dz < DOOR_TRIGGER * DOOR_TRIGGER) {
          onEnterDoor(door);
          return;
        }
      }
    }

    // --- focus raycast (throttled) ----------------------------------
    if (tick.current++ % 5 === 0) {
      let key: string | null = null;
      const group = interactGroup.current;
      if (group && group.children.length > 0) {
        raycaster.setFromCamera(CENTER, camera);
        const hits = raycaster.intersectObjects(group.children, true);
        for (const hit of hits) {
          // Below-floor hits are hidden rats parked at y=-1 — ignore.
          if (hit.point.y < -0.2) continue;
          const k2 = hit.object.userData?.focusId as string | undefined;
          // FIRST meaningful hit decides: a mesh without a focusId is an
          // occluder (partition, cabinet body) — no focusing through it.
          key = k2 ?? null;
          break;
        }
      }
      if (key !== lastFocus.current) {
        lastFocus.current = key;
        onFocusChange(key);
      }
    }
  });

  return null;
}

const CENTER = new THREE.Vector2(0, 0);

/** Eject the player from an interior partition along the cheapest axis. */
function pushOut(p: THREE.Vector3, b: Blocker) {
  const m = 0.45;
  if (
    p.x <= b.minX - m ||
    p.x >= b.maxX + m ||
    p.z <= b.minZ - m ||
    p.z >= b.maxZ + m
  ) {
    return;
  }
  const dxl = p.x - (b.minX - m);
  const dxr = b.maxX + m - p.x;
  const dzl = p.z - (b.minZ - m);
  const dzr = b.maxZ + m - p.z;
  const min = Math.min(dxl, dxr, dzl, dzr);
  if (min === dxl) p.x = b.minX - m;
  else if (min === dxr) p.x = b.maxX + m;
  else if (min === dzl) p.z = b.minZ - m;
  else p.z = b.maxZ + m;
}

function clampToBounds(p: THREE.Vector3, bounds: RoomBounds) {
  const margin = 0.55;
  if (bounds.kind === "circle") {
    const r = Math.hypot(p.x, p.z);
    const max = bounds.radius - margin;
    if (r > max) {
      const s = max / r;
      p.x *= s;
      p.z *= s;
    }
  } else {
    p.x = Math.min(Math.max(p.x, bounds.minX + margin), bounds.maxX - margin);
    p.z = Math.min(Math.max(p.z, bounds.minZ + margin), bounds.maxZ - margin);
  }
}
