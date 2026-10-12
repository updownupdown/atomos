// Circuit: turn the wire tiles until current from the cell reaches every one.
//
// A grid of square tiles, each carrying wires from its middle to some of its sides. One tile
// holds the cell (a battery). Tap a tile to turn it a quarter turn clockwise. The board is done
// when every wire end meets another, none points off the board, and every tile is live: joined
// to the cell. The wires then form one tree, with no loop. Every deal has exactly one answer.
//
// Game rule, not physics: current needs a closed loop; each wire here stands for a cable with
// two conductors, out and back, the way a house is wired.

import { rand, randInt, seeded, weighted, type Rng } from './rng';

/** Wire bits: 1 up, 2 right, 4 down, 8 left. */
export const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
export const DIRS = [UP, RIGHT, DOWN, LEFT] as const;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export type Why = 'edge' | 'neighbors' | 'loop' | 'ahead';

export interface CircuitState {
  cols: number;
  rows: number;
  /** Each tile's wires as they lie now. */
  tiles: number[];
  /** The one answer. */
  solution: number[];
  /** The tile holding the cell. */
  source: number;
  /** Tiles the player has locked: taps leave them alone. */
  locked: boolean[];
  /** Quarter turns made. */
  moves: number;
  /** The fewest quarter turns that finish the board. */
  par: number;
  /** The order a solver works the tiles out in, and why each is forced: the hints' path. */
  order: { cell: number; why: Why }[];
}

/** The board for a dial setting, 1 to 100: its size, and how the wiring is grown (long
 *  straight runs on easy boards, more branches and bends on hard ones). */
export function circuitShape(d: number): { cols: number; rows: number; straight: number; branch: number } {
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  const sizes: [number, number][] = [[4, 4], [4, 5], [5, 5], [5, 6], [6, 6], [6, 7], [7, 7], [7, 8], [8, 8]];
  const [cols, rows] = sizes[Math.min(sizes.length - 1, Math.floor(t * sizes.length))];
  return { cols, rows, straight: 2.6 - 2.2 * t, branch: 0.35 + 1.25 * t };
}

/** A tile's wires turned a quarter turn clockwise. */
export const cw = (m: number): number => ((m << 1) | (m >> 3)) & 15;

/** Every way a tile can lie, without repeats (a straight has two, a cross one). */
export function rotations(m: number): number[] {
  const out: number[] = [];
  for (let k = 0, x = m; k < 4; k++, x = cw(x)) if (!out.includes(x)) out.push(x);
  return out;
}

/** Quarter turns clockwise from `from` to `to` (-1 if it never gets there). */
export function turnsTo(from: number, to: number): number {
  for (let k = 0, x = from; k < 4; k++, x = cw(x)) if (x === to) return k;
  return -1;
}

/** The fewest quarter turns either way from `from` to `to`: positive clockwise, negative
 *  counter-clockwise (a half turn goes clockwise). */
export function shortest(from: number, to: number): number {
  const k = turnsTo(from, to);
  return k === 3 ? -1 : k;
}

export const wireCount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

const opposite = (d: number): number => (d + 2) % 4;

/** The tile across side `d` (0 up, 1 right, 2 down, 3 left) of tile i, or -1 off the board. */
export function across(cols: number, rows: number, i: number, d: number): number {
  const x = (i % cols) + DX[d], y = Math.floor(i / cols) + DY[d];
  return x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x;
}

// ---- the solver -----------------------------------------------------------------------

/** Candidates per tile: a 16-bit set of the wire masks it may still take. */
type Cands = number[];

const single = (c: number): boolean => c !== 0 && (c & (c - 1)) === 0;
const only = (c: number): number => 31 - Math.clz32(c);
const masksOf = (c: number): number[] => { const out: number[] = []; for (let m = 0; m < 16; m++) if (c & (1 << m)) out.push(m); return out; };

/** Each tile's ways that point nowhere off the board. */
function initial(cols: number, rows: number, tiles: number[]): Cands {
  return tiles.map((m, i) => {
    let c = 0;
    for (const r of rotations(m)) {
      let ok = true;
      for (let d = 0; d < 4; d++) if (r & (1 << d) && across(cols, rows, i, d) < 0) ok = false;
      if (ok) c |= 1 << r;
    }
    return c;
  });
}

/** Neighbors agree: a side every candidate wires forces the tile across to wire back, and a side
 *  none wires forbids it. Records tiles as they become fixed. False on a contradiction. */
