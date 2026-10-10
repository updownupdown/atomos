// Color Charge: bind quarks into color-neutral particles until the grid is clear.
//
// Every tile is a quark carrying one of three color charges (red, green,
// blue), or, on heavier levels, an antiquark carrying an anticolor. Three
// orthogonally connected quarks holding one of each color bind into a baryon;
// three antiquarks holding one of each anticolor bind into an antibaryon; a
// quark next to an antiquark of its own color binds into a meson. Bound tiles
// turn white. Clear the whole grid.
//
// From z 21 some levels hand the player a gluon: once, they may swap the
// colors of two neighboring free quarks (or two antiquarks), as a real gluon
// exchange does. Those levels are dealt so the grid cannot be cleared without
// the swap, and exactly one swap and one set of groups clears it.
//
// Levels are dealt by tiling the grid into connected triominoes (and, on
// heavier levels, dominoes), then coloring each triomino red, green and blue
// in random order (some as antiquarks, for antibaryons) and each domino as a
// color plus its anticolor, so a full clearance always exists. On gluon levels
// two tiles of different groups then trade colors, hiding the answer behind
// one swap. Deals are kept only when that clearance is the only one, so every
// grid has exactly one answer.
//
// Game rule, not physics: color charge has nothing to do with visible color,
// and quarks do not sit on a grid. The rule that only color-neutral
// combinations exist on their own is the real one, and so is the gluon
// carrying color from one quark to another.

import { randInt, seeded, type Rng } from './rng';

export type Color = 0 | 1 | 2;
export const COLOR_NAMES = ['red', 'green', 'blue'] as const;
export const COLOR_LETTERS = ['r', 'g', 'b'] as const;

export interface Quark {
  color: Color;
  /** An antiquark, carrying the anticolor. */
  anti: boolean;
}

export type GroupKind = 'baryon' | 'antibaryon' | 'meson';

export interface ColorChargeState {
  cols: number;
  rows: number;
  tiles: Quark[];
  /** For each tile, the index of the bound group it belongs to, or -1. */
  bound: number[];
  /** Bound groups in the order they were made. */
  groups: number[][];
  /** Gluon swaps the level hands out. */
  gluons: number;
  /** Swaps made so far, as tile pairs in the order they were made. */
  swaps: [number, number][];
  /** The groups of the one clearance, on the tiles as they are after `solutionSwaps`. */
  solution: number[][];
  /** The swaps the one clearance needs (as many as `gluons`). */
  solutionSwaps: [number, number][];
  /** Binds and swaps so far; undo takes them back. */
  moves: number;
  /** Groups plus swaps in the clearance. */
  par: number;
}

export interface ChargeSpec {
  cols: number;
  rows: number;
  /** Quark-antiquark pairs in the dealt tiling. */
  mesons: number;
  /** Triples dealt as antiquarks. */
  antibaryons: number;
  /** Gluon swaps handed out, each one needed. */
  gluons: number;
}

export function specFor(z: number): ChargeSpec {
  if (z <= 10) return { cols: 3, rows: 3, mesons: 0, antibaryons: 0, gluons: 0 };
  if (z <= 20) return { cols: 4, rows: 3, mesons: 0, antibaryons: 0, gluons: 0 };
  if (z <= 30) return { cols: 4, rows: 3, mesons: 0, antibaryons: 0, gluons: 1 };
  if (z <= 44) return { cols: 4, rows: 4, mesons: 2, antibaryons: 0, gluons: 0 };
  if (z <= 54) return { cols: 4, rows: 4, mesons: 2, antibaryons: 0, gluons: 1 };
  if (z <= 70) return { cols: 4, rows: 5, mesons: 4, antibaryons: 1, gluons: 0 };
  if (z <= 86) return { cols: 4, rows: 5, mesons: 4, antibaryons: 1, gluons: 1 };
  if (z <= 103) return { cols: 5, rows: 5, mesons: 5, antibaryons: 2, gluons: 1 };
  return { cols: 5, rows: 5, mesons: 5, antibaryons: 2, gluons: 2 };
}

