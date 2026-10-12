// Flood: a crystal grows as one lattice.
//
// A grid of colored cells. The crystal starts as the cells joined to the top-left corner in its
// color. Pick a color and the whole crystal takes it, and with it every cell of that color
// touching it joins the crystal. Grow it over the whole board within the move budget. Par is the
// fewest picks a solver finds: an exact A* search on small boards, a beam search on big ones.
//
// Game rule, not physics: a real crystal grows by adding atoms of its own kind at its faces; it
// does not change what it is made of to swallow its neighbors.

import { randInt, seeded } from './rng';

export interface FloodState {
  size: number;
  colors: number;
  /** Each cell's color, row by row. */
  cells: number[];
  /** Picks made. */
  moves: number;
  /** The fewest picks the solver found. */
  par: number;
  /** Picks allowed: par plus a little slack on easy boards. */
  budget: number;
  /** True when the solver proved par the fewest. */
  exact: boolean;
  /** The solver's picks for the board as dealt, par of them. */
  solution: number[];
  /** The last pick, for the view's ripple. */
  last: Growth | null;
}

export interface Growth {
  color: number;
  /** The crystal's cells after the pick, each with its steps from the corner through the crystal. */
  dist: Map<number, number>;
  /** Cells that joined with this pick. */
  joined: number[];
}

// ---- moves -----------------------------------------------------------------------------

export function neighbors(n: number, cell: number): number[] {
  const x = cell % n, y = Math.floor(cell / n);
  const out: number[] = [];
  if (y > 0) out.push(cell - n);
  if (x < n - 1) out.push(cell + 1);
  if (y < n - 1) out.push(cell + n);
  if (x > 0) out.push(cell - 1);
  return out;
}

/** The crystal: the cells joined to the corner through its color, as a set. */
export function crystal(s: FloodState): Set<number> {
  const c = s.cells[0];
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of neighbors(s.size, i)) if (!seen.has(j) && s.cells[j] === c) { seen.add(j); stack.push(j); }
  }
  return seen;
}

/** The cells a pick of `color` would add to the crystal. */
export function gain(s: FloodState, color: number): number[] {
  if (color === s.cells[0]) return [];
  const region = crystal(s);
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const i of region) for (const j of neighbors(s.size, i)) if (!region.has(j) && !seen.has(j) && s.cells[j] === color) { seen.add(j); stack.push(j); }
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of neighbors(s.size, i)) if (!region.has(j) && !seen.has(j) && s.cells[j] === color) { seen.add(j); stack.push(j); }
  }
  return [...seen];
}

/** Steps from the corner to every crystal cell, walking inside the crystal. */
function distances(n: number, region: Set<number>): Map<number, number> {
  const dist = new Map<number, number>([[0, 0]]);
  const queue = [0];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of neighbors(n, i)) if (region.has(j) && !dist.has(j)) { dist.set(j, dist.get(i)! + 1); queue.push(j); }
  }
  return dist;
}

/** Picks a color: the crystal takes it and grows. Null for the crystal's own color, or once the
 *  board is full or the budget spent. */
export function pick(s: FloodState, color: number): FloodState | null {
  if (color === s.cells[0] || color < 0 || color >= s.colors || solved(s) || s.moves >= s.budget) return null;
  const region = crystal(s);
  const joined = gain(s, color);
  const cells = s.cells.slice();
  for (const i of region) cells[i] = color;
  for (const i of joined) { cells[i] = color; region.add(i); }
  return { ...s, cells, moves: s.moves + 1, last: { color, dist: distances(s.size, region), joined } };
}

export function solved(s: FloodState): boolean {
  return s.cells.every((c) => c === s.cells[0]);
}

/** Out of picks with the board not yet full. */
export function outOfMoves(s: FloodState): boolean {
  return !solved(s) && s.moves >= s.budget;
}

// ---- the solver ------------------------------------------------------------------------
//
// The board is boiled down to its patches: runs of joined cells of one color, each a node, with
// an edge between patches that touch. The crystal is a set of patches; a pick adds every patch
// of that color touching it. Two lower bounds on the picks left, both safe for A*: the number of
// colors still outside the crystal (a pick finishes at most one color), and the farthest patch's
// distance from the crystal in patch steps (a pick reaches one step further at most).

interface Graph {
  count: number;
  color: Int8Array;
  size: Int32Array;
  adj: number[][];
  colors: number;
  words: number;
}

