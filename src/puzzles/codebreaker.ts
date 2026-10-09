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
  return { secret, rows: [], draft: Array(SLOTS).fill(EMPTY), moves: 0, par: 5 };
}
