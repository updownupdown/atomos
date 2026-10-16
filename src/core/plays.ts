// How many times each puzzle has been started, on this device. A game's rules card opens by
// itself on its first play, and its one-line goal leads the status line for the first three.
// Kept apart from the save: losing it only shows the rules once more.

import { noteRecent } from './recent';

const KEY = 'atomos.plays.v1';

function read(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Times this game has been started before. */
export function playsOf(game: string): number {
  const n = read()[game];
  return Number.isFinite(n) ? n : 0;
}

/** Counts a new start of this game; returns how many there had been before it. */
export function countPlay(game: string): number {
  const all = read();
  const before = Number.isFinite(all[game]) ? all[game] : 0;
  all[game] = before + 1;
  noteRecent({ kind: 'game', id: game });
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    localStorage.setItem(LAST_KEY, game);
  } catch { /* storage off: rules show again */ }
  return before;
}

const LAST_KEY = 'atomos.lastplay.v1';

/** The game started most recently, for Home's Play card; null before any. */
export function lastPlayed(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

/** How many plays lead with the goal line. */
export const GOAL_PLAYS = 3;
