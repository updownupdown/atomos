// Sort: a spectrum sorted back into its lines.
//
// Glass vials hold stacks of colored bands, each band a spectral line of one hue. Tap a vial,
// then another, to pour: the run of like bands on top flows across onto a band of the same
// color or into an empty vial, as much of it as fits. Gather every color whole into a vial of
// its own. A few spare vials start empty, and par is the fewest pours the board allows, found by
// an A* search over the vials.
//
// Game rule, not physics: a spectrum is not poured; the vials are a way to sort light by hue.

import { randInt, seeded, type Rng } from './rng';

export interface Pour {
  from: number;
  to: number;
  color: number;
  count: number;
}

export interface SortState {
  /** Bands each vial holds when full; every color has exactly this many. */
  cap: number;
  colors: number;
  /** Each vial's bands, bottom to top, as color indices. */
  vials: number[][];
  moves: number;
  par: number;
  /** The last pour, for the view's animation. */
  last: Pour | null;
}

// ---- moves -----------------------------------------------------------------------------

/** The color of a vial's top band and how many like bands sit together on top. */
export function topRun(v: readonly number[]): { color: number; len: number } {
  if (!v.length) return { color: -1, len: 0 };
  const color = v[v.length - 1];
  let len = 1;
  while (len < v.length && v[v.length - 1 - len] === color) len++;
  return { color, len };
}

/** How many bands a pour from vial a into vial b would move: 0 when it cannot. */
export function pourCount(s: SortState, a: number, b: number): number {
  if (a === b) return 0;
  const va = s.vials[a], vb = s.vials[b];
  if (!va || !vb || !va.length || vb.length >= s.cap) return 0;
  const run = topRun(va);
  if (vb.length && vb[vb.length - 1] !== run.color) return 0;
  return Math.min(run.len, s.cap - vb.length);
}

/** Pours the top run of vial a into vial b; null when it cannot go. */
export function pour(s: SortState, a: number, b: number): SortState | null {
  const count = pourCount(s, a, b);
  if (!count) return null;
  const color = s.vials[a][s.vials[a].length - 1];
  const vials = s.vials.map((v) => v.slice());
  vials[a].length -= count;
  for (let k = 0; k < count; k++) vials[b].push(color);
  return { ...s, vials, moves: s.moves + 1, last: { from: a, to: b, color, count } };
}

/** A vial holding every band of one color. */
export function vialDone(s: SortState, i: number): boolean {
  const v = s.vials[i];
  return v.length === s.cap && v.every((c) => c === v[0]);
}

export function solved(s: SortState): boolean {
  return s.vials.every((v, i) => !v.length || vialDone(s, i));
}

/** Every pour that can be made, useful or not. */
export function legalPours(s: SortState): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < s.vials.length; a++) for (let b = 0; b < s.vials.length; b++) if (pourCount(s, a, b)) out.push([a, b]);
  return out;
}

/** No pour can be made and the board is not sorted. */
export function jammed(s: SortState): boolean {
  return !solved(s) && legalPours(s).length === 0;
}

// ---- the solver ------------------------------------------------------------------------
//
// Vials are strings of color codes. Two boards that differ only in the order of their vials are
// the same position, so positions are keyed by their sorted vials.
//
// The heuristic is a lower bound on the pours left: every band of a different color resting on
// another in a vial (a break) must be poured off at least once, and when one color lies at the
// bottom of several vials all but one of those must be emptied. One pour moves one run, so it
// mends at most one of these; the bound never overestimates and A* returns the fewest pours.

type Pos = string[];

const key = (p: Pos): string => p.slice().sort().join(',');

function lowerBound(p: Pos, colors: number): number {
  let h = 0;
  const bottoms = new Int8Array(colors);
  for (const v of p) {
    if (!v.length) continue;
    bottoms[v.charCodeAt(0) - 97]++;
    for (let i = 1; i < v.length; i++) if (v.charCodeAt(i) !== v.charCodeAt(i - 1)) h++;
  }
  for (let c = 0; c < colors; c++) if (bottoms[c] > 1) h += bottoms[c] - 1;
  return h;
}

function isGoal(p: Pos, cap: number): boolean {
  for (const v of p) {
    if (!v.length) continue;
    if (v.length !== cap) return false;
    for (let i = 1; i < v.length; i++) if (v.charCodeAt(i) !== v.charCodeAt(0)) return false;
  }
  return true;
}

/** The pours worth trying from a position: never a uniform vial into an empty one (nothing
 *  changes), and only into the first empty vial (they are all alike). */
