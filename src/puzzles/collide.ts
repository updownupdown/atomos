// Collide: a match-three of particles.
//
// A board of particle tiles, quarks and leptons, each its own color and letter. Swap two side by
// side to line up three or more of a kind: they collide and vanish, the tiles above fall, and
// new ones drop in from the top. Four in a line leaves a jet, which clears its whole row or
// column when it goes; five leave a shower, which clears every tile of one kind. Collect the
// targets shown above the board within the move budget.
//
// Nothing is luck once the board is dealt: the new tiles come down each column from a stream
// fixed by the deal, so a restart or an undo replays exactly the same tiles.
//
// Game rule, not physics: particles do not sit in rows, and three alike meeting do not vanish.

import { randInt, seeded, type Rng } from './rng';

/** A tile: its kind in the low three bits, its special in the next two. -1 is an empty cell,
 *  only ever seen while a move is being worked out. */
export type Tile = number;
export const EMPTY = -1;
/** Specials. */
export const PLAIN = 0, JET_ROW = 1, JET_COL = 2, SHOWER = 3;
/** The kind a shower carries: none. */
export const NO_KIND = 7;
export const SHOWER_TILE: Tile = NO_KIND | (SHOWER << 3);

export const kindOf = (t: Tile): number => t & 7;
export const specOf = (t: Tile): number => (t >> 3) & 3;
export const makeTile = (kind: number, spec = PLAIN): Tile => kind | (spec << 3);

/** The six kinds a board can hold: three quarks and three leptons. */
export const KIND_COUNT_MAX = 6;

export interface Target { kind: number; need: number }

export interface CollideState {
  w: number;
  h: number;
  kinds: number;
  seed: number;
  /** Row by row from the top. */
  cells: Tile[];
  /** How many tiles each column has drawn from its stream. */
  drawn: number[];
  targets: Target[];
  /** Tiles collected so far, by kind. */
  got: number[];
  budget: number;
  moves: number;
  par: number;
  /** Fixed refills for the rule pictures: each column's tiles in order, repeating. */
  feed?: number[][];
  /** The last swap, worked out step by step for the view to animate. */
  last: Turn | null;
}

/** One swap as it played out. A swap that made nothing has `bounce` and no steps. */
export interface Turn {
  a: number;
  b: number;
  bounce: boolean;
  steps: Step[];
  /** The board before a reshuffle, when the swap left no move to make. */
  shuffledFrom?: Tile[];
}

/** One wave of a cascade: the board as it stood, what cleared, what fired, and the board after
 *  the falls and refills, with how many rows each tile fell. */
export interface Step {
  grid: Tile[];
  clear: number[];
  make: { cell: number; tile: Tile }[];
  jets: { cell: number; dir: 1 | 2 }[];
  showers: { cell: number; kind: number; hits: number[] }[];
  after: Tile[];
  drop: number[];
}

// ---- the dial ------------------------------------------------------------------------

