// Rutherford Probe: find the hidden nuclei by probing the cells around them.
//
// A square plate hides a scatter of nuclei. Probing a cell reveals what it
// detects: normally the number of nuclei in the eight cells around it. Two
// kinds of cell bend that rule. A scatter cell (drawn with outward ticks)
// counts every nucleus in its whole row and column instead. A quiet cell shows
// only "?" and gives no count. Probing a nucleus is a direct hit: it is shown
// and counted against a flawless run, but play goes on. Probe every empty cell
// to win; marks are only notes.
//
// Every plate opens with a region already probed and is checked by a
// constraint solver that finishes it from there without ever guessing: each
// step follows from a single clue (all of its unknowns safe, or all nuclei),
// from comparing two overlapping clues, or from the count of nuclei left.
//
// Game rule, not physics: Rutherford found the nucleus from how alpha particles
// scattered off gold foil, not by probing a grid. The idea, mapping something
// unseen from what probes report, is his.

import { rand, randInt, seeded, type Rng } from './rng';

export type CellKind = 'plain' | 'scatter' | 'quiet';

export interface RutherfordState {
  size: number;
  nuclei: boolean[];
  /** What a safe cell reports once probed; nuclei are 'plain'. */
  kind: CellKind[];
  /** The count each safe cell reports (unused for quiet cells). */
  clue: number[];
  probed: boolean[];
  marked: boolean[];
  /** Nuclei probed by mistake. Undo does not take one back. */
  hits: number;
  /** Probe actions, including ones that opened several cells. */
  moves: number;
  total: number;
}

export function cloneRutherford(s: RutherfordState): RutherfordState {
  return { ...s, probed: [...s.probed], marked: [...s.marked] };
}

// ---- geometry ------------------------------------------------------------------------

export function neighbours(size: number, i: number): number[] {
  const r = Math.floor(i / size), c = i % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
    }
  }
  return out;
}

/** Every other cell in the same row and column. */
export function cross(size: number, i: number): number[] {
  const r = Math.floor(i / size), c = i % size;
  const out: number[] = [];
  for (let k = 0; k < size; k++) {
    if (k !== c) out.push(r * size + k);
    if (k !== r) out.push(k * size + c);
  }
  return out;
}

/** The cells a probed cell's count covers. */
export function scope(s: Pick<RutherfordState, 'size' | 'kind'>, i: number): number[] {
  return s.kind[i] === 'scatter' ? cross(s.size, i) : neighbours(s.size, i);
}

// ---- rules ---------------------------------------------------------------------------

/** Probes a cell; a count of zero opens everything it covers, and so on. Null if nothing changes. */
export function probe(s: RutherfordState, i: number): RutherfordState | null {
  if (i < 0 || i >= s.nuclei.length || s.probed[i] || s.marked[i]) return null;
  const next = cloneRutherford(s);
  next.moves = s.moves + 1;
  open(next, [i]);
  return next;
}

function open(s: RutherfordState, cells: number[]): void {
  const queue = [...cells];
  while (queue.length) {
    const i = queue.pop()!;
    if (s.probed[i]) continue;
    s.probed[i] = true;
    s.marked[i] = false;
    if (s.nuclei[i]) { s.hits++; continue; }
    if (s.kind[i] !== 'quiet' && s.clue[i] === 0) for (const j of scope(s, i)) if (!s.probed[j] && !s.marked[j]) queue.push(j);
  }
}

export function toggleMark(s: RutherfordState, i: number): RutherfordState | null {
  if (i < 0 || i >= s.nuclei.length || s.probed[i]) return null;
  const next = cloneRutherford(s);
  next.marked[i] = !s.marked[i];
  return next;
}

/**
 * On a probed cell whose count is already met by marks, probes everything
 * else it covers. Null when the marks do not match the count.
 */
export function chord(s: RutherfordState, i: number): RutherfordState | null {
  if (!s.probed[i] || s.nuclei[i] || s.kind[i] === 'quiet') return null;
  const sc = scope(s, i);
  const known = sc.filter((j) => s.marked[j] || (s.probed[j] && s.nuclei[j])).length;
  const rest = sc.filter((j) => !s.probed[j] && !s.marked[j]);
  if (known !== s.clue[i] || !rest.length) return null;
  const next = cloneRutherford(s);
  next.moves = s.moves + 1;
  open(next, rest);
  return next;
}

export function solved(s: RutherfordState): boolean {
  return s.nuclei.every((n, i) => n || s.probed[i]);
}

/** Nuclei not yet marked or found. */
export function remaining(s: RutherfordState): number {
  let n = s.total;
  for (let i = 0; i < s.nuclei.length; i++) if (s.marked[i] || (s.probed[i] && s.nuclei[i])) n--;
  return n;
}

// ---- the no-guess solver ---------------------------------------------------------------

interface Constraint {
  cells: number[];
  need: number;
}

/**
 * Plays the plate by deduction alone from its current state, probing every
 * cell it can prove safe. Returns the state it reached; it is finished when
 * `solved` holds. Deductions: a clue whose unknowns must be all safe or all
 * nuclei; two overlapping clues compared; the total count of nuclei.
 */
