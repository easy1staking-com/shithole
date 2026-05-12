import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to silence the multi-lockfile detection
  // warning — there's a stray package-lock.json one level up and in $HOME.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
