// Orbital Grid: a small Latin-square deduction with orbital labels.
//
// Fill the grid so every row, every column and every outlined region holds
// each symbol exactly once. Light elements play a 4x4 with the four orbital
// letters s, p, d, f. Heavier ones play a 6x6 (s, p, d, each with a spin-up and
// a spin-down mark) and the heaviest an 8x8 (s, p, d, f with both marks), so
// the symbol count always equals the side and the rules never change.
//
// Levels are built from a full random solution; givens are then removed one at
// a time, keeping each removal only while the grid can still be finished by
// plain singles (a cell with one possible symbol, or a symbol with one possible
// cell in a line or region). Finishing by forced steps alone means the solution
// is unique and nobody ever has to guess.
//
// Game rule, not physics: the symbols are orbital labels. A cell is not a place
// in the atom and nothing here says where an electron is.

import { randInt, seeded, type Rng } from './rng';

export const EMPTY = -1;
export const ORBITALS = ['s', 'p', 'd', 'f'] as const;
export type Orbital = (typeof ORBITALS)[number];

export interface GridSpec {
  size: number;
  /** Region height and width in cells. */
  rh: number;
  rw: number;
  /** Symbols carry a spin mark: symbol k is orbital k >> 1, up when k is even. */
  spin: boolean;
  /** How many cells the level aims to leave empty. */
  empties: number;
}

export interface OrbitalGridState {
  size: number;
  rh: number;
  rw: number;
  spin: boolean;
  solution: number[];
  /** True for the cells dealt filled; they never change. */
  givens: boolean[];
  /** The board: a symbol index or EMPTY, row-major. */
  cells: number[];
  /** Placements made; edits to the same cell in a row count once. Undo does not refund them. */
  moves: number;
  /** The cell edited last, so a run of edits to it counts as one placement. */
  lastCell: number;
  /** One placement per empty cell. */
  par: number;
}

/** Grid size and difficulty for an element: 4x4 through period 3, 6x6 for periods 4-5, 8x8 for 6-7. */
export function specFor(z: number): GridSpec {
  const t = (lo: number, hi: number) => Math.max(0, Math.min(1, (z - lo) / (hi - lo)));
  if (z <= 18) return { size: 4, rh: 2, rw: 2, spin: false, empties: 6 + Math.round(4 * t(1, 18)) };
  if (z <= 54) return { size: 6, rh: 2, rw: 3, spin: true, empties: 14 + Math.round(8 * t(19, 54)) };
  return { size: 8, rh: 2, rw: 4, spin: true, empties: 24 + Math.round(12 * t(55, 118)) };
}

/** What a symbol shows: its orbital letter and, on spin grids, its spin mark. */
export function symbolOf(spin: boolean, k: number): { orbital: Orbital; up: boolean | null } {
  if (!spin) return { orbital: ORBITALS[k], up: null };
  return { orbital: ORBITALS[k >> 1], up: (k & 1) === 0 };
}

export function cloneGrid(s: OrbitalGridState): OrbitalGridState {
  return { ...s, cells: [...s.cells] };
}

// ---- geometry ------------------------------------------------------------------------

/** Every unit (row, column, region) as a list of cell indices. */
export function units(size: number, rh: number, rw: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < size; r++) out.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++) out.push(Array.from({ length: size }, (_, r) => r * size + c));
  for (let br = 0; br < size; br += rh) {
    for (let bc = 0; bc < size; bc += rw) {
      const reg: number[] = [];
      for (let r = br; r < br + rh; r++) for (let c = bc; c < bc + rw; c++) reg.push(r * size + c);
      out.push(reg);
    }
  }
  return out;
}

export function regionOf(size: number, rh: number, rw: number, i: number): number {
  const r = Math.floor(i / size), c = i % size;
  return Math.floor(r / rh) * (size / rw) + Math.floor(c / rw);
}