export interface CollideShape {
  w: number;
  h: number;
  kinds: number;
  /** How many kinds are targets, and how many of each to collect. */
  targetKinds: number;
  need: number;
  budget: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Tiles of each target kind to collect, along the dial. */
function needAt(d: number): number {
  if (d <= 20) return Math.round(lerp(12, 24, (d - 1) / 19));
  if (d <= 40) return Math.round(lerp(14, 20, (d - 21) / 19));
  if (d <= 60) return Math.round(lerp(13, 18, (d - 41) / 19));
  return Math.round(lerp(12, 20, (d - 61) / 39));
}

/**
 * The move budget at every tenth of the dial (and either side of each change of board), read
 * off how many moves a one-look greedy player needs: one that sees only the lines a swap makes,
 * not the cascades the new tiles bring, as a person does. The budget covers that player on 99%
 * of deals at the bottom of the dial, falling to about 60% at the top (tests/collide.test.ts
 * measures it).
 */
const BUDGETS: [number, number][] = [
  [1, 14], [10, 19], [20, 21], [21, 13], [30, 16], [40, 16], [41, 21], [50, 21], [60, 24], [61, 18], [70, 19], [80, 21], [90, 22], [100, 23],
];

function budgetAt(d: number): number {
  for (let i = 1; i < BUDGETS.length; i++) {
    const [d0, b0] = BUDGETS[i - 1], [d1, b1] = BUDGETS[i];
    if (d <= d1) return Math.round(lerp(b0, b1, (d - d0) / Math.max(1, d1 - d0)));
  }
  return BUDGETS[BUDGETS.length - 1][1];
}

/** Board parameters for difficulty dial d, 1 to 100. */
export function collideShape(d: number): CollideShape {
  d = Math.min(100, Math.max(1, Math.round(d)));
  const w = d <= 30 ? 7 : 8;
  const h = d <= 15 ? 7 : 8;
  const kinds = d <= 40 ? 5 : 6;
  const targetKinds = d <= 20 ? 1 : d <= 60 ? 2 : 3;
  return { w, h, kinds, targetKinds, need: needAt(d), budget: budgetAt(d) };
}

// ---- refills -------------------------------------------------------------------------

/** The kind of column x's n-th new tile: fixed by the deal's seed. */
function refill(s: { seed: number; kinds: number; feed?: number[][] }, x: number, n: number): Tile {
  if (s.feed) {
    const f = s.feed[x];
    return f && f.length ? f[n % f.length] : 0;
  }
  let k = (s.seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0;
  k = Math.imul(k ^ (k >>> 16), 0x7feb352d) >>> 0;
  k = Math.imul(k ^ (k >>> 15), 0x846ca68b) >>> 0;
  return randInt(seeded(k ^ (k >>> 16)), s.kinds);
}

// ---- matches -------------------------------------------------------------------------

export interface Run { cells: number[]; horiz: boolean }

/** Every line of three or more of a kind, across then down. Showers never match. */
export function findRuns(g: Tile[], w: number, h: number): Run[] {
  const runs: Run[] = [];
  const kindAt = (i: number) => (g[i] < 0 ? -1 : kindOf(g[i]) === NO_KIND ? -1 : kindOf(g[i]));
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const k = kindAt(y * w + x);
      let e = x + 1;
      while (e < w && k >= 0 && kindAt(y * w + e) === k) e++;
      if (k >= 0 && e - x >= 3) runs.push({ cells: Array.from({ length: e - x }, (_, j) => y * w + x + j), horiz: true });
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      const k = kindAt(y * w + x);
      let e = y + 1;
      while (e < h && k >= 0 && kindAt(e * w + x) === k) e++;
      if (k >= 0 && e - y >= 3) runs.push({ cells: Array.from({ length: e - y }, (_, j) => (y + j) * w + x), horiz: false });
      y = e;
    }
  }
  return runs;
}

/** Whether a line of three runs through cell i. */
function lineAt(g: Tile[], w: number, h: number, i: number): boolean {
  const k = kindOf(g[i]);
  if (g[i] < 0 || k === NO_KIND) return false;
  const x = i % w, y = (i / w) | 0;
  const same = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && g[yy * w + xx] >= 0 && kindOf(g[yy * w + xx]) === k;
  let a = 0, b = 0;
  while (same(x - a - 1, y)) a++;
  while (same(x + b + 1, y)) b++;
  if (a + b >= 2) return true;
  a = 0; b = 0;
  while (same(x, y - a - 1)) a++;
  while (same(x, y + b + 1)) b++;
  return a + b >= 2;
}

export const adjacent = (w: number, a: number, b: number): boolean =>
  a !== b && ((Math.abs(a - b) === 1 && ((a / w) | 0) === ((b / w) | 0)) || Math.abs(a - b) === w);

