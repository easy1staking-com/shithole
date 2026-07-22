import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * Loads an NFT image as a three.js texture with the same IPFS-gateway
 * rotation as {@link NftImage}: try candidates in order, advance on
 * error. Loading only starts once {@code active} flips true — the 3D
 * equivalent of the 2D viewport gating (frames activate on proximity),
 * so a 200-listing room never bursts the gateways.
 */
export function useNftTexture(
  candidates: string[],
  active: boolean,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const key = candidates.join("|");

  useEffect(() => {
    if (!active || !key) return;
    const list = key.split("|");
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();

    const attempt = (i: number) => {
      if (cancelled || i >= list.length) return;
      loader.load(
        list[i],
        (tex) => {
          if (cancelled) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          loaded = tex;
          setTexture(tex);
        },
        undefined,
        () => attempt(i + 1),
      );
    };
    attempt(0);

    return () => {
      // Room change / unmount: free GPU memory. (The browser HTTP cache
      // still has the bytes, so revisiting a room is cheap.)
      cancelled = true;
      loaded?.dispose();
    };
  }, [active, key]);

  return texture;
}
