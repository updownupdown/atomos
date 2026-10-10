// Codebreaker: a hidden sequence of four symbols drawn from six. Each guess
// earns clues: a filled dot per symbol in the right place, a hollow dot per
// right symbol in the wrong place. Ten guesses.

import { randInt, seeded } from './rng';

export const SYMBOLS = 6;
export const SLOTS = 4;
export const MAX_ROWS = 10;
export const EMPTY = -1;

export interface Row {
  guess: number[];
  exact: number;
  near: number;
}

export interface CodebreakerState {
  secret: number[];
  rows: Row[];
  /** The guess being typed; EMPTY where a slot is still blank. */
  draft: number[];
  moves: number;
  par: number;
  /** No symbol repeats in the code (below z 112), so a code that repeats one can't be it. */
  distinct: boolean;
}

export function cloneCodebreaker(s: CodebreakerState): CodebreakerState {
  return { ...s, secret: [...s.secret], rows: s.rows.map((r) => ({ ...r, guess: [...r.guess] })), draft: [...s.draft] };
}

/** The clue a guess earns against a secret. */
export function score(secret: number[], guess: number[]): { exact: number; near: number } {
  let exact = 0;
  const left = Array(SYMBOLS).fill(0), right = Array(SYMBOLS).fill(0);
  for (let i = 0; i < SLOTS; i++) {
    if (secret[i] === guess[i]) exact++;
    else { left[secret[i]]++; right[guess[i]]++; }
  }
  let near = 0;
  for (let k = 0; k < SYMBOLS; k++) near += Math.min(left[k], right[k]);
  return { exact, near };
}

export function solved(s: CodebreakerState): boolean {
  const last = s.rows[s.rows.length - 1];
  return !!last && last.exact === SLOTS;
}

export function stuck(s: CodebreakerState): boolean {
  return !solved(s) && s.rows.length >= MAX_ROWS;
}

export function draftComplete(s: CodebreakerState): boolean {
  return s.draft.every((d) => d !== EMPTY);
}

export function setSlot(s: CodebreakerState, slot: number, symbol: number): CodebreakerState {
  const next = cloneCodebreaker(s);
  next.draft[slot] = symbol;
  return next;
}

/** Steps a slot to the next symbol, from blank to the first. */
export function cycleSlot(s: CodebreakerState, slot: number, step = 1): CodebreakerState {
  const cur = s.draft[slot];
  const sym = cur === EMPTY ? (step > 0 ? 0 : SYMBOLS - 1) : (((cur + step) % SYMBOLS) + SYMBOLS) % SYMBOLS;
  return setSlot(s, slot, sym);
}

/** Submits the draft as a row; null when the draft is incomplete or the game is over. */
export function submit(s: CodebreakerState): CodebreakerState | null {
  if (!draftComplete(s) || solved(s) || stuck(s)) return null;
  const next = cloneCodebreaker(s);
  next.rows.push({ guess: [...s.draft], ...score(s.secret, s.draft) });
  next.draft = Array(SLOTS).fill(EMPTY);
  next.moves += 1;
  return next;
}

/** True when a guess is consistent with every clue so far. */
export function consistent(s: CodebreakerState, guess: number[]): boolean {
  return s.rows.every((r) => {
    const sc = score(guess, r.guess);
    return sc.exact === r.exact && sc.near === r.near;
  });
}

// ---- help ------------------------------------------------------------------------------

/** Every code there is, in order: 6^4 of them. */
const ALL_CODES: number[][] = Array.from({ length: SYMBOLS ** SLOTS }, (_, n) =>
  Array.from({ length: SLOTS }, (_, k) => Math.floor(n / SYMBOLS ** (SLOTS - 1 - k)) % SYMBOLS));

/** Every code that fits all the clues so far, and the no-repeat rule where it holds. */
export function candidates(s: CodebreakerState): number[][] {
  return ALL_CODES.filter((c) => (!s.distinct || new Set(c).size === SLOTS) && consistent(s, c));
}

/** What the clues decide, from the codes that still fit: which symbols each slot can hold. */
export function decided(codes: number[][]): { can: boolean[][]; fixed: number[]; inCode: boolean[]; outCode: boolean[] } {
  const can = Array.from({ length: SLOTS }, () => Array(SYMBOLS).fill(false));
  const every = Array(SYMBOLS).fill(true);
  for (const c of codes) {
    c.forEach((k, slot) => (can[slot][k] = true));
    for (let k = 0; k < SYMBOLS; k++) if (!c.includes(k)) every[k] = false;
  }
  const fixed = can.map((row) => (row.filter(Boolean).length === 1 ? row.indexOf(true) : EMPTY));
  const outCode = Array.from({ length: SYMBOLS }, (_, k) => can.every((row) => !row[k]));
  return { can, fixed, inCode: codes.length ? every : Array(SYMBOLS).fill(false), outCode };
}

/** Clue checks one Show me may spend weighing guesses: guesses weighed times codes that fit. */
const WEIGH = 40000;

/** score() as one number, exact * 5 + near, with no allocation: the inner loop of bestGuess. */
const tally = new Int8Array(SYMBOLS * 2);
function scoreKey(secret: number[], guess: number[]): number {
  tally.fill(0);
  let exact = 0;
  for (let i = 0; i < SLOTS; i++) {
    if (secret[i] === guess[i]) exact++;
    else { tally[secret[i]]++; tally[SYMBOLS + guess[i]]++; }
  }
  let near = 0;
  for (let k = 0; k < SYMBOLS; k++) near += Math.min(tally[k], tally[SYMBOLS + k]);
  return exact * (SLOTS + 1) + near;
}

/**
 * The guess Show me plays: a code that fits every clue, keeping as many of the
 * draft's filled slots as any such code can, and of those the one whose worst
 * clue leaves the fewest codes standing (Knuth's rule, among codes that fit).
 * With many codes left only an even spread of them is weighed. Ties go to the
 * earlier code. Null when no code fits (never on a dealt game).
 */
export function bestGuess(s: CodebreakerState, codes = candidates(s)): number[] | null {
  if (!codes.length) return null;
  const kept = (c: number[]) => c.filter((k, slot) => s.draft[slot] === k).length;
  let most = 0;
  for (const c of codes) most = Math.max(most, kept(c));
  const pool = codes.filter((c) => kept(c) === most);
  const step = Math.max(1, pool.length / Math.max(1, Math.floor(WEIGH / codes.length)));
  const groups = new Int32Array((SLOTS + 1) * (SLOTS + 1));
  let best: number[] | null = null, bestWorst = Infinity;
  for (let x = 0; x < pool.length; x += step) {
    const g = pool[Math.floor(x)];
    groups.fill(0);
    let worst = 0;
    for (const c of codes) worst = Math.max(worst, ++groups[scoreKey(c, g)]);
    if (worst < bestWorst) { best = g; bestWorst = worst; }
  }
  return best;
}

export function newCodebreaker(z: number, seed: number): CodebreakerState {
  const rng = seeded(seed);
  // Light elements get four different symbols; the heaviest may repeat one.
  const repeats = z >= 112;
  const secret: number[] = [];
  while (secret.length < SLOTS) {
    const k = randInt(rng, SYMBOLS);
    if (!repeats && secret.includes(k)) continue;
    secret.push(k);
  }
  return { secret, rows: [], draft: Array(SLOTS).fill(EMPTY), moves: 0, par: 5, distinct: !repeats };
}