/** Whether swapping a and b does something: makes a line, or sets off a shower or two specials. */
export function swapWorks(g: Tile[], w: number, h: number, a: number, b: number): boolean {
  const ta = g[a], tb = g[b];
  if (ta < 0 || tb < 0) return false;
  if (specOf(ta) === SHOWER || specOf(tb) === SHOWER) return true;
  if (specOf(ta) !== PLAIN && specOf(tb) !== PLAIN) return true;
  if (ta === tb) return false;
  g[a] = tb; g[b] = ta;
  const ok = lineAt(g, w, h, a) || lineAt(g, w, h, b);
  g[a] = ta; g[b] = tb;
  return ok;
}

/** Every swap that does something, each pair once: [a, b] with b right of or below a. */
export function legalSwaps(s: CollideState): [number, number][] {
  const out: [number, number][] = [];
  const { w, h } = s;
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (x + 1 < w && swapWorks(s.cells, w, h, i, i + 1)) out.push([i, i + 1]);
    if (y + 1 < h && swapWorks(s.cells, w, h, i, i + w)) out.push([i, i + w]);
  }
  return out;
}

function hasSwap(g: Tile[], w: number, h: number): boolean {
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    if (x + 1 < w && swapWorks(g, w, h, i, i + 1)) return true;
    if (y + 1 < h && swapWorks(g, w, h, i, i + w)) return true;
  }
  return false;
}

// ---- a cascade -------------------------------------------------------------------------

interface Ctx { w: number; h: number; kinds: number; seed: number; feed?: number[][] }

/** The kind most tiles on the board are (ties to the lowest), for a shower hit by a blast. */
function commonest(g: Tile[], kinds: number): number {
  const n = new Array(KIND_COUNT_MAX).fill(0);
  for (const t of g) if (t >= 0 && kindOf(t) < kinds) n[kindOf(t)]++;
  let best = 0;
  for (let k = 1; k < kinds; k++) if (n[k] > n[best]) best = k;
  return best;
}

/**
 * Plays out a board from a swap: clears, fires the specials caught in it, lets the tiles fall,
 * refills, and goes round again while new lines form. `start` is what the swap itself set off
 * (cells to clear and showers' kinds) when it was a special's swap; `swapAt` are the swapped cells,
 * where a new special forms when the swap's own line makes one. Collected tiles are added to
 * `got`. Returns the steps when `record` is set.
 */
