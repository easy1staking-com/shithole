/**
 * Arcade high scores — localStorage + a same-tab change event, one slot
 * per game. (Keys keep the original "shithole.arcade.<game>.hi" shape,
 * so SNEK scores from the single-game era survive.)
 */

export type ArcadeGame = "snek" | "flappy";

export const ARCADE_HI_EVENT = "shithole:arcade-hi";

function key(game: ArcadeGame): string {
  return `shithole.arcade.${game}.hi`;
}

export function highScore(game: ArcadeGame): number {
  if (typeof localStorage === "undefined") return 0;
  const n = Number(localStorage.getItem(key(game)) ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Returns true when the score is a new record (and persists it). */
export function saveScore(game: ArcadeGame, score: number): boolean {
  if (score <= highScore(game)) return false;
  localStorage.setItem(key(game), String(Math.floor(score)));
  // Same-tab localStorage writes don't fire 'storage' — cabinets'
  // attract screens listen for this instead.
  window.dispatchEvent(new Event(ARCADE_HI_EVENT));
  return true;
}