function agree(cols: number, rows: number, c: Cands, fixed: (i: number) => void): boolean {
  const n = c.length;
  const queue: number[] = [];
  const queued = new Uint8Array(n);
  for (let i = 0; i < n; i++) { queue.push(i); queued[i] = 1; }
  while (queue.length) {
    const i = queue.shift()!;
    queued[i] = 0;
    for (let d = 0; d < 4; d++) {
      const j = across(cols, rows, i, d);
      if (j < 0) continue;
      let any = false, all = true;
      for (let m = 0; m < 16; m++) if (c[i] & (1 << m)) { const has = (m >> d) & 1; any ||= !!has; all &&= !!has; }
      if (any && !all) continue;
      const bit = 1 << opposite(d);
      let keep = 0;
      for (let m = 0; m < 16; m++) if (c[j] & (1 << m) && !!(m & bit) === all) keep |= 1 << m;
      if (keep === c[j]) continue;
      const was = single(c[j]);
      c[j] = keep;
      if (!keep) return false;
      if (!was && single(keep)) fixed(j);
      if (!queued[j]) { queue.push(j); queued[j] = 1; }
    }
  }
  return true;
}

/** Whether tile i lying as `m` (with every fixed tile as it is) closes a loop, or closes off a
 *  piece that is not the whole board. */
function closes(cols: number, rows: number, c: Cands, i: number, m: number): boolean {
  const n = c.length;
  const maskAt = (k: number): number => (k === i ? m : single(c[k]) ? only(c[k]) : -1);
  const parent = new Int32Array(n).fill(-2);
  parent[i] = -1;
  const stack = [i];
  let open = false, seen = 1;
  while (stack.length) {
    const u = stack.pop()!;
    const mu = maskAt(u);
    for (let d = 0; d < 4; d++) {
      if (!(mu & (1 << d))) continue;
      const v = across(cols, rows, u, d);
      if (v < 0) return true;
      const mv = maskAt(v);
      if (mv < 0) { open = true; continue; }
      if (!(mv & (1 << opposite(d)))) return true;
      if (v === parent[u]) continue;
      if (parent[v] !== -2) return true;
      parent[v] = u;
      seen++;
      stack.push(v);
    }
  }
  return !open && seen < n;
}

/** Strikes every candidate that would close a loop or an island. Returns -1 on a contradiction,
 *  else how many were struck. */
function noLoops(cols: number, rows: number, c: Cands, fixed: (i: number) => void): number {
  let struck = 0;
  for (let i = 0; i < c.length; i++) {
    if (single(c[i])) {
      if (closes(cols, rows, c, i, only(c[i]))) return -1;
      continue;
    }
    let keep = c[i];
    for (const m of masksOf(c[i])) if (closes(cols, rows, c, i, m)) { keep &= ~(1 << m); struck++; }
    if (!keep) return -1;
    if (keep !== c[i]) { c[i] = keep; if (single(keep)) fixed(i); }
  }
  return struck;
}

/**
 * Looking one tile ahead: each way a tile could still lie is tried, with what its neighbors must
 * then do; a way that leaves some tile no way to lie, or closes a loop or an island, is struck.
 * Returns -1 on a contradiction, else how many were struck.
 */
function lookAhead(cols: number, rows: number, c: Cands, fixed: (i: number, why: Why) => void): number {
  let struck = 0;
  for (let i = 0; i < c.length; i++) {
    if (single(c[i])) continue;
    let keep = c[i];
    for (const m of masksOf(c[i])) {
      const t = c.slice();
      t[i] = 1 << m;
      const fresh = [i];
      const bad = !agree(cols, rows, t, (k) => fresh.push(k)) || fresh.some((k) => closes(cols, rows, t, k, only(t[k])));
      if (bad) { keep &= ~(1 << m); struck++; }
    }
    if (!keep) return -1;
    if (keep !== c[i]) {
      c[i] = keep;
      if (single(keep)) fixed(i, 'ahead');
      // Settle what that forces before trying further tiles.
      if (!agree(cols, rows, c, (k) => fixed(k, 'neighbors'))) return -1;
    }
  }
  return struck;
}

/** Agreement and the no-loop rule, in turn, until neither strikes anything; then, when `deep`,
 *  a look one tile ahead, and round again. False on a contradiction. */
function settle(cols: number, rows: number, c: Cands, fixed: (i: number, why: Why) => void, deep = true): boolean {
  for (;;) {
    if (!agree(cols, rows, c, (i) => fixed(i, 'neighbors'))) return false;
    const s = noLoops(cols, rows, c, (i) => fixed(i, 'loop'));
    if (s < 0) return false;
    if (s > 0) continue;
    if (!deep || c.every(single)) return true;
    const a = lookAhead(cols, rows, c, fixed);
    if (a < 0) return false;
    if (a === 0) return true;
  }
}

/**
 * Works a board out the way a player can, with no guessing: tiles that can only lie one way on
 * the board's edge, then whatever their neighbors force, then whatever any other way would turn
 * into a loop or an island, over and over. Returns the order tiles were fixed in and whether
 * that fixed them all (which makes the answer the only one).
 */
