// Colour Charge: bind quarks into colour-neutral particles until the grid is clear.
//
// Every tile is a quark carrying one of three colour charges (red, green,
// blue), or, on heavier levels, an antiquark carrying an anticolour. Three
// orthogonally connected quarks holding one of each colour bind into a baryon;
// a quark next to an antiquark of its own colour binds into a meson. Bound
// tiles turn white. Clear the whole grid.
//
// Levels are dealt by tiling the grid into connected triominoes (and, on
// heavier levels, dominoes), then colouring each triomino red, green and blue
// in random order and each domino as a colour plus its anticolour, so a full
// clearance always exists. Deals are kept only when that clearance is the only
// one, so every grid has exactly one answer.
//
// Game rule, not physics: colour charge has nothing to do with visible colour,
// and quarks do not sit on a grid. The rule that only colour-neutral
// combinations exist on their own is the real one.

import { randInt, seeded, type Rng } from './rng';

export type Colour = 0 | 1 | 2;
export const COLOUR_NAMES = ['red', 'green', 'blue'] as const;
export const COLOUR_LETTERS = ['r', 'g', 'b'] as const;

export interface Quark {
  colour: Colour;
  /** An antiquark, carrying the anticolour. */
  anti: boolean;
}

export interface ColourChargeState {
  cols: number;
  rows: number;
  tiles: Quark[];
  /** For each tile, the index of the bound group it belongs to, or -1. */
  bound: number[];
  /** Bound groups in the order they were made. */
  groups: number[][];
  /** The tiling the level was dealt from: one clearance that works. */
  solution: number[][];
  /** Groups bound so far; undo takes them back. */
  moves: number;
  /** The number of groups in a full clearance. */
  par: number;
}

export interface ChargeSpec {
  cols: number;
  rows: number;
  /** Quark-antiquark pairs in the dealt tiling. */
  mesons: number;
}

export function specFor(z: number): ChargeSpec {
  if (z <= 10) return { cols: 3, rows: 3, mesons: 0 };
  if (z <= 30) return { cols: 4, rows: 3, mesons: 0 };
  if (z <= 54) return { cols: 4, rows: 4, mesons: 2 };
  if (z <= 86) return { cols: 4, rows: 5, mesons: 4 };
  return { cols: 5, rows: 5, mesons: 5 };
}

export function cloneCharge(s: ColourChargeState): ColourChargeState {
  return { ...s, bound: [...s.bound], groups: s.groups.map((g) => [...g]) };
}

// ---- shapes --------------------------------------------------------------------------

/**
 * Every connected group of two or three cells, as row/column offsets from its
 * first cell in reading order, so a group anchored at the first free cell
 * never reaches back over cells before it.
 */
const TRIOMINOES: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [1, -1]],
];
const DOMINOES: [number, number][][] = [
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
];

function placeShape(cols: number, rows: number, taken: (i: number) => boolean, anchor: number, shape: [number, number][]): number[] | null {
  const r0 = Math.floor(anchor / cols), c0 = anchor % cols;
  const cells: number[] = [];
  for (const [dr, dc] of shape) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    const i = r * cols + c;
    if (taken(i)) return null;
    cells.push(i);
  }
  return cells;
}

// ---- rules ---------------------------------------------------------------------------

export function adjacent(cols: number, a: number, b: number): boolean {
  const ra = Math.floor(a / cols), ca = a % cols, rb = Math.floor(b / cols), cb = b % cols;
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

function connected(cols: number, cells: number[]): boolean {
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of cells) if (!seen.has(b) && adjacent(cols, a, b)) { seen.add(b); queue.push(b); }
  }
  return seen.size === cells.length;
}

/** What a set of tiles would bind into, if anything. */
export function groupKind(tiles: Quark[], cells: number[]): 'baryon' | 'antibaryon' | 'meson' | null {
  if (cells.length === 3) {
    const q = cells.map((i) => tiles[i]);
    if (q[0].anti !== q[1].anti || q[1].anti !== q[2].anti) return null;
    if (new Set(q.map((x) => x.colour)).size !== 3) return null;
    return q[0].anti ? 'antibaryon' : 'baryon';
  }
  if (cells.length === 2) {
    const [a, b] = cells.map((i) => tiles[i]);
    return a.anti !== b.anti && a.colour === b.colour ? 'meson' : null;
  }
  return null;
}

/** True when the cells are free, distinct, connected and colour-neutral. */
export function canBind(s: ColourChargeState, cells: number[]): boolean {
  if (new Set(cells).size !== cells.length) return false;
  if (cells.some((i) => i < 0 || i >= s.tiles.length || s.bound[i] >= 0)) return false;
  return groupKind(s.tiles, cells) !== null && connected(s.cols, cells);
}