function children(p: Pos, cap: number): { a: number; b: number; next: Pos }[] {
  const out: { a: number; b: number; next: Pos }[] = [];
  const n = p.length;
  let firstEmpty = -1;
  for (let i = 0; i < n; i++) if (!p[i].length) { firstEmpty = i; break; }
  for (let a = 0; a < n; a++) {
    const va = p[a];
    const la = va.length;
    if (!la) continue;
    const top = va.charCodeAt(la - 1);
    let run = 1;
    while (run < la && va.charCodeAt(la - 1 - run) === top) run++;
    for (let b = 0; b < n; b++) {
      if (b === a) continue;
      const vb = p[b];
      const lb = vb.length;
      if (lb >= cap) continue;
      if (!lb) {
        if (b !== firstEmpty || run === la) continue;
      } else if (vb.charCodeAt(lb - 1) !== top) continue;
      const k = Math.min(run, cap - lb);
      const next = p.slice();
      next[a] = va.slice(0, la - k);
      next[b] = vb + String.fromCharCode(top).repeat(k);
      out.push({ a, b, next });
    }
  }
  return out;
}

/** A small binary min-heap of node ids by priority. */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, p: number): void {
    const ids = this.ids, pri = this.pri;
    let i = ids.length;
    ids.push(id); pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      ids[i] = ids[up]; pri[i] = pri[up];
      i = up;
    }
    ids[i] = id; pri[i] = p;
  }
  pop(): number {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pri.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c]; pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId; pri[i] = lastP;
    }
    return top;
  }
}

export interface SolveResult {
  /** The pours, as [from, to] vial indices, in order; null when none was found. */
  path: [number, number][] | null;
  /** True when the search proved the path the fewest pours. */
  exact: boolean;
  /** True when every position was tried: a null path then means the board cannot be sorted. */
  exhausted: boolean;
  /** Positions expanded. */
  nodes: number;
}

/**
 * Searches for the fewest pours that sort the vials (A* with the bound above). `weight` above 1
 * trades the proof of fewest for speed. Gives up after `budget` positions.
 */
export function searchVials(vials: number[][], cap: number, colors: number, opts: { budget?: number; weight?: number } = {}): SolveResult {
  const budget = opts.budget ?? 60_000;
  const w = opts.weight ?? 1;
  const start: Pos = vials.map((v) => v.map((c) => String.fromCharCode(97 + c)).join(''));
  const pos: Pos[] = [start];
  const g: number[] = [0];
  const parent: number[] = [-1];
  const move: [number, number][] = [[-1, -1]];
  const best = new Map<string, number>([[key(start), 0]]);
  const heap = new Heap();
  // Ties go to the deeper position (closer to done).
  const BIG = 1024;
  heap.push(0, lowerBound(start, colors) * w * BIG);
  let nodes = 0;
  while (heap.size) {
    const id = heap.pop();
    const p = pos[id];
    const gi = g[id];
    if (best.get(key(p))! < gi) continue;
    if (isGoal(p, cap)) {
      const path: [number, number][] = [];
      for (let k = id; parent[k] >= 0; k = parent[k]) path.push(move[k]);
      return { path: path.reverse(), exact: w === 1, exhausted: false, nodes };
    }
    if (++nodes > budget) return { path: null, exact: false, exhausted: false, nodes };
    for (const ch of children(p, cap)) {
      const k = key(ch.next);
      const ng = gi + 1;
      const seen = best.get(k);
      if (seen !== undefined && seen <= ng) continue;
      best.set(k, ng);
      const nid = pos.length;
      pos.push(ch.next); g.push(ng); parent.push(id); move.push([ch.a, ch.b]);
      const f = ng + w * lowerBound(ch.next, colors);
      heap.push(nid, f * BIG - ng);
    }
  }
  return { path: null, exact: false, exhausted: true, nodes };
}

/** The fewest pours that sort a board, or null when it cannot be sorted or the search gave up. */
export function solveVials(vials: number[][], cap: number, colors: number, opts: { budget?: number; weight?: number } = {}): [number, number][] | null {
  return searchVials(vials, cap, colors, opts).path;
}

/** Whether the board can still be sorted: true, false, or null when the search gave up first. */
export function sortable(s: SortState, budget = 60_000): boolean | null {
  if (solved(s)) return true;
  const r = searchVials(s.vials, s.cap, s.colors, { budget, weight: 3 });
  return r.path ? true : r.exhausted ? false : null;
}

/** A plan from here: the fewest pours when that can be proved quickly, else a short one. Null
 *  when the board can no longer be sorted (or no plan was found). */