function cascade(c: Ctx, g: Tile[], drawn: number[], got: number[], start: { clear: number[]; showerKind: Map<number, number> } | null, swapAt: number[], record: boolean): { steps: Step[]; cleared: number } {
  const { w, h } = c;
  const steps: Step[] = [];
  let cleared = 0;
  let first = true;
  for (let wave = 0; wave < 60; wave++) {
    const runs = findRuns(g, w, h);
    const pending = first && start ? start.clear : [];
    if (!runs.length && !pending.length) break;
    const clear = new Set<number>(pending);
    const make = new Map<number, Tile>();
    for (const r of runs) {
      for (const i of r.cells) clear.add(i);
      if (r.cells.length < 4) continue;
      const own = first ? r.cells.find((i) => swapAt.includes(i)) : undefined;
      const pos = own ?? r.cells[(r.cells.length - 1) >> 1];
      if (make.has(pos)) continue;
      const k = kindOf(g[pos]);
      make.set(pos, r.cells.length >= 5 ? SHOWER_TILE : makeTile(k, r.horiz ? JET_ROW : JET_COL));
    }
    // Specials caught in the clear fire, and what they hit fires in turn.
    const jets: Step['jets'] = [];
    const showers: Step['showers'] = [];
    const fired = new Set<number>();
    const queue = [...clear].filter((i) => specOf(g[i]) !== PLAIN);
    while (queue.length) {
      const i = queue.shift()!;
      if (fired.has(i)) continue;
      fired.add(i);
      const sp = specOf(g[i]);
      const hit: number[] = [];
      if (sp === JET_ROW) {
        const y = (i / w) | 0;
        for (let x = 0; x < w; x++) hit.push(y * w + x);
        jets.push({ cell: i, dir: 1 });
      } else if (sp === JET_COL) {
        const x = i % w;
        for (let y = 0; y < h; y++) hit.push(y * w + x);
        jets.push({ cell: i, dir: 2 });
      } else if (sp === SHOWER) {
        const given = first && start ? start.showerKind.get(i) : undefined;
        const kind = given ?? commonest(g, c.kinds);
        if (kind === NO_KIND) for (let j = 0; j < w * h; j++) hit.push(j);
        else for (let j = 0; j < w * h; j++) if (g[j] >= 0 && kindOf(g[j]) === kind) hit.push(j);
        showers.push({ cell: i, kind, hits: hit.slice() });
      }
      for (const j of hit) {
        if (!clear.has(j)) clear.add(j);
        if (specOf(g[j]) !== PLAIN && !fired.has(j)) queue.push(j);
      }
    }
    const grid = record ? g.slice() : [];
    for (const i of clear) {
      const k = kindOf(g[i]);
      if (k < KIND_COUNT_MAX) got[k]++;
      g[i] = EMPTY;
    }
    cleared += clear.size;
    for (const [i, t] of make) g[i] = t;
    // Falls and refills, column by column.
    const drop = record ? new Array(w * h).fill(0) : [];
    for (let x = 0; x < w; x++) {
      let to = h - 1;
      for (let y = h - 1; y >= 0; y--) {
        const t = g[y * w + x];
        if (t < 0) continue;
        if (to !== y) {
          g[to * w + x] = t;
          g[y * w + x] = EMPTY;
          if (record) drop[to * w + x] = to - y;
        }
        to--;
      }
      const gap = to + 1;
      for (let y = to; y >= 0; y--) {
        g[y * w + x] = refill(c, x, drawn[x]++);
        if (record) drop[y * w + x] = gap;
      }
    }
    if (record) {
      steps.push({
        grid, clear: [...clear].sort((p, q) => p - q), make: [...make].map(([cell, tile]) => ({ cell, tile })),
        jets, showers, after: g.slice(), drop,
      });
    }
    first = false;
  }
  return { steps, cleared };
}

// ---- moves ---------------------------------------------------------------------------

export function cloneCollide(s: CollideState): CollideState {
  return { ...s, cells: s.cells.slice(), drawn: s.drawn.slice(), got: s.got.slice(), targets: s.targets.map((t) => ({ ...t })), last: null };
}

/**
 * Swaps cells a and b. A swap that makes nothing is not a move: it comes back with `bounce`
 * and the board unchanged (null when the cells are not neighbors, the board is won or out of
 * moves). `record` keeps the steps for the view.
 */
export function swap(s: CollideState, a: number, b: number, record = true): CollideState | null {
  if (!adjacent(s.w, a, b) || solved(s) || s.moves >= s.budget) return null;
  if (!swapWorks(s.cells, s.w, s.h, a, b)) {
    return record ? { ...s, last: { a, b, bounce: true, steps: [] } } : null;
  }
  const next: CollideState = { ...s, cells: s.cells.slice(), drawn: s.drawn.slice(), got: s.got.slice(), moves: s.moves + 1, last: null };
  const g = next.cells;
  const ta = g[a], tb = g[b];
  g[a] = tb; g[b] = ta;
  // A shower swapped with a tile clears its kind; two showers clear everything; two other
  // specials both fire where they now stand.
  let start: { clear: number[]; showerKind: Map<number, number> } | null = null;
  const sa = specOf(ta), sb = specOf(tb);
  if (sa === SHOWER || sb === SHOWER) {
    const kinds = new Map<number, number>();
    if (sa === SHOWER && sb === SHOWER) kinds.set(b, NO_KIND);
    else if (sa === SHOWER) kinds.set(b, kindOf(tb));
    else kinds.set(a, kindOf(ta));
    const at = sa === SHOWER ? b : a;
    start = { clear: [at, sa === SHOWER ? a : b], showerKind: kinds };
  } else if (sa !== PLAIN && sb !== PLAIN) {
    // A row and a column through where the second landed.
    g[a] = makeTile(kindOf(tb), JET_ROW);
    g[b] = makeTile(kindOf(ta), JET_COL);
    start = { clear: [a, b], showerKind: new Map() };
  }
  const ctx: Ctx = { w: s.w, h: s.h, kinds: s.kinds, seed: s.seed, feed: s.feed };
  const { steps } = cascade(ctx, g, next.drawn, next.got, start, [a, b], record);
  const turn: Turn = { a, b, bounce: false, steps };
  if (!s.feed && !solved(next) && !hasSwap(g, s.w, s.h)) {
    if (record) turn.shuffledFrom = g.slice();
    reshuffle(next);
  }
  if (record) next.last = turn;
  return next;
}