export function cloneCharge(s: ColorChargeState): ColorChargeState {
  return {
    ...s,
    tiles: s.tiles.map((q) => ({ ...q })),
    bound: [...s.bound],
    groups: s.groups.map((g) => [...g]),
    swaps: s.swaps.map(([a, b]) => [a, b] as [number, number]),
  };
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
const SHAPES = [...TRIOMINOES, ...DOMINOES];

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
export function groupKind(tiles: Quark[], cells: number[]): GroupKind | null {
  if (cells.length === 3) {
    const q = cells.map((i) => tiles[i]);
    if (q[0].anti !== q[1].anti || q[1].anti !== q[2].anti) return null;
    if (new Set(q.map((x) => x.color)).size !== 3) return null;
    return q[0].anti ? 'antibaryon' : 'baryon';
  }
  if (cells.length === 2) {
    const [a, b] = cells.map((i) => tiles[i]);
    return a.anti !== b.anti && a.color === b.color ? 'meson' : null;
  }
  return null;
}

/** True when the cells are free, distinct, connected and color-neutral. */
export function canBind(s: ColorChargeState, cells: number[]): boolean {
  if (new Set(cells).size !== cells.length) return false;
  if (cells.some((i) => i < 0 || i >= s.tiles.length || s.bound[i] >= 0)) return false;
  return groupKind(s.tiles, cells) !== null && connected(s.cols, cells);
}

export function bind(s: ColorChargeState, cells: number[]): ColorChargeState | null {
  if (!canBind(s, cells)) return null;
  const next = cloneCharge(s);
  const id = next.groups.length;
  next.groups.push([...cells]);
  for (const i of cells) next.bound[i] = id;
  next.moves = s.moves + 1;
  return next;
}

export function gluonsLeft(s: ColorChargeState): number {
  return s.gluons - s.swaps.length;
}

/** Two tiles a gluon can act on: neighbors of the same kind (quarks or antiquarks) with different colors. */
export function swappable(tiles: Quark[], cols: number, a: number, b: number): boolean {
  if (a === b || !adjacent(cols, a, b)) return false;
  const p = tiles[a], q = tiles[b];
  return p.anti === q.anti && p.color !== q.color;
}

/** True when a gluon is left and both tiles are free, swappable neighbors. */
export function canSwap(s: ColorChargeState, a: number, b: number): boolean {
  if (gluonsLeft(s) <= 0) return false;
  if ([a, b].some((i) => i < 0 || i >= s.tiles.length || s.bound[i] >= 0)) return false;
  return swappable(s.tiles, s.cols, a, b);
}

/** Spends a gluon: the two tiles trade colors. */
export function swap(s: ColorChargeState, a: number, b: number): ColorChargeState | null {
  if (!canSwap(s, a, b)) return null;
  const next = cloneCharge(s);
  const ca = next.tiles[a].color;
  next.tiles[a].color = next.tiles[b].color;
  next.tiles[b].color = ca;
  next.swaps.push([a, b]);
  next.moves = s.moves + 1;
  return next;
}

export function solved(s: ColorChargeState): boolean {
  return s.bound.every((g) => g >= 0);
}

export interface Tally { kind: GroupKind; done: number; need: number }

/**
 * The particles the clearance makes, by kind (baryons, antibaryons, mesons, in
 * that order, only the kinds the grid holds), and how many of each are bound
 * so far, leaving out bound group `skip`. A tile is a quark or an antiquark
 * for good (gluons trade colors only), so a group's kind never changes.
 */
export function tally(s: ColorChargeState, skip = -1): Tally[] {
  const kindOf = (g: number[]): GroupKind => (g.length === 2 ? 'meson' : s.tiles[g[0]].anti ? 'antibaryon' : 'baryon');
  const kinds: GroupKind[] = ['baryon', 'antibaryon', 'meson'];
  return kinds
    .map((kind) => ({
      kind,
      need: s.solution.filter((g) => kindOf(g) === kind).length,
      done: s.groups.filter((g, k) => k !== skip && kindOf(g) === kind).length,
    }))
    .filter((t) => t.need > 0);
}

/** Every pair a gluon could act on among the tiles not yet used. */
function swapPairs(tiles: Quark[], cols: number, rows: number, used: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (used(i)) continue;
    const r = Math.floor(i / cols), c = i % cols;
    for (const j of [c + 1 < cols ? i + 1 : -1, r + 1 < rows ? i + cols : -1]) {
      if (j >= 0 && !used(j) && swappable(tiles, cols, i, j)) out.push([i, j]);
    }
  }
  return out;
}

function swapped(tiles: Quark[], a: number, b: number): Quark[] {
  const t = tiles.slice();
  t[a] = { color: tiles[b].color, anti: tiles[a].anti };
  t[b] = { color: tiles[a].color, anti: tiles[b].anti };
  return t;
}

