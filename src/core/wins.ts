// How many times each game has been won on this device, at each of the five difficulty levels
// (Very easy to Expert, two ratings each), and how many of those wins were flawless. The Puzzles
// home shows them for the game in focus. Also the dial each game was last played at and the
// games pinned to the top of that screen. Kept apart from the save, like the play counts:
// losing it only clears those tallies and choices.

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

/** Counts a win of this game on a board dealt at `dial` (1 to 100, see difficulty.ts), in its
 *  bucket; `flawless` when it was clean and on or under par. */
export function recordWin(game: string, dial: number, flawless: boolean): void {
  const all = read();
  const g = isRecord(all[game]) ? all[game] : {};
  const level = String(difficultyLevel(dial));
  const e: unknown = g[level];
  const [solved, clean] = Array.isArray(e) ? [count(e[0]), count(e[1])] : [0, 0];
  g[level] = [solved + 1, clean + (flawless ? 1 : 0)];
  all[game] = g;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage off: the win goes uncounted */ }
  // A first win can open something in the Atlas (src/gallery/earn.ts listens).
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atomos:win', { detail: { game } }));
}

const DIAL_KEY = 'atomos.dials.v1';

/** The difficulty dial (1 to 100) each game was last played or picked at on the Puzzles screen,
 *  so it opens there again. Null for a game not yet played there. */
export function lastDial(game: string): number | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DIAL_KEY) ?? '{}');
    const d = isRecord(v) ? v[game] : undefined;
    return typeof d === 'number' && Number.isFinite(d) ? Math.max(1, Math.min(100, Math.round(d))) : null;
  } catch {
    return null;
  }
}

/** Remembers the dial a game was last played or picked at. */
export function rememberDial(game: string, dial: number): void {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DIAL_KEY) ?? '{}');
    const all: Record<string, unknown> = isRecord(v) ? v : {};
    all[game] = Math.round(dial);
    localStorage.setItem(DIAL_KEY, JSON.stringify(all));
  } catch { /* storage off: the next visit opens at the default */ }
}

const PIN_KEY = 'atomos.pins.v1';

/** The games pinned to the top of the Puzzles screen (a long press pins or unpins one). */
export function pinnedGames(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/** Pins a game to the top of the Puzzles screen, or unpins it. */
export function setPinned(game: string, on: boolean): void {
  const now = pinnedGames().filter((g) => g !== game);
  if (on) now.push(game);
  try { localStorage.setItem(PIN_KEY, JSON.stringify(now)); } catch { /* storage off: the pin is not kept */ }
}