export function deduce(cols: number, rows: number, tiles: number[]): { order: { cell: number; why: Why }[]; done: boolean; answer: number[] } {
  const c = initial(cols, rows, tiles);
  const order: { cell: number; why: Why }[] = [];
  const isFixed = new Uint8Array(c.length);
  const fixed = (i: number, why: Why) => { if (!isFixed[i]) { isFixed[i] = 1; order.push({ cell: i, why }); } };
  c.forEach((v, i) => { if (single(v)) fixed(i, 'edge'); });
  const ok = settle(cols, rows, c, fixed);
  const done = ok && c.every(single);
  return { order, done, answer: done ? c.map(only) : [] };
}

/** Counts the answers, up to `limit`, by settling and then trying each way of the tile with
 *  the fewest left. */
export function countSolutions(cols: number, rows: number, tiles: number[], limit = 2): number {
  let found = 0;
  const go = (c: Cands): void => {
    if (found >= limit) return;
    if (!settle(cols, rows, c, () => {})) return;
    let pick = -1;
    for (let i = 0; i < c.length; i++) if (!single(c[i]) && (pick < 0 || masksOf(c[i]).length < masksOf(c[pick]).length)) pick = i;
    if (pick < 0) { if (isTree(cols, rows, c.map(only))) found++; return; }
    for (const m of masksOf(c[pick])) {
      const next = c.slice();
      next[pick] = 1 << m;
      go(next);
    }
  };
  go(initial(cols, rows, tiles));
  return found;
}

/** Whether wires join every tile into one tree, every end meeting another. */
function isTree(cols: number, rows: number, w: number[]): boolean {
  const p = powerOf(cols, rows, w, 0);
  return p.live.every(Boolean) && p.loose.length === 0 && p.loops.size === 0;
}

// ---- power ----------------------------------------------------------------------------

export interface Power {
  /** Tiles joined to the cell. */
  live: boolean[];
  /** Steps from the cell along the wires, for live tiles (-1 for dead ones). */
  depth: number[];
  /** Live wire ends that meet nothing: [tile, side 0-3]. */
  loose: [number, number][];
  /** Live joins that lie on a loop, as "tile:side" from the lower-numbered tile. */
  loops: Set<string>;
}

/** Which tiles current reaches from the source, and what is wrong with the live wiring. */
export function powerOf(cols: number, rows: number, tiles: number[], source: number): Power {
  const n = tiles.length;
  const depth = Array(n).fill(-1);
  depth[source] = 0;
  const queue = [source];
  // Each live join once, keyed from its lower-numbered tile.
  const uniq = new Map<string, [number, number, number]>();
  const loose: [number, number][] = [];
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (let d = 0; d < 4; d++) {
      if (!(tiles[u] & (1 << d))) continue;
      const v = across(cols, rows, u, d);
      if (v < 0 || !(tiles[v] & (1 << opposite(d)))) { loose.push([u, d]); continue; }
      if (u < v) uniq.set(`${u}:${d}`, [u, v, d]);
      else uniq.set(`${v}:${opposite(d)}`, [v, u, opposite(d)]);
      if (depth[v] < 0) { depth[v] = depth[u] + 1; queue.push(v); }
    }
  }
  const loops = new Set<string>();
  const live = depth.map((x) => x >= 0);
  const count = live.filter(Boolean).length;
  if (uniq.size > count - 1) {
    // A join is on a loop when its two tiles stay joined without it.
    const list = [...uniq.values()];
    for (const [a, b, d] of list) {
      const key = `${a}:${d}`;
      const seen = new Set([a]);
      const stack = [a];
      while (stack.length && !seen.has(b)) {
        const u = stack.pop()!;
        for (const [x, y, dd] of list) {
          if (`${x}:${dd}` === key) continue;
          const o = x === u ? y : y === u ? x : -1;
          if (o >= 0 && !seen.has(o)) { seen.add(o); stack.push(o); }
        }
      }
      if (seen.has(b)) loops.add(key);
    }
  }
  return { live, depth, loose, loops };
}

export const power = (s: CircuitState): Power => powerOf(s.cols, s.rows, s.tiles, s.source);

export function solved(s: CircuitState): boolean {
  const p = power(s);
  return p.loose.length === 0 && p.live.every(Boolean) && p.loops.size === 0;
}

// ---- dealing --------------------------------------------------------------------------

/** A random tree of wires over the whole grid, grown from the source: each step joins a new tile
 *  to the tree, weighted toward carrying a wire straight on (`straight`) or toward branching a
 *  tile that already has two wires (`branch`). */