export function deduce(start: RutherfordState): { state: RutherfordState; steps: number } {
  const s = cloneRutherford(start);
  const n = s.nuclei.length;
  // The solver's own knowledge of nuclei: probed hits and nuclei it proved.
  const nucleus = s.nuclei.map((x, i) => x && s.probed[i]);
  let steps = 0;
  for (;;) {
    if (solved(s)) break;
    const unknown = (j: number) => !s.probed[j] && !nucleus[j];
    const cons: Constraint[] = [];
    for (let i = 0; i < n; i++) {
      if (!s.probed[i] || s.nuclei[i] || s.kind[i] === 'quiet') continue;
      const sc = scope(s, i);
      const cells = sc.filter(unknown);
      if (!cells.length) continue;
      cons.push({ cells, need: s.clue[i] - sc.filter((j) => nucleus[j]).length });
    }
    const all: number[] = [];
    let found = 0;
    for (let j = 0; j < n; j++) { if (unknown(j)) all.push(j); if (nucleus[j]) found++; }
    cons.push({ cells: all, need: s.total - found });

    const safe = new Set<number>(), hot = new Set<number>();
    const judge = (cells: number[], lo: number, hi: number) => {
      if (!cells.length) return;
      if (hi <= 0) for (const j of cells) safe.add(j);
      else if (lo >= cells.length) for (const j of cells) hot.add(j);
    };
    for (const c of cons) judge(c.cells, c.need, c.need);
    if (!safe.size && !hot.size) {
      const inA = new Uint8Array(n);
      for (let a = 0; a < cons.length && !safe.size && !hot.size; a++) {
        const A = cons[a];
        for (const j of A.cells) inA[j] = 1;
        for (let b = 0; b < cons.length; b++) {
          if (a === b) continue;
          const B = cons[b];
          let both = 0;
          const bOnly: number[] = [];
          for (const j of B.cells) { if (inA[j]) both++; else bOnly.push(j); }
          if (!both) continue;
          const aOnly = A.cells.length - both;
          const maxI = Math.min(A.need, B.need, both);
          const minI = Math.max(0, A.need - aOnly, B.need - bOnly.length);
          judge(bOnly, B.need - maxI, B.need - minI);
          if (safe.size || hot.size) break;
        }
        for (const j of A.cells) inA[j] = 0;
      }
    }
    if (!safe.size && !hot.size) break;
    for (const j of hot) nucleus[j] = true;
    if (safe.size) open(s, [...safe]);
    steps++;
  }
  return { state: s, steps };
}

// ---- generation ----------------------------------------------------------------------

export interface PlateSpec {
  size: number;
  nuclei: number;
  /** Shares of the safe cells that are scatter and quiet cells. */
  scatter: number;
  quiet: number;
}

export function specFor(z: number): PlateSpec {
  const t = Math.max(0, Math.min(1, (z - 1) / 117));
  const size = z <= 20 ? 7 : z <= 50 ? 8 : z <= 85 ? 9 : 10;
  const density = 0.15 + 0.05 * t;
  return { size, nuclei: Math.round(size * size * density), scatter: 0.06 + 0.06 * t, quiet: 0.04 + 0.06 * t };
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(rng: Rng, spec: PlateSpec): { state: RutherfordState; start: number } {
  const { size } = spec;
  const n = size * size;
  // The opening probe sits away from the rim and has no nucleus around it.
  const start = (1 + randInt(rng, size - 2)) * size + 1 + randInt(rng, size - 2);
  const clear = new Set([start, ...neighbours(size, start)]);
  const nuclei = Array(n).fill(false);
  for (const i of shuffle(rng, Array.from({ length: n }, (_, k) => k)).filter((i) => !clear.has(i)).slice(0, spec.nuclei)) nuclei[i] = true;
  const kind: CellKind[] = Array(n).fill('plain');
  for (let i = 0; i < n; i++) {
    if (nuclei[i] || i === start) continue;
    const r = rand(rng);
    if (r < spec.scatter) kind[i] = 'scatter';
    else if (r < spec.scatter + spec.quiet && !clear.has(i)) kind[i] = 'quiet';
  }
  const base = { size, kind };
  const clue = nuclei.map((_, i) => scope(base, i).filter((j) => nuclei[j]).length);
  const state: RutherfordState = {
    size, nuclei, kind, clue,
    probed: Array(n).fill(false), marked: Array(n).fill(false),
    hits: 0, moves: 0, total: spec.nuclei,
  };
  open(state, [start]);
  return { state, start };
}

export function newRutherford(z: number, seed: number): RutherfordState {
  const rng = seeded(seed);
  const spec = specFor(z);
  // Among deals the solver finishes unaided, keep the one with the smallest opening.
  const safeCells = spec.size * spec.size - spec.nuclei;
  let best: { state: RutherfordState; left: number; opened: number } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { state } = deal(rng, spec);
    const end = deduce(state).state;
    const left = end.nuclei.filter((x, i) => !x && !end.probed[i]).length;
    const opened = state.probed.filter(Boolean).length;
    if (!best || left < best.left || (left === best.left && opened < best.opened)) best = { state, left, opened };
    if (left === 0 && opened <= safeCells * 0.3) break;
  }
  if (best!.left === 0) return best!.state;
  // No clean deal: open one more safe cell wherever the solver stalls until it finishes.
  const state = best!.state;
  for (;;) {
    const end = deduce(state).state;
    if (solved(end)) return state;
    const frontier: number[] = [];
    for (let i = 0; i < state.nuclei.length; i++) {
      if (state.nuclei[i] || end.probed[i]) continue;
      if (neighbours(state.size, i).some((j) => end.probed[j])) frontier.push(i);
    }
    const pool = frontier.length ? frontier : state.nuclei.map((x, i) => (!x && !end.probed[i] ? i : -1)).filter((i) => i >= 0);
    open(state, [pool[randInt(rng, pool.length)]]);
  }
}
