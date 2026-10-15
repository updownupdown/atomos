// The daily puzzle on Play: one board a day, the same for every player. The day picks the game,
// its level and its deal; Monday deals the easiest level the game has and the week climbs to
// Sunday's hardest. Solving it extends a streak of days in a row.
// What the player has solved sits under its own storage key, apart from the save; the backup
// carries it with every other atomos.* key.
//
//   const d = dailyPuzzle();               // { key, game, dial, deal, level }
//   recordDaily(d.key, flawless);          // on a win at that board
//   dailyStreak()                          // { streak, today, best }

import { today } from '../home/daily';
import { PUZZLES } from './catalog';
import { difficultyLevel, levelInGame } from './difficulty';

const KEY = 'atomos.daily.v1';
/** Days kept in storage: enough for any streak a player can see, without growing forever. */
const KEEP = 400;

export interface DailyPuzzle {
  /** The day, "2026-10-15". */
  key: string;
  /** The game's id. */
  game: string;
  /** Its difficulty dial, 1 to 100. */
  dial: number;
  /** The deal number its generator is seeded with. */
  deal: number;
  /** The difficulty level, 1 to 5. */
  level: number;
}

/** A small seeded generator (mulberry32), so a day picks the same board on every device. */
function seeded(seed: number): () => number {
  let a = Math.imul(seed ^ 0x5bd1e995, 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The level a weekday aims at: Monday 1, Tuesday and Wednesday 2, Thursday and Friday 3,
 *  Saturday 4, Sunday 5 (index 0 is Sunday). */
const WEEK = [5, 1, 2, 2, 3, 3, 4];

/** The games the daily can pick: every playable game, in a fixed order. */
function games(): string[] {
  return PUZZLES.filter((p) => p.make && p.makeAt).map((p) => p.id).sort();
}

/** The puzzle for a day (its index in days since 1970, from today()). Games come round in a
 *  scattered order, no game twice in a row; the level is the weekday's, brought into the levels
 *  the game deals. */
export function dailyFor(index: number, key: string): DailyPuzzle {
  const ids = games();
  const n = ids.length;
  // A step prime to the count visits every game before any comes back.
  let step = 7;
  while (gcd(step, n) !== 1) step++;
  const game = ids[(((index * step) % n) + n) % n];
  const rnd = seeded(index);
  const reach = [1, 2, 3, 4, 5].filter((l) => levelInGame(game, l));
  const want = WEEK[(((index + 4) % 7) + 7) % 7];
  const level = reach.reduce((best, l) => (Math.abs(l - want) < Math.abs(best - want) ? l : best), reach[0] ?? 3);
  const span = levelInGame(game, level) ?? { lo: 30, hi: 30 };
  const dial = span.lo + Math.floor(rnd() * (span.hi - span.lo + 1));
  // Far from the deals the list hands out (#1, #2 ...), so the daily board is its own.
  const deal = 100000 + Math.floor(rnd() * 900000);
  return { key, game, dial, deal, level: difficultyLevel(dial) };
}

/** Today's puzzle. */
export function dailyPuzzle(now = new Date()): DailyPuzzle {
  const t = today(now);
  return dailyFor(t.index, t.key);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

interface Store { won: string[]; flawless: string[]; best: number }

function read(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Store> | null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    return { won: list(v?.won), flawless: list(v?.flawless), best: typeof v?.best === 'number' ? v.best : 0 };
  } catch {
    return { won: [], flawless: [], best: 0 };
  }
}

function write(s: Store): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage off: no streak kept */ }
}

/** The day before a "2026-10-15" key, as a key. */
function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** The streak: days in a row solved, up to today, or up to yesterday while today is still open
 *  (it breaks only once a whole day goes by unsolved). Also whether today is solved, flawless,
 *  and the best streak so far. */
export function dailyStreak(now = new Date()): { streak: number; today: boolean; flawless: boolean; best: number } {
  const s = read();
  const won = new Set(s.won);
  const key = today(now).key;
  let day = won.has(key) ? key : dayBefore(key);
  let streak = 0;
  while (won.has(day)) { streak++; day = dayBefore(day); }
  return { streak, today: won.has(key), flawless: s.flawless.includes(key), best: Math.max(s.best, streak) };
}

/** A win at a day's puzzle. Returns the streak after it. */
export function recordDaily(key: string, flawless: boolean, now = new Date()): number {
  const s = read();
  if (!s.won.includes(key)) s.won.push(key);
  if (flawless && !s.flawless.includes(key)) s.flawless.push(key);
  s.won = s.won.sort().slice(-KEEP);
  s.flawless = s.flawless.sort().slice(-KEEP);
  write(s);
  const { streak } = dailyStreak(now);
  if (streak > s.best) write({ ...s, best: streak });
  return streak;
}
