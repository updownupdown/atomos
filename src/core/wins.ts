// How many times each game has been won on this device, at each of the five difficulty levels
// (Very easy to Expert, two ratings each), and how many of those wins were flawless. The Puzzles
// home shows them under each game. Kept apart from the save, like the play counts: losing it
// only clears those tallies.

import { difficultyLevel, LEVELS } from '../puzzles/difficulty';

const KEY = 'atomos.wins.v1';

/** One level's tally. */
export interface LevelWins {
  solved: number;
  flawless: number;
}

/** Stored as { game: { level: [solved, flawless] } }, levels "1" to "5". */
type Store = Record<string, Record<string, [number, number]>>;

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function read(): Store {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return isRecord(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

/** A game's wins at each level: index 0 is level 1 (Very easy), index 4 level 5 (Expert). */
export function winsOf(game: string): LevelWins[] {
  const g = read()[game];
  return Array.from({ length: LEVELS }, (_, i) => {
    const e: unknown = isRecord(g) ? g[String(i + 1)] : undefined;
    return Array.isArray(e) ? { solved: count(e[0]), flawless: count(e[1]) } : { solved: 0, flawless: 0 };
  });
}

/** Counts a win of this game on a board rated `rating` (1 to 10, see difficulty.ts); `flawless`
 *  when it was clean and on or under par. */
export function recordWin(game: string, rating: number, flawless: boolean): void {
  const all = read();
  const g = isRecord(all[game]) ? all[game] : {};
  const level = String(difficultyLevel(rating));
  const e: unknown = g[level];
  const [solved, clean] = Array.isArray(e) ? [count(e[0]), count(e[1])] : [0, 0];
  g[level] = [solved + 1, clean + (flawless ? 1 : 0)];
  all[game] = g;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage off: the win goes uncounted */ }
}