/** For each cell, the other cells that share a unit with it. */
function peersOf(size: number, rh: number, rw: number): number[][] {
  const peers: Set<number>[] = Array.from({ length: size * size }, () => new Set<number>());
  for (const u of units(size, rh, rw)) for (const a of u) for (const b of u) if (a !== b) peers[a].add(b);
  return peers.map((p) => [...p]);
}

const peerCache = new Map<string, number[][]>();
function peers(size: number, rh: number, rw: number): number[][] {
  const key = `${size}:${rh}:${rw}`;
  let p = peerCache.get(key);
  if (!p) peerCache.set(key, (p = peersOf(size, rh, rw)));
  return p;
}

// ---- rules ---------------------------------------------------------------------------

/** Cells whose symbol also appears elsewhere in one of their units. */
export function conflicts(s: OrbitalGridState): boolean[] {
  const out = Array(s.cells.length).fill(false);
  const pe = peers(s.size, s.rh, s.rw);
  for (let i = 0; i < s.cells.length; i++) {
    if (s.cells[i] === EMPTY) continue;
    for (const j of pe[i]) if (s.cells[j] === s.cells[i]) { out[i] = true; break; }
  }
  return out;
}

export function filledCount(s: OrbitalGridState): number {
  return s.cells.reduce((n, v, i) => n + (v !== EMPTY && !s.givens[i] ? 1 : 0), 0);
}

export function solved(s: OrbitalGridState): boolean {
  return s.cells.every((v, i) => v === s.solution[i]);
}

/** Sets a cell (EMPTY clears it); null for a given or no change. */
export function place(s: OrbitalGridState, i: number, v: number): OrbitalGridState | null {
  if (i < 0 || i >= s.cells.length || s.givens[i] || s.cells[i] === v) return null;
  if (v !== EMPTY && (v < 0 || v >= s.size)) return null;
  const next = cloneGrid(s);
  next.cells[i] = v;
  if (s.lastCell !== i) next.moves = s.moves + 1;
  next.lastCell = i;
  return next;
}

/** The next symbol for a tap-to-cycle: empty, then each symbol in turn, then empty again. */
export function cycleValue(s: OrbitalGridState, i: number): number {
  const v = s.cells[i];
  return v === EMPTY ? 0 : v + 1 >= s.size ? EMPTY : v + 1;
}

// ---- solvers -------------------------------------------------------------------------

/**
 * Finishes a grid by singles alone (naked and hidden). Returns the filled grid,
 * or null if it stalls or hits a contradiction.
 */
export function solveBySingles(size: number, rh: number, rw: number, cells: number[]): number[] | null {
  const n = size * size;
  const full = (1 << size) - 1;
  const grid = [...cells];
  const pe = peers(size, rh, rw);
  const us = unitsCached(size, rh, rw);
  const cand: number[] = Array(n).fill(full);
  for (let i = 0; i < n; i++) {
    if (grid[i] === EMPTY) continue;
    for (const j of pe[i]) cand[j] &= ~(1 << grid[i]);
  }
  for (let i = 0; i < n; i++) if (grid[i] !== EMPTY && !(cand[i] & (1 << grid[i]))) return null;
  let left = grid.filter((v) => v === EMPTY).length;
  const set = (i: number, v: number): boolean => {
    grid[i] = v;
    left--;
    for (const j of pe[i]) {
      cand[j] &= ~(1 << v);
      if (grid[j] === EMPTY && !cand[j]) return false;
      if (grid[j] === v) return false;
    }
    return true;
  };
  while (left > 0) {
    let progress = false;
    for (let i = 0; i < n; i++) {
      if (grid[i] !== EMPTY) continue;
      const c = cand[i];
      if (c && !(c & (c - 1))) {
        if (!set(i, 31 - Math.clz32(c))) return null;
        progress = true;
      }
    }
    for (const u of us) {
      for (let v = 0; v < size; v++) {
        const bit = 1 << v;
        let where = -1, count = 0, present = false;
        for (const i of u) {
          if (grid[i] === v) { present = true; break; }
          if (grid[i] === EMPTY && cand[i] & bit) { where = i; count++; }
        }
        if (present) continue;
        if (count === 0) return null;
        if (count === 1) {
          if (!set(where, v)) return null;
          progress = true;
        }
      }
    }
    if (!progress) return null;
  }
  return grid;
}