function graphOf(n: number, cells: number[], colors: number): Graph {
  const id = new Int32Array(n * n).fill(-1);
  const color: number[] = [], size: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (id[i] >= 0) continue;
    const k = color.length;
    color.push(cells[i]);
    let count = 0;
    const stack = [i];
    id[i] = k;
    while (stack.length) {
      const a = stack.pop()!;
      count++;
      for (const b of neighbors(n, a)) if (id[b] < 0 && cells[b] === cells[i]) { id[b] = k; stack.push(b); }
    }
    size.push(count);
  }
  const sets = color.map(() => new Set<number>());
  for (let i = 0; i < n * n; i++) for (const j of neighbors(n, i)) if (id[i] !== id[j]) sets[id[i]].add(id[j]);
  return { count: color.length, color: Int8Array.from(color), size: Int32Array.from(size), adj: sets.map((s) => [...s]), colors, words: Math.ceil(color.length / 32) };
}

const has = (b: Uint32Array, i: number): boolean => (b[i >> 5] & (1 << (i & 31))) !== 0;
const add = (b: Uint32Array, i: number): void => { b[i >> 5] |= 1 << (i & 31); };

/** The crystal after picking `color`, as a new set of patches. */
function grow(g: Graph, region: Uint32Array, color: number): Uint32Array {
  const next = region.slice();
  for (let v = 0; v < g.count; v++) {
    if (!has(region, v)) continue;
    for (const u of g.adj[v]) if (!has(next, u) && g.color[u] === color) add(next, u);
  }
  return next;
}

/** The lower bound on picks left (see above), and the cells the crystal covers. */
function bound(g: Graph, region: Uint32Array, dist: Int16Array, queue: Int32Array): { h: number; cells: number; done: boolean } {
  dist.fill(-1);
  let head = 0, tail = 0, cells = 0;
  for (let v = 0; v < g.count; v++) if (has(region, v)) { dist[v] = 0; queue[tail++] = v; cells += g.size[v]; }
  if (tail === g.count) return { h: 0, cells, done: true };
  let far = 0;
  let left = 0;
  while (head < tail) {
    const v = queue[head++];
    for (const u of g.adj[v]) {
      if (dist[u] >= 0) continue;
      dist[u] = dist[v] + 1;
      if (dist[u] > far) far = dist[u];
      queue[tail++] = u;
    }
  }
  for (let v = 0; v < g.count; v++) if (!has(region, v)) left |= 1 << g.color[v];
  let colorsLeft = 0;
  for (; left; left &= left - 1) colorsLeft++;
  return { h: Math.max(far, colorsLeft), cells, done: false };
}

/** The colors worth picking: those of patches touching the crystal. */
function frontier(g: Graph, region: Uint32Array): number[] {
  let mask = 0;
  for (let v = 0; v < g.count; v++) {
    if (!has(region, v)) continue;
    for (const u of g.adj[v]) if (!has(region, u)) mask |= 1 << g.color[u];
  }
  const out: number[] = [];
  for (let c = 0; c < g.colors; c++) if (mask & (1 << c)) out.push(c);
  return out;
}

function start(g: Graph): Uint32Array {
  const r = new Uint32Array(g.words);
  add(r, 0); // cell 0 is always in patch 0
  return r;
}

const keyOf = (b: Uint32Array): string => Array.prototype.join.call(b, ',');

/** Exact A*: the fewest picks, or null when it needs more than `budget` positions. */
function astar(g: Graph, budget: number): number[] | null {
  const dist = new Int16Array(g.count), queue = new Int32Array(g.count);
  const nodes: { r: Uint32Array; g: number; parent: number; color: number }[] = [];
  const heap: { f: number; id: number }[] = [];
  const push = (f: number, id: number) => {
    heap.push({ f, id });
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
        if (heap[c].f >= heap[i].f) break;
        [heap[c], heap[i]] = [heap[i], heap[c]];
        i = c;
      }
    }
    return top;
  };
  const r0 = start(g);
  const seen = new Map<string, number>([[keyOf(r0), 0]]);
  nodes.push({ r: r0, g: 0, parent: -1, color: -1 });
  const b0 = bound(g, r0, dist, queue);
  if (b0.done) return [];
  // Ties go deeper, then to the bigger crystal.
  const BIG = 1 << 20;
  push(b0.h * BIG - 0, 0);
  let expanded = 0;
  while (heap.length) {
    const { id } = pop();
    const node = nodes[id];
    if (seen.get(keyOf(node.r))! < node.g) continue;
    if (++expanded > budget) return null;
    for (const c of frontier(g, node.r)) {
      const r = grow(g, node.r, c);
      const k = keyOf(r);
      const ng = node.g + 1;
      const old = seen.get(k);
      if (old !== undefined && old <= ng) continue;
      seen.set(k, ng);
      const b = bound(g, r, dist, queue);
      nodes.push({ r, g: ng, parent: id, color: c });
      if (b.done) {
        // The bound is consistent, so the first finished board reached is reached by the fewest.
        // A finished child of the node being expanded at f = ng is optimal: f never drops.
        const path: number[] = [];
        for (let k2 = nodes.length - 1; nodes[k2].parent >= 0; k2 = nodes[k2].parent) path.push(nodes[k2].color);
        return path.reverse();
      }
      push((ng + b.h) * BIG + (BIG >> 1) - ng * 1024 - Math.min(1023, b.cells), nodes.length - 1);
    }
  }
  return null;
}