export function bind(s: ColourChargeState, cells: number[]): ColourChargeState | null {
  if (!canBind(s, cells)) return null;
  const next = cloneCharge(s);
  const id = next.groups.length;
  next.groups.push([...cells]);
  for (const i of cells) next.bound[i] = id;
  next.moves = s.moves + 1;
  return next;
}

export function solved(s: ColourChargeState): boolean {
  return s.bound.every((g) => g >= 0);
}

/** True when the free tiles can still all be bound. */
export function canFinish(s: ColourChargeState): boolean {
  const { cols, rows, tiles } = s;
  const used = s.bound.map((g) => g >= 0);
  const go = (): boolean => {
    const first = used.indexOf(false);
    if (first < 0) return true;
    for (const shape of [...TRIOMINOES, ...DOMINOES]) {
      const cells = placeShape(cols, rows, (i) => used[i], first, shape);
      if (!cells || !groupKind(tiles, cells)) continue;
      for (const i of cells) used[i] = true;
      if (go()) return true;
      for (const i of cells) used[i] = false;
    }
    return false;
  };
  return go();
}

/** How many full clearances the tiles allow, counting no further than `limit`. */
export function countClearances(tiles: Quark[], cols: number, rows: number, limit = 2): number {
  const used = Array(tiles.length).fill(false);
  let found = 0;
  const go = (): void => {
    if (found >= limit) return;
    const first = used.indexOf(false);
    if (first < 0) { found++; return; }
    for (const shape of [...TRIOMINOES, ...DOMINOES]) {
      const cells = placeShape(cols, rows, (i) => used[i], first, shape);
      if (!cells || !groupKind(tiles, cells) || !connected(cols, cells)) continue;
      for (const i of cells) used[i] = true;
      go();
      for (const i of cells) used[i] = false;
      if (found >= limit) return;
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

/** A random tiling into triominoes and exactly `mesons` dominoes. */
export function tiling(rng: Rng, cols: number, rows: number, mesons: number): number[][] | null {
  const n = cols * rows;
  const used = Array(n).fill(false);
  const pieces: number[][] = [];
  let budget = 20000;
  const go = (covered: number, dominoes: number): boolean => {
    if (--budget < 0) return false;
    if (covered === n) return dominoes === mesons;
    const rest = n - covered - 2 * (mesons - dominoes);
    if (rest < 0 || rest % 3) return false;
    const first = used.indexOf(false);
    const shapes = shuffle(rng, [...TRIOMINOES.map((s) => ({ s, d: 0 })), ...(dominoes < mesons ? DOMINOES.map((s) => ({ s, d: 1 })) : [])]);
    for (const { s, d } of shapes) {
      const cells = placeShape(cols, rows, (i) => used[i], first, s);
      if (!cells) continue;
      for (const i of cells) used[i] = true;
      pieces.push(cells);
      if (go(covered + cells.length, dominoes + d)) return true;
      pieces.pop();
      for (const i of cells) used[i] = false;
    }
    return false;
  };
  return go(0, 0) ? pieces : null;
}

function colour(rng: Rng, n: number, pieces: number[][]): Quark[] {
  const tiles: Quark[] = Array(n);
  for (const p of pieces) {
    if (p.length === 3) {
      const order = shuffle(rng, [0, 1, 2] as Colour[]);
      p.forEach((i, k) => (tiles[i] = { colour: order[k], anti: false }));
    } else {
      const c = randInt(rng, 3) as Colour;
      const flip = randInt(rng, 2);
      p.forEach((i, k) => (tiles[i] = { colour: c, anti: k === flip }));
    }
  }
  return tiles;
}

export function newColourCharge(z: number, seed: number): ColourChargeState {
  const rng = seeded(seed);
  const spec = specFor(z);
  const n = spec.cols * spec.rows;
  // Deal tilings and colourings until one has a single clearance.
  let best: { pieces: number[][]; tiles: Quark[] } | null = null;
  for (let t = 0; t < 400; t++) {
    const pieces = tiling(rng, spec.cols, spec.rows, spec.mesons);
    if (!pieces) continue;
    for (let c = 0; c < 8; c++) {
      const tiles = colour(rng, n, pieces);
      best ??= { pieces, tiles };
      if (countClearances(tiles, spec.cols, spec.rows) === 1) { best = { pieces, tiles }; t = Infinity; break; }
    }
  }
  if (!best) throw new Error('Colour Charge: no tiling');
  const { pieces, tiles } = best;
  return {
    cols: spec.cols, rows: spec.rows, tiles,
    bound: Array(n).fill(-1), groups: [],
    solution: pieces, moves: 0, par: pieces.length,
  };
}
