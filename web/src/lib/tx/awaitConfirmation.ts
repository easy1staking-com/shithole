/**
 * Wait for a tx hash to be confirmed.
 *
 * Uses `lucid.awaitTx(txHash, checkInterval)` from Evolution SDK — it
 * polls the configured provider's tx-status endpoint internally.
 *
 * The hard timeout is ~3 minutes (per the brief). If Blockfrost is slow
 * or down, we surface a clear error so the user can retry the POST
 * separately once chain state catches up.
 */

import type { LucidEvolution } from "@lucid-evolution/lucid";

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

export async function awaitTxConfirmation(
  lucid: LucidEvolution,
  txHash: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS;

  const racer = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `tx ${txHash} not confirmed within ${Math.round(
              timeoutMs / 1000,
            )}s — try again once Blockfrost indexes it`,
          ),
        ),
      timeoutMs,
    );
  });

  const ok = await Promise.race([lucid.awaitTx(txHash, pollMs), racer]);
  if (!ok) {
    throw new Error(`tx ${txHash} polling returned false`);
  }
}
