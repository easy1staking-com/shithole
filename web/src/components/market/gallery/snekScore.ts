/** SNEK high score — localStorage + a same-tab change event. */

const KEY = "shithole.arcade.snek.hi";
export const SNEK_HI_EVENT = "shithole:snek-hi";

export function snekHighScore(): number {
  if (typeof localStorage === "undefined") return 0;
  const n = Number(localStorage.getItem(KEY) ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Returns true when the score is a new record (and persists it). */
export function saveSnekScore(score: number): boolean {
  if (score <= snekHighScore()) return false;
  localStorage.setItem(KEY, String(Math.floor(score)));
  // localStorage writes don't fire 'storage' in the SAME tab — the
  // cabinet's attract screen listens for this instead.
  window.dispatchEvent(new Event(SNEK_HI_EVENT));
  return true;
}
