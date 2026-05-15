/**
 * Wait for a tx hash to be confirmed via Evolution SDK's
 * {@code client.awaitTx}.
 *
 * <p>The hard timeout is ~3 minutes. If the provider is slow or down,
 * we surface a clear error so the caller can retry separately once
 * chain state catches up.
 */

import type { EvolutionClient } from "./evolutionClient";
import { toTxHash } from "./txAdapters";

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

export async function awaitTxConfirmation(
  client: EvolutionClient,
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
            )}s — try again once the provider indexes it`,
          ),
        ),
      timeoutMs,
    );
  });

  // Evolution's awaitTx returns boolean; race against our timeout.
  const ok = await Promise.race([
    client.awaitTx(toTxHash(txHash), pollMs),
    racer,
  ]);
  if (!ok) {
    throw new Error(`tx ${txHash} polling returned false`);
  }
}
