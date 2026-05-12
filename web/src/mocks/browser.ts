/**
 * Browser-side MSW worker. Started conditionally by `MswBootstrap`
 * (see src/app/MswBootstrap.tsx) when NEXT_PUBLIC_API_MODE === "mock".
 *
 * In production / when pointing at a real BE, this module is still
 * imported (tree-shaking can't statically know API_MODE), but the
 * worker is never .start()'d — no requests are intercepted.
 */

import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