const unitCache = new Map<string, number[][]>();
function unitsCached(size: number, rh: number, rw: number): number[][] {
  const key = `${size}:${rh}:${rw}`;
  let u = unitCache.get(key);
  if (!u) unitCache.set(key, (u = units(size, rh, rw)));
  return u;
}

/** Counts solutions by backtracking, stopping at `limit`. */
export function countSolutions(size: number, rh: number, rw: number, cells: number[], limit = 2): number {
  const grid = [...cells];
  const pe = peers(size, rh, rw);
  const full = (1 << size) - 1;
  const options = (i: number): number => {
    let m = full;
    for (const j of pe[i]) if (grid[j] !== EMPTY) m &= ~(1 << grid[j]);
    return m;
  };
  for (let i = 0; i < grid.length; i++) if (grid[i] !== EMPTY && !(options(i) & (1 << grid[i]))) return 0;
  let found = 0;
  const go = (): void => {
    if (found >= limit) return;
    let best = -1, bestMask = 0, bestCount = 99;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== EMPTY) continue;
      const m = options(i);
      let k = 0;
      for (let x = m; x; x &= x - 1) k++;
      if (k < bestCount) { best = i; bestMask = m; bestCount = k; if (k <= 1) break; }
    }
    if (best < 0) { found++; return; }
    for (let v = 0; v < size && found < limit; v++) {
      if (!(bestMask & (1 << v))) continue;
      grid[best] = v;
      go();
      grid[best] = EMPTY;
    }
  };
  go();
  return found;
}

// ---- generation ----------------------------------------------------------------------

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A random complete grid, by backtracking with shuffled symbol orders. */
export function randomSolution(rng: Rng, size: number, rh: number, rw: number): number[] {
  const grid: number[] = Array(size * size).fill(EMPTY);
  const pe = peers(size, rh, rw);
  const go = (i: number): boolean => {
    if (i === grid.length) return true;
    const used = new Set<number>();
    for (const j of pe[i]) if (grid[j] !== EMPTY) used.add(grid[j]);
    for (const v of shuffle(rng, Array.from({ length: size }, (_, k) => k))) {
      if (used.has(v)) continue;
      grid[i] = v;
      if (go(i + 1)) return true;
    }
    grid[i] = EMPTY;
    return false;
  };
  go(0);
  return grid;
}

/** Empties as many cells as the spec asks while the grid stays solvable by singles. */
function carve(rng: Rng, spec: GridSpec, solution: number[]): number[] {
  const cells = [...solution];
  let empties = 0;
  for (const i of shuffle(rng, Array.from({ length: cells.length }, (_, k) => k))) {
    if (empties >= spec.empties) break;
    const keep = cells[i];
    cells[i] = EMPTY;
    if (solveBySingles(spec.size, spec.rh, spec.rw, cells)) empties++;
    else cells[i] = keep;
  }
  return cells;
}

export function newOrbitalGrid(z: number, seed: number): OrbitalGridState {
  const rng = seeded(seed);
  const spec = specFor(z);
  let best: { solution: number[]; cells: number[]; empties: number } | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const solution = randomSolution(rng, spec.size, spec.rh, spec.rw);
    const cells = carve(rng, spec, solution);
    const empties = cells.filter((v) => v === EMPTY).length;
    if (!best || empties > best.empties) best = { solution, cells, empties };
    if (empties >= spec.empties) break;
  }
  const { solution, cells, empties } = best!;
  return {
    size: spec.size, rh: spec.rh, rw: spec.rw, spin: spec.spin,
    solution, givens: cells.map((v) => v !== EMPTY), cells,
    moves: 0, lastCell: -1, par: empties,
  };
}
