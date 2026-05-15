import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to silence the multi-lockfile detection
  // warning — there's a stray package-lock.json one level up and in $HOME.
  // Both knobs must point at the same path: outputFileTracingRoot drives
  // the file-tracing that includes deps in the serverless function bundle;
  // turbopack.root is the project root for Turbopack. When they disagree,
  // Next 16 logs a warning and may build a bundle that's missing files.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
