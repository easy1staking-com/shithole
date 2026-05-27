import path from "node:path";
import type { NextConfig } from "next";

/**
 * Wallets ship in-app "dApp browsers" — Eternl's desktop tab on
 * eternl.io, the iOS/Android Eternl app, AND Eternl's Chrome extension
 * popup that loads sites inside its own iframe from a
 * `chrome-extension://<id>/...` origin. We need framing permissions for
 * each one.
 *
 * - `https://eternl.io` / `https://*.eternl.io` — the web dApp browser.
 * - `chrome-extension:` scheme — Eternl + other browser-extension dApp
 *   browsers (Chrome / Edge / Brave). Browsers treat extension origins
 *   as opaque to frame-ancestors unless the scheme is whitelisted; we
 *   allow the scheme rather than pinning specific extension IDs so the
 *   page doesn't break when a wallet rolls a new build / channel.
 * - `moz-extension:` scheme — Firefox equivalent of the same.
 *
 * Risk model: extension framing is fine for a Cardano dApp because we
 * have no sensitive forms (no passwords) and wallet-signing prompts
 * live inside the wallet UI, not ours — so clickjacking surface is
 * effectively limited to "browse but not act," and the wallet itself
 * is the one framing us in the first place.
 */
const FRAME_ANCESTORS = [
  "'self'",
  "https://eternl.io",
  "https://*.eternl.io",
  "chrome-extension:",
  "moz-extension:",
];

const frameAncestorsValue = FRAME_ANCESTORS.join(" ");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Per-route X-Frame-Options would block iframing. Don't emit
          // it at all — frame-ancestors below is the modern equivalent
          // and is what the wallet's dApp browser checks.
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestorsValue}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
