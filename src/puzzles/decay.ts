// Decay Path: walk a radioactive nucleus down the chart of nuclides to a stable one.
//
// A small window of the N–Z chart: neutron count across, proton count up. Known
// nuclides are tiles, stable ones solid. A droplet sits on the starting nucleus
// and can take one of three steps, each only onto a known nuclide: alpha
// (two protons and two neutrons fewer), beta-minus (a neutron becomes a proton),
// beta-plus or electron capture (a proton becomes a neutron). Land on any
// stable tile.
//
// Game rule, not physics: a real nucleus has its own decay mode and gives the
// player no choice. The three step shapes are the real ones, and the tiles are
// the real known nuclides; the choice at each tile is the game.

import { ELEMENTS } from '../gallery/data';
import { pick, seeded, type Rng } from './rng';

export const COLS = 9;
export const ROWS = 7;

export type CellKind = 'none' | 'unstable' | 'stable';

export interface Nuclide {
  z: number;
  n: number;
}

export type DecayMove = 'alpha' | 'betaMinus' | 'betaPlus';

export const MOVES: DecayMove[] = ['alpha', 'betaMinus', 'betaPlus'];

/** Change in (z, n) for each step. */
export const DELTA: Record<DecayMove, Nuclide> = {
  alpha: { z: -2, n: -2 },
  betaMinus: { z: 1, n: -1 },
  betaPlus: { z: -1, n: 1 },
};

export const MOVE_LABEL: Record<DecayMove, string> = { alpha: 'α', betaMinus: 'β⁻', betaPlus: 'β⁺' };

export interface DecayState {
  /** Proton count of the bottom row and neutron count of the left column. */
  z0: number;
  n0: number;
  /** cells[row][col]: row 0 is z0, col 0 is n0. */
  cells: CellKind[][];
  start: Nuclide;
  pos: Nuclide;
  /** Every nuclide visited, the start first. */
  path: Nuclide[];
  moves: number;
  par: number;
}

export function cloneDecay(s: DecayState): DecayState {
  return { ...s, cells: s.cells.map((r) => [...r]), start: { ...s.start }, pos: { ...s.pos }, path: s.path.map((p) => ({ ...p })) };
}

export function cellAt(s: DecayState, q: Nuclide): CellKind {
  const r = q.z - s.z0, c = q.n - s.n0;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 'none';
  return s.cells[r][c];
}

export function solved(s: DecayState): boolean {
  return cellAt(s, s.pos) === 'stable';
}

export function destination(q: Nuclide, m: DecayMove): Nuclide {
  return { z: q.z + DELTA[m].z, n: q.n + DELTA[m].n };
}

/** The steps the droplet can take from where it is, in the fixed order alpha, beta-minus, beta-plus. */
export function allowedMoves(s: DecayState, from: Nuclide = s.pos): DecayMove[] {
  return MOVES.filter((m) => cellAt(s, destination(from, m)) !== 'none');
}

/** Takes a step; null when it leaves the known nuclides or the puzzle is already solved. */
export function applyDecay(s: DecayState, m: DecayMove): DecayState | null {
  if (solved(s)) return null;
  const to = destination(s.pos, m);
  if (cellAt(s, to) === 'none') return null;
  const next = cloneDecay(s);
  next.pos = to;
  next.path.push({ ...to });
  next.moves += 1;
  return next;
}

/** True when the droplet has nowhere left to step and is not on a stable tile. */
export function stuck(s: DecayState): boolean {
  return !solved(s) && allowedMoves(s).length === 0;
}

/** Shortest sequence of steps from a nuclide to any stable tile, or null when none exists. */
export function shortestPath(s: DecayState, from: Nuclide = s.pos): DecayMove[] | null {
  const key = (q: Nuclide) => q.z * 1000 + q.n;
  const prev = new Map<number, { from: number; move: DecayMove } | null>();
  const queue: Nuclide[] = [from];
  prev.set(key(from), null);
  while (queue.length) {
    const q = queue.shift()!;
    if (cellAt(s, q) === 'stable') {
      const out: DecayMove[] = [];
      let k = key(q);
      for (;;) {
        const p = prev.get(k);
        if (!p) break;
        out.unshift(p.move);
        k = p.from;
      }
      return out;
    }
    for (const m of allowedMoves(s, q)) {
      const d = destination(q, m);
      if (prev.has(key(d))) continue;
      prev.set(key(d), { from: key(q), move: m });
      queue.push(d);
    }
  }
  return null;
}

// ---- generation ---------------------------------------------------------------------