/** How many ways the tiles not in `used` split into neutral groups, counting no further than `limit`. */
function countTilings(tiles: Quark[], cols: number, rows: number, used: boolean[], limit: number): number {
  let found = 0;
  const go = (): void => {
    const first = used.indexOf(false);
    if (first < 0) { found++; return; }
    for (const shape of SHAPES) {
      const cells = placeShape(cols, rows, (i) => used[i], first, shape);
      if (!cells || !groupKind(tiles, cells)) continue;
      for (const i of cells) used[i] = true;
      go();
      for (const i of cells) used[i] = false;
      if (found >= limit) return;
    }
  };
  go();
  return found;
}

const keyOf = (tiles: Quark[]): string => tiles.map((q) => q.color + (q.anti ? 3 : 0)).join('');

/**
 * Every coloring of the free tiles reachable with up to `gluons` swaps among
 * them (the tiles as they are first), each once.
 */
function reachable(tiles: Quark[], cols: number, rows: number, used: (i: number) => boolean, gluons: number): Quark[][] {
  const seen = new Set([keyOf(tiles)]);
  let layer = [tiles];
  const all = [tiles];
  for (let k = 0; k < gluons; k++) {
    const next: Quark[][] = [];
    for (const t of layer) {
      for (const [a, b] of swapPairs(t, cols, rows, used)) {
        const u = swapped(t, a, b);
        const key = keyOf(u);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(u);
        all.push(u);
      }
    }
    layer = next;
  }
  return all;
}

/**
 * How many full clearances the tiles allow, counting no further than `limit`.
 * With gluons, a clearance is a coloring reachable with up to that many swaps
 * plus a split of it into neutral groups.
 */
export function countClearances(tiles: Quark[], cols: number, rows: number, limit = 2, gluons = 0): number {
  let found = 0;
  for (const t of reachable(tiles, cols, rows, () => false, gluons)) {
    found += countTilings(t, cols, rows, Array(tiles.length).fill(false), limit - found);
    if (found >= limit) return found;
  }
  return found;
}

/** Free tiles split into regions of neighbors; groups never reach across regions. */
function regions(s: ColorChargeState): number[][] {
  const seen = s.bound.map((g) => g >= 0);
  const out: number[][] = [];
  for (let i = 0; i < s.tiles.length; i++) {
    if (seen[i]) continue;
    const region = [i];
    seen[i] = true;
    for (let k = 0; k < region.length; k++) {
      const a = region[k];
      const c = a % s.cols;
      for (const b of [c > 0 ? a - 1 : -1, c + 1 < s.cols ? a + 1 : -1, a - s.cols, a + s.cols]) {
        if (b >= 0 && b < s.tiles.length && !seen[b]) { seen[b] = true; region.push(b); }
      }
    }
    out.push(region);
  }
  return out;
}

/** The fewest swaps a region needs before it can be bound whole, or Infinity past `max`. */
function swapsNeeded(s: ColorChargeState, region: number[], max: number): number {
  const inside = new Set(region);
  const used = (i: number) => !inside.has(i);
  const mask = s.tiles.map((_, i) => used(i));
  const boards = [[s.tiles]];
  for (let k = 0; k <= max; k++) {
    for (const t of boards[k]) if (countTilings(t, s.cols, s.rows, mask.slice(), 1)) return k;
    if (k === max) break;
    const next: Quark[][] = [];
    for (const t of boards[k]) for (const [a, b] of swapPairs(t, s.cols, s.rows, used)) next.push(swapped(t, a, b));
    boards.push(next);
  }
  return Infinity;
}

/**
 * The free tiles that can no longer all be bound, with the gluons left. Empty
 * while the grid can still be cleared. Each region of free neighbors is judged
 * on its own: a region that cannot be bound whole even with every gluon is
 * stranded; if each could be but there are not enough gluons for all, the
 * ones that need a gluon are.
 */
export function stranded(s: ColorChargeState): number[] {
  const left = gluonsLeft(s);
  const need = regions(s).map((r) => ({ r, n: swapsNeeded(s, r, left) }));
  const total = need.reduce((a, b) => a + b.n, 0);
  if (total <= left) return [];
  const hopeless = need.filter((x) => x.n > left);
  return (hopeless.length ? hopeless : need.filter((x) => x.n > 0)).flatMap((x) => x.r).sort((a, b) => a - b);
}

