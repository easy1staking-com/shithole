import path from "node:path";
import type { NextConfig } from "next";

/**
 * Wallets ship in-app "dApp browsers" — Eternl's desktop tab on
 * eternl.io and the iOS/Android Eternl app — that load this site inside
 * an iframe / webview. Browsers default to disallowing cross-origin
 * framing via X-Frame-Options or CSP's frame-ancestors; we need to
 * explicitly allow Eternl's origins. Vespr / Lace currently inject
 * directly into the webview's window.cardano so they don't need framing
 * permissions; if that changes, add their origins here.
 *
 * Anything OTHER than these origins is still blocked from framing the
 * site — i.e. this is a tightening of the default, not a free-for-all.
 */
const ETERNL_FRAME_ORIGINS = [
  "https://eternl.io",
  "https://*.eternl.io",
  // The mobile app loads pages via custom webviews that don't always
  // present a discoverable origin; the default-deny on mobile WKWebView
  // / Android WebView happens at the OS layer, not via frame-ancestors,
  // so listing eternl.io here covers the dApp-browser case in practice.
];

const frameAncestorsValue = ["'self'", ...ETERNL_FRAME_ORIGINS].join(" ");

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
