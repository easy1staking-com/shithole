import { useEffect, useState } from "react";
import * as THREE from "three";

/** Artwork planes are 1.4m — 512px is generous; 4000px IPFS originals
 * uploaded raw were ~22MB of GPU memory EACH with mips. */
const MAX_TEXTURE_PX = 512;

/**
 * Loads an NFT image as a three.js texture with the same IPFS-gateway
 * rotation as {@link NftImage}: try candidates in order, advance on
 * error. Loading only starts once {@code active} flips true — the 3D
 * equivalent of the 2D viewport gating (frames activate on proximity),
 * so a 200-listing room never bursts the gateways. Images are
 * downscaled to {@link MAX_TEXTURE_PX} before the GPU upload.
 */
export function useNftTexture(
  candidates: string[],
  active: boolean,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  // Newline separator: URLs can legally contain "|" but never "\n".
  const key = candidates.join("\n");

  useEffect(() => {
    if (!active || !key) return;
    const list = key.split("\n");
    let cancelled = false;
    let loaded: THREE.Texture | null = null;

    const attempt = async (i: number) => {
      if (cancelled || i >= list.length) return;
      try {
        const res = await fetch(list[i], { mode: "cors" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: MAX_TEXTURE_PX,
          resizeQuality: "medium",
        });
        if (cancelled) {
          bitmap.close();
          return;
        }
        const tex = new THREE.Texture(bitmap);
        tex.needsUpdate = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        loaded = tex;
        setTexture(tex);
      } catch {
        attempt(i + 1);
      }
    };
    attempt(0);

    return () => {
      // Room change / unmount: free GPU memory. (The browser HTTP cache
      // still has the bytes, so revisiting a room is cheap.) Also drop
      // the state reference — re-rendering with a disposed texture
      // uploads a zombie GPU copy nobody disposes.
      cancelled = true;
      if (loaded) {
        loaded.dispose();
        setTexture((t) => (t === loaded ? null : t));
      }
    };
  }, [active, key]);

  return texture;
}
