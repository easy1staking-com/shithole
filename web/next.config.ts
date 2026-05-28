import path from "node:path";
import type { NextConfig } from "next";

/**
 * No CSP / X-Frame-Options. Wallet dApp browsers (Eternl's eternl.io
 * tab, the iOS/Android in-app browser, and Eternl's Chrome-extension
 * dApp browser) frame us from a mix of origins — `https://*.eternl.io`,
 * `chrome-extension://<id>/...`, and `moz-extension://<id>/...`. Even a
 * permissive `frame-ancestors 'self' …` triggers an
 * "Unrecognized origin: 'self'" warning in the eternl.io parent and
 * has correlated with the dApp-browser bridge failing to hand-shake.
 * The reference dApp (adamatic-www) ships no CSP and the bridge works
 * across all three surfaces, so we drop ours too.
 *
 * Risk model: a Cardano dApp has no sensitive HTML forms — no
 * passwords, no credit-card fields. Every privileged action (tx sign,
 * data sign) is approved inside the wallet's own UI, not ours, so
 * iframe-based clickjacking is effectively "browse but not act."
 * Re-add a CSP only when we add a surface where iframe deception
 * would actually matter.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
