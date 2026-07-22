"use client";

import dynamic from "next/dynamic";

/**
 * /market/gallery — "the dump", the walkable 3D marketplace. three.js
 * only loads on this route (dynamic, no SSR): the 2D market bundle is
 * untouched.
 */
const GalleryApp = dynamic(
  () => import("@/components/market/gallery/GalleryApp").then((m) => m.GalleryApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh items-center justify-center bg-black">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          descending into the dump…
        </p>
      </div>
    ),
  },
);

export default function GalleryPage() {
  return <GalleryApp />;
}