function grow(cols: number, rows: number, source: number, straight: number, branch: number, rng: Rng): number[] {
  const n = cols * rows;
  const w = Array(n).fill(0);
  const inTree = new Uint8Array(n);
  inTree[source] = 1;
  let count = 1;
  while (count < n) {
    const opts: [number, number, number][] = [];
    const weights: number[] = [];
    for (let u = 0; u < n; u++) {
      if (!inTree[u]) continue;
      const k = wireCount(w[u]);
      for (let d = 0; d < 4; d++) {
        const v = across(cols, rows, u, d);
        if (v < 0 || inTree[v]) continue;
        let wt = 1;
        if (k === 1) wt = w[u] & (1 << opposite(d)) ? straight : 1;
        else if (k === 2) wt = branch;
        else if (k === 3) wt = 0.08;
        opts.push([u, v, d]);
        weights.push(wt);
      }
    }
    const [u, v, d] = opts[weighted(rng, weights)];
    w[u] |= 1 << d;
    w[v] |= 1 << opposite(d);
    inTree[v] = 1;
    count++;
  }
  return w;
}

/**
 * Deals a board: a tree of wires grown over the grid from the cell, kept only when the solver
 * works it out with no guessing (so its answer is the only one), then every tile turned at
 * random, most of them away from the answer. Easy boards are kept only when they need no look
 * ahead; on harder ones the deal that needs the most look-ahead of a few is kept. Par is the
 * quarter turns, either way, that bring each tile back.
 */
export function newCircuit(d: number, seed: number): CircuitState {
  const rng = seeded(seed);
  const shape = circuitShape(d);
  const { cols, rows } = shape;
  const n = cols * rows;
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  const plain = d <= 20;
  const want = plain ? 1 : 1 + Math.round(t * 5);
  let best: { source: number; solution: number[]; order: { cell: number; why: Why }[]; ahead: number } | null = null;
  let kept = 0;
  for (let attempt = 0; kept < want && attempt < 400; attempt++) {
    const source = randInt(rng, n);
    const solution = grow(cols, rows, source, shape.straight, shape.branch, rng);
    const work = deduce(cols, rows, solution);
    if (!work.done) continue;
    const ahead = work.order.filter((o) => o.why === 'ahead').length;
    if (plain && ahead > 0 && attempt < 300) continue;
    kept++;
    if (!best || (plain ? ahead < best.ahead : ahead > best.ahead)) best = { source, solution, order: work.order, ahead };
  }
  if (!best) throw new Error('Circuit: no deal');
  const { source, solution, order } = best;
  for (;;) {
    const tiles = solution.map((m) => {
      const r = rotations(m).length;
      if (r === 1) return m;
      // Turned back k quarter turns, so k taps bring it home; a few start right.
      const k = rand(rng) < 0.12 ? 0 : 1 + randInt(rng, r - 1);
      let x = m;
      for (let i = 0; i < 4 - k; i++) x = cw(x);
      return x;
    });
    if (tiles.every((m, i) => m === solution[i])) continue;
    const par = tiles.reduce((sum, m, i) => sum + Math.abs(shortest(m, solution[i])), 0);
    return { cols, rows, tiles, solution, source, locked: Array(n).fill(false), moves: 0, par, order };
  }
}

// ---- play -----------------------------------------------------------------------------

export function cloneCircuit(s: CircuitState): CircuitState {
  return { ...s, tiles: s.tiles.slice(), locked: s.locked.slice() };
}

/** Turns tile i a quarter turn `times` times, clockwise for a positive count and counter-
 *  clockwise for a negative one; each quarter turn is a move. Null when it is locked or turning
 *  changes nothing (a cross). */
export function turn(s: CircuitState, i: number, times = 1): CircuitState | null {
  if (s.locked[i] || times === 0 || rotations(s.tiles[i]).length === 1) return null;
  let m = s.tiles[i];
  for (let k = 0; k < ((times % 4) + 4) % 4; k++) m = cw(m);
  const next = cloneCircuit(s);
  next.tiles[i] = m;
  next.moves += Math.abs(times);
  return next;
}

/** Locks or unlocks tile i. Not a move. */
export function toggleLock(s: CircuitState, i: number): CircuitState {
  const next = cloneCircuit(s);
  next.locked[i] = !s.locked[i];
  return next;
}

/** A locked tile lying against the answer, or -1. */
export function firstWrong(s: CircuitState): number {
  for (let i = 0; i < s.tiles.length; i++) if (s.locked[i] && s.tiles[i] !== s.solution[i]) return i;
  return -1;
}

/** The next tile to work out: the first in the solver's order not lying as in the answer. */
export function nextStep(s: CircuitState): { cell: number; why: Why } | null {
  for (const o of s.order) if (s.tiles[o.cell] !== s.solution[o.cell]) return o;
  return null;
}
