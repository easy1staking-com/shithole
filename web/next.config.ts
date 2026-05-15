import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to silence the multi-lockfile
  // detection warning in `next dev` — there's a stray package-lock.json
  // one level up and in $HOME. Dev-only; the production build doesn't
  // use Turbopack.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
