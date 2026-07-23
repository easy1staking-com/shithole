/**
 * Stage 0 of the rat bounty (docs/RAT_BOUNTY.md): local-only kill
 * accounting. Rat.tsx fires {@link RAT_KILLED_EVENT} on every confirmed
 * kill; the tally lives in localStorage until the BE accounting of
 * Stage 1 replaces it as the source of truth.
 */

export const RAT_KILLED_EVENT = "shithole:rat-killed";

export const HOSKY_PER_RAT = 69_420;

const KEY = "shithole.rat.kills";

export function ratKillCount(): number {
  if (typeof localStorage === "undefined") return 0;
  const n = Number(localStorage.getItem(KEY) ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function recordRatKill(): number {
  const n = ratKillCount() + 1;
  localStorage.setItem(KEY, String(n));
  return n;
}