/** True when no neutral group of free tiles, as they are colored now, could hold tile `i`. */
export function isolated(s: ColorChargeState, i: number): boolean {
  if (s.bound[i] >= 0) return false;
  const near = (a: number) => [a - 1, a + 1, a - s.cols, a + s.cols].filter((b) => b >= 0 && b < s.tiles.length && s.bound[b] < 0 && adjacent(s.cols, a, b));
  for (const j of near(i)) {
    if (groupKind(s.tiles, [i, j])) return false;
    for (const k of new Set([...near(i), ...near(j)])) {
      if (k !== i && k !== j && groupKind(s.tiles, [i, j, k])) return false;
    }
  }
  return true;
}

/** True when the free tiles can still all be bound, with the gluons left. */
export function canFinish(s: ColorChargeState): boolean {
  return stranded(s).length === 0;
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

function color(rng: Rng, n: number, pieces: number[][], antibaryons: number): Quark[] {
  const tiles: Quark[] = Array(n);
  const triples = pieces.filter((p) => p.length === 3);
  const anti = new Set(shuffle(rng, triples.slice()).slice(0, antibaryons));
  for (const p of pieces) {
    if (p.length === 3) {
      const order = shuffle(rng, [0, 1, 2] as Color[]);
      p.forEach((i, k) => (tiles[i] = { color: order[k], anti: anti.has(p) }));
    } else {
      const c = randInt(rng, 3) as Color;
      const flip = randInt(rng, 2);
      p.forEach((i, k) => (tiles[i] = { color: c, anti: k === flip }));
    }
  }
  return tiles;
}

/**
 * For a gluon level: the swaps that hide the answer, chosen so the dealt grid
 * cannot be cleared with fewer swaps and exactly one set of swaps and split
 * clears it. Each swap trades colors between two tiles of different groups
 * (swapping within one group leaves it neutral), and no tile is swapped twice.
 */
function hideSwaps(rng: Rng, tiles: Quark[], pieces: number[][], cols: number, rows: number, gluons: number): { tiles: Quark[]; swaps: [number, number][] } | null {
  const pieceOf = Array(tiles.length).fill(-1);
  pieces.forEach((p, k) => p.forEach((i) => (pieceOf[i] = k)));
  for (let attempt = 0; attempt < 6; attempt++) {
    let dealt = tiles;
    const swaps: [number, number][] = [];
    const touched = new Set<number>();
    for (let k = 0; k < gluons; k++) {
      const pairs = swapPairs(dealt, cols, rows, () => false).filter(([a, b]) => pieceOf[a] !== pieceOf[b] && !touched.has(a) && !touched.has(b));
      if (!pairs.length) break;
      const [a, b] = pairs[randInt(rng, pairs.length)];
      dealt = swapped(dealt, a, b);
      swaps.push([a, b]);
      touched.add(a).add(b);
    }
    if (swaps.length < gluons) continue;
    if (countClearances(dealt, cols, rows, 1, gluons - 1)) continue;
    if (countClearances(dealt, cols, rows, 2, gluons) === 1) return { tiles: dealt, swaps };
  }
  return null;
}

export function newColorCharge(z: number, seed: number): ColorChargeState {
  const rng = seeded(seed);
  const spec = specFor(z);
  const n = spec.cols * spec.rows;
  // Deal tilings and colorings (and, with a gluon, a hiding swap) until one has a single clearance.
  let best: { pieces: number[][]; tiles: Quark[]; swaps: [number, number][] } | null = null;
  for (let t = 0; t < 400 && !best; t++) {
    const pieces = tiling(rng, spec.cols, spec.rows, spec.mesons);
    if (!pieces) continue;
    for (let c = 0; c < 8 && !best; c++) {
      const tiles = color(rng, n, pieces, spec.antibaryons);
      if (spec.gluons) {
        // A finished grid with one split is the start; the hidden swap must keep it the only answer.
        if (countTilings(tiles, spec.cols, spec.rows, Array(n).fill(false), 2) !== 1) continue;
        const hid = hideSwaps(rng, tiles, pieces, spec.cols, spec.rows, spec.gluons);
        if (hid) best = { pieces, tiles: hid.tiles, swaps: hid.swaps };
      } else if (countClearances(tiles, spec.cols, spec.rows) === 1) {
        best = { pieces, tiles, swaps: [] };
      }
    }
  }
  if (!best) throw new Error(`Color Charge: no deal for z ${z}`);
  const { pieces, tiles, swaps } = best;
  return {
    cols: spec.cols, rows: spec.rows, tiles,
    bound: Array(n).fill(-1), groups: [],
    gluons: swaps.length, swaps: [],
    solution: pieces, solutionSwaps: swaps,
    moves: 0, par: pieces.length + swaps.length,
  };
}

// ---- hints ---------------------------------------------------------------------------

/** The tiles as the one clearance binds them: as dealt, with the hidden swaps made. */
export function targetTiles(s: ColorChargeState): Quark[] {
  let t = s.tiles;
  for (let k = s.swaps.length - 1; k >= 0; k--) t = swapped(t, s.swaps[k][0], s.swaps[k][1]);
  for (const [a, b] of s.solutionSwaps) t = swapped(t, a, b);
  return t;
}

/**
 * The fewest gluon swaps among free tiles, no more than the gluons left, that
 * give every free tile its color in the clearance; null when there is no such
 * way. A breadth-first search: there are at most two gluons.
 */
export function swapRoute(s: ColorChargeState, target = targetTiles(s)): [number, number][] | null {
  const free = (i: number) => s.bound[i] < 0;
  const misses = (t: Quark[]) => t.reduce((n, q, i) => n + (free(i) && q.color !== target[i].color ? 1 : 0), 0);
  const left = gluonsLeft(s);
  let layer: { t: Quark[]; route: [number, number][] }[] = [{ t: s.tiles, route: [] }];
  const seen = new Set([keyOf(s.tiles)]);
  for (let k = 0; ; k++) {
    for (const { t, route } of layer) if (!misses(t)) return route;
    if (k === left) return null;
    const next: typeof layer = [];
    for (const { t, route } of layer) {
      // Each swap fixes at most two tiles.
      if (misses(t) > 2 * (left - k)) continue;
      for (const [a, b] of swapPairs(t, s.cols, s.rows, (i) => !free(i))) {
        const u = swapped(t, a, b);
        const key = keyOf(u);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ t: u, route: [...route, [a, b]] });
      }
    }
    layer = next;
  }
}