/** A board with no move left is shuffled, the same way every time for this deal and move. */
function reshuffle(s: CollideState): void {
  const rng = seeded((s.seed ^ Math.imul(s.moves + 7, 0x2c1b3c6d)) >>> 0);
  const g = s.cells;
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = g.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [g[i], g[j]] = [g[j], g[i]]; }
    if (!findRuns(g, s.w, s.h).length && hasSwap(g, s.w, s.h)) return;
  }
  const fresh = freshBoard(s.w, s.h, s.kinds, rng);
  for (let i = 0; i < g.length; i++) g[i] = fresh[i];
}

export function solved(s: CollideState): boolean {
  return s.targets.every((t) => s.got[t.kind] >= t.need);
}

export function outOfMoves(s: CollideState): boolean {
  return !solved(s) && s.moves >= s.budget;
}

/** How many of the targets' tiles are still to collect, all told. */
export function remaining(s: CollideState): number {
  return s.targets.reduce((n, t) => n + Math.max(0, t.need - s.got[t.kind]), 0);
}

// ---- greedy play ---------------------------------------------------------------------

const specials = (g: Tile[]): number => g.reduce((n, t) => n + (specOf(t) !== PLAIN ? 1 : 0), 0);

/** How good a swap is for a greedy player: target tiles collected first, then specials made,
 *  then tiles cleared. */
function score(before: CollideState, after: CollideState): number {
  let gain = 0, all = 0;
  for (const t of before.targets) gain += Math.min(after.got[t.kind] - before.got[t.kind], Math.max(0, t.need - before.got[t.kind]));
  for (let k = 0; k < KIND_COUNT_MAX; k++) all += after.got[k] - before.got[k];
  return gain * 1000 + (specials(after.cells) - specials(before.cells)) * 40 + all;
}

/** The swap a greedy player makes: the one that collects the most target tiles now (first in
 *  reading order on a tie). Null with no swap to make. */
export function bestSwap(s: CollideState): { a: number; b: number; gain: number } | null {
  let best: { a: number; b: number; gain: number } | null = null;
  let top = -Infinity;
  for (const [a, b] of legalSwaps(s)) {
    const next = swap(s, a, b, false);
    if (!next) continue;
    const v = score(s, next);
    if (v > top) {
      top = v;
      let gain = 0;
      for (const t of s.targets) gain += Math.min(next.got[t.kind] - s.got[t.kind], Math.max(0, t.need - s.got[t.kind]));
      best = { a, b, gain };
    }
  }
  return best;
}

/** The moves greedy play takes to win from here, up to `limit` more; Infinity when it can't. */
export function greedyMoves(s: CollideState, limit = s.budget - s.moves): number {
  let cur: CollideState = { ...s, budget: s.moves + limit };
  let n = 0;
  while (!solved(cur)) {
    if (n >= limit) return Infinity;
    const m = bestSwap(cur);
    if (!m) return Infinity;
    cur = swap(cur, m.a, m.b, false)!;
    n++;
  }
  return n;
}