/** Beam search: keeps the `width` most promising crystals at each depth (smallest bound, then
 *  biggest), and returns the first picks that fill the board. Not always the fewest. */
function beam(g: Graph, width: number): number[] {
  const dist = new Int16Array(g.count), queue = new Int32Array(g.count);
  let layer: { r: Uint32Array; path: number[] }[] = [{ r: start(g), path: [] }];
  if (bound(g, layer[0].r, dist, queue).done) return [];
  for (let depth = 0; depth < 400; depth++) {
    const next: { r: Uint32Array; path: number[]; score: number }[] = [];
    const seen = new Set<string>();
    for (const st of layer) {
      for (const c of frontier(g, st.r)) {
        const r = grow(g, st.r, c);
        const k = keyOf(r);
        if (seen.has(k)) continue;
        seen.add(k);
        const b = bound(g, r, dist, queue);
        if (b.done) return [...st.path, c];
        next.push({ r, path: [...st.path, c], score: b.h * 100000 - b.cells });
      }
    }
    next.sort((a, b) => a.score - b.score);
    layer = next.slice(0, width);
  }
  return [];
}

/** The fewest picks that fill the board from here, as colors in order, and whether that is
 *  proved the fewest. */
export function solveFlood(s: Pick<FloodState, 'size' | 'cells' | 'colors'>, opts: { budget?: number; width?: number } = {}): { path: number[]; exact: boolean } {
  const g = graphOf(s.size, s.cells, s.colors);
  const exact = astar(g, opts.budget ?? (s.size <= 9 ? 1500 : s.size === 10 ? 800 : 300));
  if (exact) return { path: exact, exact: true };
  return { path: beam(g, opts.width ?? 100), exact: false };
}

// ---- deals -----------------------------------------------------------------------------

export interface FloodShape {
  size: number;
  colors: number;
  /** Picks allowed beyond par. */
  slack: number;
}

/** The board for dial d (1 to 100): the grid grows from 5 by 5 to 12 by 12 and the colors from
 *  3 to 6, while the spare picks fall from 4 to none. */
export function floodShape(d: number): FloodShape {
  const x = Math.min(100, Math.max(1, Math.round(d)));
  const t = (x - 1) / 99;
  const size = Math.round(5 + 7 * t);
  const colors = x <= 14 ? 3 : x <= 38 ? 4 : x <= 66 ? 5 : 6;
  const slack = x <= 12 ? 4 : x <= 30 ? 3 : x <= 50 ? 2 : x <= 86 ? 1 : 0;
  return { size, colors, slack };
}

/** Deals a board for dial d: random colors, never a corner already joined to most of the board,
 *  with par from the solver. */
export function newFlood(d: number, seed: number): FloodState {
  const shape = floodShape(d);
  const rng = seeded(seed);
  const n = shape.size;
  for (let attempt = 0; ; attempt++) {
    const cells = Array.from({ length: n * n }, () => randInt(rng, shape.colors));
    const s: FloodState = { size: n, colors: shape.colors, cells, moves: 0, par: 0, budget: 0, exact: false, solution: [], last: null };
    // Every color dealt, and the crystal starts small.
    if (new Set(cells).size < shape.colors && attempt < 20) continue;
    if (crystal(s).size > Math.max(3, (n * n) / 8) && attempt < 20) continue;
    const r = solveFlood(s);
    if (!r.path.length) continue;
    return { ...s, par: r.path.length, budget: r.path.length + shape.slack, exact: r.exact, solution: r.path };
  }
}

export function cloneFlood(s: FloodState): FloodState {
  return { ...s, cells: s.cells.slice(), solution: s.solution.slice(), last: null };
}