const groupKey = (cells: number[]): string => [...cells].sort((a, b) => a - b).join(',');

/**
 * True while the grid can still be cleared: every group bound so far is one
 * of the clearance's, and the gluons left can still give the free tiles their
 * colors in it. Levels have one clearance, so this is the same as canFinish,
 * only quicker.
 */
export function onTrack(s: ColorChargeState): boolean {
  const keys = new Set(s.solution.map(groupKey));
  return s.groups.every((g) => keys.has(groupKey(g))) && swapRoute(s) !== null;
}

export type ChargeStep =
  /** `only` is a tile of the group that no other neutral group could hold, or -1. */
  | { kind: 'bind'; cells: number[]; only: number }
  | { kind: 'swap'; cells: [number, number] };

/** How many neutral groups of free tiles, as they are colored now, could hold tile `i`. */
function groupsHolding(s: ColorChargeState, i: number): number {
  const near = (a: number) => [a - 1, a + 1, a - s.cols, a + s.cols].filter((b) => b >= 0 && b < s.tiles.length && s.bound[b] < 0 && adjacent(s.cols, a, b));
  const found = new Set<string>();
  for (const j of near(i)) {
    if (groupKind(s.tiles, [i, j])) found.add(groupKey([i, j]));
    for (const k of new Set([...near(i), ...near(j)])) {
      if (k !== i && k !== j && groupKind(s.tiles, [i, j, k])) found.add(groupKey([i, j, k]));
    }
  }
  return found.size;
}

/**
 * The next step of the one clearance from here, or null when the grid is
 * clear or can no longer be cleared. Groups come first, any that the swaps
 * still to come leave alone, preferring one with a tile nothing else could
 * hold; then the next swap.
 */
export function nextStep(s: ColorChargeState): ChargeStep | null {
  if (solved(s)) return null;
  const keys = new Set(s.solution.map(groupKey));
  if (!s.groups.every((g) => keys.has(groupKey(g)))) return null;
  const target = targetTiles(s);
  const route = swapRoute(s, target);
  if (!route) return null;
  const touched = new Set(route.flat());
  const ready = s.solution.filter((g) => g.every((i) => s.bound[i] < 0 && !touched.has(i) && s.tiles[i].color === target[i].color));
  let pick: ChargeStep | null = null;
  for (const g of ready) {
    const only = g.find((i) => groupsHolding(s, i) === 1) ?? -1;
    if (only >= 0) return { kind: 'bind', cells: g, only };
    pick ??= { kind: 'bind', cells: g, only: -1 };
  }
  return pick ?? (route.length ? { kind: 'swap', cells: route[0] } : null);
}