export function plan(s: SortState): [number, number][] | null {
  if (solved(s)) return [];
  return solveVials(s.vials, s.cap, s.colors, { budget: 12_000 }) ?? solveVials(s.vials, s.cap, s.colors, { budget: 60_000, weight: 2.5 });
}

// ---- deals -----------------------------------------------------------------------------

export interface SortShape {
  colors: number;
  cap: number;
  spares: number;
  /** How far the bands are shuffled, 0 (sorted) to 1 (fully). */
  mix: number;
  /** The fewest pours a deal must need, so a lucky shuffle never deals a near-sorted board. */
  minPar: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * The board for dial d (1 to 100). Colors rise from 3 to 9 and vials from 3 bands to 5, the
 * shuffle from light to full, all with two spare vials; the top of Expert (91 on) takes one
 * spare away from 6 or 7 colors, where every pour has to be planned.
 */
export function sortShape(d: number): SortShape {
  const x = Math.min(100, Math.max(1, Math.round(d)));
  let colors: number, cap: number, spares: number, mix: number;
  // How far into its run of same-sized boards the dial sits, 0 to 1: deeper in, the deal is
  // kept only when it needs more pours.
  let within: number;
  if (x >= 91) {
    colors = x < 96 ? 6 : 7;
    cap = 4;
    spares = 1;
    mix = 0.75;
    within = ((x - 91) % 5) / 4;
  } else {
    const raw = lerp(3, 9, ((x - 1) / 89) ** 0.85);
    colors = Math.round(raw);
    cap = x <= 10 ? 3 : x <= 64 ? 4 : 5;
    spares = 2;
    mix = Math.min(1, 0.35 + x / 30);
    within = Math.min(1, Math.max(0, raw - colors + 0.5));
  }
  const share = (spares === 1 ? 0.7 : 0.8) + 0.12 * within;
  const minPar = Math.max(3, Math.round(colors * (cap - 1) * share * Math.min(1, mix + 0.15)));
  return { colors, cap, spares, mix, minPar };
}

function shuffle<T>(rng: Rng, a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
}

/** The vials of one deal: sorted, then bands swapped between vials until mixed as asked. */
function dealOnce(shape: SortShape, rng: Rng): number[][] {
  const { colors, cap, spares } = shape;
  const order = Array.from({ length: colors }, (_, i) => i);
  shuffle(rng, order);
  const flat: number[] = [];
  for (const c of order) for (let k = 0; k < cap; k++) flat.push(c);
  if (shape.mix >= 1) shuffle(rng, flat);
  else {
    const swaps = Math.max(2, Math.round(shape.mix * flat.length));
    for (let k = 0; k < swaps; k++) {
      const i = randInt(rng, flat.length);
      // A partner in another vial.
      let j = randInt(rng, flat.length - cap);
      if (Math.floor(j / cap) >= Math.floor(i / cap)) j += cap;
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
  }
  const vials: number[][] = [];
  for (let v = 0; v < colors; v++) vials.push(flat.slice(v * cap, v * cap + cap));
  // Spare vials sit among the full ones.
  for (let k = 0; k < spares; k++) vials.splice(randInt(rng, vials.length + 1), 0, []);
  return vials;
}

/** Deals a board for dial d: shuffled vials, kept when no vial starts sorted, the board can be
 *  sorted at all, and its fewest pours (proved by the solver) is not too few. */
export function newSort(d: number, seed: number): SortState {
  const shape = sortShape(d);
  const rng = seeded(seed);
  const make = (vials: number[][], par: number): SortState => ({ cap: shape.cap, colors: shape.colors, vials, moves: 0, par, last: null });
  let fallback: { vials: number[][]; par: number } | null = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const vials = dealOnce(shape, rng);
    const s = make(vials, 0);
    if (vials.some((_, i) => vialDone(s, i))) continue;
    const path = solveVials(vials, shape.cap, shape.colors, { budget: 8_000 });
    if (!path) continue;
    if (path.length >= shape.minPar) return make(vials, path.length);
    if (!fallback || path.length > fallback.par) fallback = { vials, par: path.length };
  }
  if (fallback) return make(fallback.vials, fallback.par);
  // Never expected: a lightly mixed board with two spares, which always sorts.
  for (;;) {
    const vials = dealOnce({ ...shape, spares: 2, mix: 0.3 }, rng);
    const path = solveVials(vials, shape.cap, shape.colors, { budget: 200_000, weight: 2 });
    if (path) return make(vials, path.length);
  }
}

export function cloneSort(s: SortState): SortState {
  return { ...s, vials: s.vials.map((v) => v.slice()), last: null };
}