/** A player who looks one swap ahead and sees only what the swap itself clears (its lines and
 *  the specials they fire), not the cascades the new tiles bring: roughly what a person sees.
 *  The moves it takes to win from here, up to `limit` more. Used to set the budgets. */
export function lookMoves(s0: CollideState, limit: number): number {
  let s: CollideState = { ...s0, budget: s0.moves + limit };
  let n = 0;
  while (!solved(s)) {
    if (n >= limit) return Infinity;
    let best: [number, number] | null = null, top = -1;
    for (const [a, b] of legalSwaps(s)) {
      const st = swap(s, a, b, true)!.last!.steps[0];
      let v = st.make.length * 30;
      for (const i of st.clear) {
        const k = kindOf(st.grid[i]);
        const t = s.targets.find((x) => x.kind === k);
        v += t && s.got[k] < t.need ? 100 : 1;
      }
      if (v > top) { top = v; best = [a, b]; }
    }
    if (!best) return Infinity;
    s = swap(s, best[0], best[1], false)!;
    n++;
  }
  return n;
}

// ---- dealing ---------------------------------------------------------------------------

/** A board with no line on it and at least one swap that makes one. */
function freshBoard(w: number, h: number, kinds: number, rng: Rng): Tile[] {
  for (;;) {
    const g: Tile[] = new Array(w * h).fill(EMPTY);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      const banned = new Set<number>();
      if (x >= 2 && g[i - 1] === g[i - 2]) banned.add(g[i - 1]);
      if (y >= 2 && g[i - w] === g[i - 2 * w]) banned.add(g[i - w]);
      const options = Array.from({ length: kinds }, (_, k) => k).filter((k) => !banned.has(k));
      g[i] = options[randInt(rng, options.length)];
    }
    if (hasSwap(g, w, h)) return g;
  }
}

/** One deal for the shape, before checking it can be won. */
function dealOnce(shape: CollideShape, seed: number, rng: Rng): CollideState {
  const { w, h, kinds } = shape;
  const cells = freshBoard(w, h, kinds, rng);
  const order = Array.from({ length: kinds }, (_, k) => k);
  for (let i = order.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const targets = order.slice(0, shape.targetKinds).sort((p, q) => p - q).map((kind) => ({ kind, need: shape.need }));
  return {
    w, h, kinds, seed: (seed ^ 0x5bd1e995 ^ randInt(rng, 0x7fffffff)) >>> 0, cells, drawn: new Array(w).fill(0), targets,
    got: new Array(KIND_COUNT_MAX).fill(0), budget: shape.budget, moves: 0, par: shape.budget, last: null,
  };
}

/**
 * Deals a board for dial d: a fresh board with no lines on it, the targets and the budget, kept
 * only when greedy play wins it within the budget (redealt otherwise), so every deal can be won
 * and Show me alone wins it.
 */
export function newCollide(d: number, seed: number): CollideState {
  const shape = collideShape(d);
  const rng = seeded(seed);
  let fallback: { s: CollideState; g: number } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const s = dealOnce(shape, seed + attempt * 7919, rng);
    const g = greedyMoves(s, s.budget + 12);
    if (g <= s.budget) return s;
    if (!fallback || g < fallback.g) fallback = { s, g };
  }
  // Never expected: the deal greedy came closest on, with the budget it needed.
  const s = fallback!.s;
  const budget = Number.isFinite(fallback!.g) ? fallback!.g : s.budget + 12;
  return { ...s, budget, par: budget };
}

/** The deal before the redeal check, for measuring how often greedy play wins a raw deal. */
export function rawCollide(d: number, seed: number): CollideState {
  return dealOnce(collideShape(d), seed, seeded(seed));
}