function kindOf(z: number, n: number): CellKind {
  const el = ELEMENTS[z - 1];
  if (!el) return 'none';
  const iso = el.isotopes.find((i) => i.a === z + n);
  if (!iso) return 'none';
  return iso.stable ? 'stable' : 'unstable';
}

/** Shortest walk from a nuclide to a stable one over the whole known chart, at most `limit` steps; null when none. */
function chartPath(start: Nuclide, limit: number): Nuclide[] | null {
  const key = (q: Nuclide) => q.z * 1000 + q.n;
  const prev = new Map<number, number | null>();
  const depth = new Map<number, number>();
  const queue: Nuclide[] = [start];
  prev.set(key(start), null);
  depth.set(key(start), 0);
  while (queue.length) {
    const q = queue.shift()!;
    if (kindOf(q.z, q.n) === 'stable') {
      const out: Nuclide[] = [];
      for (let k: number | null | undefined = key(q); k != null; k = prev.get(k)) out.unshift({ z: Math.floor(k / 1000), n: k % 1000 });
      return out;
    }
    const d = depth.get(key(q))!;
    if (d >= limit) continue;
    for (const m of MOVES) {
      const to = destination(q, m);
      if (to.z < 1 || to.n < 0 || prev.has(key(to)) || kindOf(to.z, to.n) === 'none') continue;
      prev.set(key(to), key(q));
      depth.set(key(to), d + 1);
      queue.push(to);
    }
  }
  return null;
}

/** The window that holds every nuclide of a walk, centred on it; null when the walk does not fit. */
function windowFor(walk: Nuclide[]): DecayState | null {
  const zs = walk.map((q) => q.z), ns = walk.map((q) => q.n);
  const zMin = Math.min(...zs), zMax = Math.max(...zs), nMin = Math.min(...ns), nMax = Math.max(...ns);
  if (zMax - zMin >= ROWS || nMax - nMin >= COLS) return null;
  const z0 = Math.max(1, Math.round((zMin + zMax) / 2) - Math.floor(ROWS / 2));
  const n0 = Math.max(0, Math.round((nMin + nMax) / 2) - Math.floor(COLS / 2));
  const cells: CellKind[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: CellKind[] = [];
    for (let c = 0; c < COLS; c++) row.push(kindOf(z0 + r, n0 + c));
    cells.push(row);
  }
  const start = { ...walk[0] };
  return { z0, n0, cells, start, pos: { ...start }, path: [{ ...start }], moves: 0, par: 0 };
}

/** Every unstable nuclide of an element whose shortest walk to a stable tile is 2–6 steps and fits a window. */
function candidates(z: number): { state: DecayState; len: number }[] {
  const el = ELEMENTS[z - 1];
  if (!el) return [];
  const out: { state: DecayState; len: number }[] = [];
  for (const iso of el.isotopes) {
    if (iso.stable) continue;
    const n = iso.a - z;
    if (n < 0) continue;
    const walk = chartPath({ z, n }, 6);
    if (!walk || walk.length < 3) continue;
    const state = windowFor(walk);
    if (!state) continue;
    const path = shortestPath(state);
    if (!path || path.length < 2 || path.length > 6) continue;
    out.push({ state, len: path.length });
  }
  return out;
}

/** How long a walk the element deserves: two steps for the light elements, up to five for the heaviest. */
export function targetLength(z: number): number {
  return 2 + Math.min(3, Math.floor((z - 1) / 30));
}

/**
 * A level for element z. The start is one of z's unstable nuclides whose
 * shortest walk is 2–6 steps and fits the window; when z has none, the nearest
 * element that does lends its chart.
 */
export function newDecay(z: number, seed: number): DecayState {
  const rng: Rng = seeded(seed);
  const want = targetLength(z);
  // Gather starts from z and its neighbours, nearest first, until one offers the wanted length.
  const pool: { state: DecayState; len: number; dist: number }[] = [];
  let lent = 0;
  for (let d = 0; d < ELEMENTS.length && lent < 4; d++) {
    for (const zz of d === 0 ? [z] : [z - d, z + d]) {
      if (zz < 1 || zz > ELEMENTS.length) continue;
      const cs = candidates(zz);
      if (!cs.length) continue;
      lent++;
      for (const c of cs) pool.push({ ...c, dist: d });
    }
    if (pool.some((c) => c.len === want)) break;
  }
  if (!pool.length) throw new Error('no decay level possible');
  const score = (c: { len: number; dist: number }) => Math.abs(c.len - want) * 100 + c.dist;
  const best = Math.min(...pool.map(score));
  const chosen = pick(rng, pool.filter((c) => score(c) === best));
  return { ...chosen.state, par: chosen.len };
}

export const symbolOf = (z: number): string => ELEMENTS[z - 1]?.symbol ?? '?';
