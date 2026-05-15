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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
