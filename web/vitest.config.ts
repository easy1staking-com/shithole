import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Minimal vitest config. The FE has few pure modules worth testing —
 * mostly the CIP-8 canonical-payload helper and any other byte-format
 * code that must stay byte-identical with the BE.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // Inline-bundle the Cardano SDKs via Vite's resolver. Both
    // @evolution-sdk/* and @lucid-evolution/* pull in libsodium-wrappers-sumo
    // 0.7.16, which has a broken ESM relative import that Node's
    // module loader can't resolve but Vite can.
    server: {
      deps: {
        inline: [
          /^@evolution-sdk\//,
          /^@lucid-evolution\//,
          /^libsodium/,
        ],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
