// Packing (Tessera): fill a square board with a tray of pieces, every one of them used.
//
// The board is always a plain square, 4 by 4 at the start of the table and 7 by 7 at the end,
// with nothing filled in advance and nothing spare: the tray holds exactly the pieces that cover
// it. The challenge lives in the pieces. A deal is carved from its own answer: the square is
// tiled, by a randomized search, with polyominoes of three to six cells, every one a different
// shape, never a domino, with at most one tromino, few easy fits (straight bars and the 2 by 2
// square) and, near the end of the table, one hexomino. Several such cuts are carved per deal and
// each is measured by an exact cover solver that looks for its answers within a fixed number of
// search steps: a cut whose answers take many steps to find is tight, one that turns them up at
// once is loose. Light elements are dealt one of the looser cuts, and within each board size the
// deals tighten toward the heavier elements. Pieces are handed over shuffled and turned, and at
// the top of the table some arrive mirrored and must be flipped. Every piece can be moved,
// turned, flipped (when allowed) and lifted freely, so the board is never stuck; the same solver
// answers the hints.
//
// Game rule, not physics: the pieces are neutral clusters and the board a neutral socket;
// nothing here is labeled as a nucleus or an orbital.

import { rand, randInt, seeded, weighted, type Rng } from './rng';

export interface Cell { x: number; y: number }
export type Rot = 0 | 1 | 2 | 3;

export interface Piece {
  id: number;
  /** The shape at rotation 0, unflipped, normalized so its minimum x and y are 0. */
  shape: Cell[];
  rot: Rot;
  /** Mirrored left to right before turning. */
  flip: boolean;
  /** Grid position of the oriented shape's top-left bounding corner; null while in the tray. */
  at: Cell | null;
}

export interface PackingState {
  /** The board's side, twice: it is always a square. */
  w: number;
  h: number;
  /** Which grid cells belong to the board (w*h, row-major): all of them. */
  outline: boolean[];
  pieces: Piece[];
  /** Whether the flip control is offered. */
  flips: boolean;
  /** Placements made so far. */
  moves: number;
  /** One placement per piece. */
  par: number;
  /** Where each piece (by id) sits at rotation 0, unflipped, in the carved answer. */
  solution: Cell[];
}

export type PackingMove =
  /** Turned (and flipped) to rot and flip on the way down when they are given; still one placement. */
  | { kind: 'place'; piece: number; at: Cell; rot?: Rot; flip?: boolean }
  | { kind: 'lift'; piece: number }
  | { kind: 'rotate'; piece: number }
  | { kind: 'flip'; piece: number };

const key = (c: Cell) => `${c.x},${c.y}`;

/** Shifts cells so the minimum x and y are 0 and orders them row by row. */
export function normalize(cells: Cell[]): Cell[] {
  const mx = Math.min(...cells.map((c) => c.x));
  const my = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - mx, y: c.y - my })).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The shape turned a quarter turn clockwise `rot` times, normalized. */
export function rotated(shape: Cell[], rot: Rot): Cell[] {
  let cells = shape;
  for (let i = 0; i < rot; i++) cells = cells.map((c) => ({ x: -c.y, y: c.x }));
  return normalize(cells);
}

/** The shape mirrored left to right, normalized. */
export function mirrored(shape: Cell[]): Cell[] {
  return normalize(shape.map((c) => ({ x: -c.x, y: c.y })));
}

/** The shape in a given orientation. */
export function oriented(shape: Cell[], rot: Rot, flip: boolean): Cell[] {
  return rotated(flip ? mirrored(shape) : shape, rot);
}

/** The piece's cells in its current orientation, relative to its own top-left corner. */
export function cellsOf(p: Piece): Cell[] {
  return oriented(p.shape, p.rot, p.flip);
}

export function bounds(cells: Cell[]): { w: number; h: number } {
  return { w: Math.max(...cells.map((c) => c.x)) + 1, h: Math.max(...cells.map((c) => c.y)) + 1 };
}

/** One string for a shape in every orientation, so congruent shapes compare equal. */
export function canonical(shape: Cell[]): string {
  const forms: string[] = [];
  for (const flip of [false, true]) for (let r = 0; r < 4; r++) forms.push(oriented(shape, r as Rot, flip).map(key).join(';'));
  return forms.sort()[0];
}

export function clonePacking(s: PackingState): PackingState {
  return {
    ...s,
    outline: [...s.outline],
    pieces: s.pieces.map((p) => ({ ...p, shape: p.shape.map((c) => ({ ...c })), at: p.at ? { ...p.at } : null })),
    solution: s.solution.map((c) => ({ ...c })),
  };
}

/** Which piece id covers each grid cell, or -1. */
export function occupancy(s: PackingState): number[] {
  const occ: number[] = Array(s.w * s.h).fill(-1);
  for (const p of s.pieces) {
    if (!p.at) continue;
    for (const c of cellsOf(p)) occ[(p.at.y + c.y) * s.w + p.at.x + c.x] = p.id;
  }
  return occ;
}

/** True when the piece, in the given orientation and corner, lies on open board cells. */
export function canPlace(s: PackingState, id: number, at: Cell, rot?: Rot, flip?: boolean): boolean {
  const p = s.pieces.find((q) => q.id === id);
  if (!p) return false;
  const occ = occupancy(s);
  for (const c of oriented(p.shape, rot ?? p.rot, flip ?? p.flip)) {
    const x = at.x + c.x, y = at.y + c.y;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
    const i = y * s.w + x;
    if (!s.outline[i]) return false;
    if (occ[i] !== -1 && occ[i] !== id) return false;
  }
  return true;
}

/** Board cells not yet covered. */
export function cellsLeft(s: PackingState): number {
  const occ = occupancy(s);
  let n = 0;
  s.outline.forEach((on, i) => { if (on && occ[i] === -1) n++; });
  return n;
}

/** Every cell covered, which takes every piece: together they are exactly the board's area. */
export function solved(s: PackingState): boolean {
  return cellsLeft(s) === 0;
}

/** Applies a move and returns the new state, or null when it changes nothing or is not allowed. */
export function applyMove(s: PackingState, m: PackingMove): PackingState | null {
  const next = clonePacking(s);
  const p = next.pieces.find((q) => q.id === m.piece);
  if (!p) return null;
  if (m.kind === 'place') {
    const rot = m.rot ?? p.rot, flip = m.flip ?? p.flip;
    if (flip !== p.flip && !s.flips) return null;
    if (!canPlace(s, m.piece, m.at, rot, flip)) return null;
    if (p.at && p.at.x === m.at.x && p.at.y === m.at.y && rot === p.rot && flip === p.flip) return null;
    p.at = { ...m.at };
    p.rot = rot;
    p.flip = flip;
    next.moves += 1;
    return next;
  }
  if (m.kind === 'lift') {
    if (!p.at) return null;
    p.at = null;
    return next;
  }
  if (m.kind === 'flip' && !s.flips) return null;
  // Turn or flip in place about the bounding box center; a piece that no longer fits drops back to the tray.
  const before = bounds(cellsOf(p));
  if (m.kind === 'rotate') p.rot = ((p.rot + 1) % 4) as Rot;
  else {
    // Mirroring the base shape flips the piece left to right on screen whatever its turn.
    p.flip = !p.flip;
    p.rot = ((4 - p.rot) % 4) as Rot;
  }
  const after = bounds(cellsOf(p));
  if (p.at) {
    const at = { x: p.at.x + Math.floor((before.w - after.w) / 2), y: p.at.y + Math.floor((before.h - after.h) / 2) };
    // Checked with the piece lifted, so its own turned cells never mask a neighbor's.
    p.at = null;
    p.at = canPlace(next, p.id, at) ? at : null;
  }
  return next;
}

// ---- the solver ------------------------------------------------------------------

/** Where a piece goes: its top-left corner and its orientation. */
export interface Placement { piece: number; at: Cell; rot: Rot; flip: boolean }

interface Form { rot: Rot; flip: boolean; cells: Cell[] }

/** A piece's distinct orientations: its four turns, and their mirror images where flipping is offered. */
function formsOf(s: PackingState, p: Piece): Form[] {
  const out: Form[] = [];
  const seen = new Set<string>();
  for (const flip of s.flips ? [false, true] : [p.flip]) for (let r = 0; r < 4; r++) {
    const cells = oriented(p.shape, r as Rot, flip);
    const k = cells.map(key).join(';');
    if (!seen.has(k)) { seen.add(k); out.push({ rot: r as Rot, flip, cells }); }
  }
  return out;
}

/** The board cells not yet covered, as a w*h mask. */
function freeCells(s: PackingState): boolean[] {
  const occ = occupancy(s);
  return s.outline.map((on, i) => on && occ[i] === -1);
}

const fits = (s: PackingState, free: ArrayLike<boolean | number>, cells: Cell[], ax: number, ay: number): boolean =>
  cells.every((c) => { const x = ax + c.x, y = ay + c.y; return x >= 0 && y >= 0 && x < s.w && y < s.h && free[y * s.w + x]; });

interface Search {
  /** Answers found, up to the cap. */
  count: number;
  /** Search steps taken. */
  nodes: number;
  /** The first answer found, piece by piece. */
  first: Placement[] | null;
  /** True when the search ran to its end: count is then every answer there is. */
  complete: boolean;
}

/**
 * Every way to fill the open cells with all the tray pieces, every placed piece staying where it
 * is: a depth-first search that always covers the first open cell, row by row, so each answer is
 * met exactly once. The cells are bits in two words (a board has at most 64 cells). After each
 * piece goes down, the open regions it touches are measured, and the search backs off when one
 * of them cannot be made of the pieces left (too small, or a size no sum of them reaches). Stops
 * at maxCount answers (as scaled) or maxNodes steps; looking for one answer, it remembers the
 * positions it has searched through without one. With `oneWay`, one piece is held to a single
 * orientation that the board's turns (and flips, when offered) all move, so an answer and its
 * turned copies count once; `scale` says what one counted answer is worth when no piece could be
 * held.
 */
function search(s: PackingState, maxCount: number, maxNodes: number, oneWay = false): Search & { scale: number } {
  const { w, h } = s;
  const n = w * h;
  const free = freeCells(s);
  const tray = s.pieces.filter((p) => !p.at);
  const forms = tray.map((p) => formsOf(s, p));
  const group = s.flips ? 8 : 4;
  const held = oneWay && w === h ? forms.findIndex((f) => f.length === group) : -1;
  // Placements by piece and by the cell they cover first: [low word, high word, index into places].
  const places: Placement[] = [];
  const placeCells: number[][] = [];
  const at: number[][][] = tray.map(() => Array.from({ length: n }, () => []));
  tray.forEach((p, k) => {
    for (const f of held === k ? forms[k].slice(0, 1) : forms[k]) {
      const b = bounds(f.cells);
      for (let y = 0; y + b.h <= h; y++) for (let x = 0; x + b.w <= w; x++) {
        if (!fits(s, free, f.cells, x, y)) continue;
        let lo = 0, hi = 0;
        const cells = f.cells.map((c) => (y + c.y) * w + x + c.x);
        for (const i of cells) if (i < 32) lo |= 1 << i; else hi |= 1 << (i - 32);
        // The form's cells run row by row, so the first is the one it covers first.
        at[k][cells[0]].push(lo, hi, places.length);
        places.push({ piece: p.id, at: { x, y }, rot: f.rot, flip: f.flip });
        placeCells.push(cells);
      }
    }
  });
  const sizes = tray.map((p) => p.shape.length);
  const maxSize = Math.max(0, ...sizes);
  // Region sizes the pieces still in hand can make, by which pieces are in hand (memoized).
  const sumsMemo = new Map<number, Uint8Array>();
  const sumsOf = (used: number): Uint8Array => {
    let sums = sumsMemo.get(used);
    if (!sums) {
      sums = new Uint8Array(n + 1);
      sums[0] = 1;
      for (let k = 0; k < tray.length; k++) if (!(used & (1 << k))) for (let v = n - sizes[k]; v >= 0; v--) if (sums[v]) sums[v + sizes[k]] = 1;
      sumsMemo.set(used, sums);
    }
    return sums;
  };
  const filled = new Uint8Array(n);
  free.forEach((f, i) => { if (!f) filled[i] = 1; });
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) if (filled[i]) { if (i < 32) lo |= 1 << i; else hi |= 1 << (i - 32); }
  const nbrs: number[][] = Array.from({ length: n }, (_, i) => {
    const x = i % w, out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i + w < n) out.push(i + w);
    return out;
  });
  // A flood fill marks cells with a stamp, so nothing is cleared between fills.
  const mark = new Int32Array(n);
  let stamp = 0;
  const stack = new Int32Array(n);
  /** False when an open region next to these cells can no longer be filled by the pieces in hand. */
  const regionsOk = (cells: number[], used: number): boolean => {
    const sums = sumsOf(used);
    // Each fill gets its own stamp; a stamp from earlier in this call means a region already seen.
    const base = stamp + 1;
    // Regions larger than this are assumed fine: by then almost every size can be made.
    const limit = maxSize * 2 + 1;
    for (const c of cells) for (const start of nbrs[c]) {
      if (filled[start] || mark[start] >= base) continue;
      const id = ++stamp;
      let top = 0, size = 0, big = false;
      stack[top++] = start;
      mark[start] = id;
      while (top) {
        const v = stack[--top];
        if (++size > limit) { big = true; break; }
        for (const d of nbrs[v]) {
          if (filled[d] || mark[d] === id) continue;
          // A cell of a fill cut short earlier: the same region, already known to be large.
          if (mark[d] >= base) { big = true; break; }
          mark[d] = id;
          stack[top++] = d;
        }
        if (big) break;
      }
      if (!big && !sums[size]) return false;
    }
    return true;
  };
  const out: Search & { scale: number } = { count: 0, nodes: 0, first: null, complete: true, scale: oneWay && held < 0 ? 1 / group : 1 };
  const picked: number[] = [];
  // Worth its keep when looking for one answer; when counting many, the bookkeeping costs more than it saves.
  const remember = maxCount === 1;
  const dead = new Set<string>();
  let stop = false;
  const go = (from: number, used: number): void => {
    let i = from;
    while (i < n && filled[i]) i++;
    if (i === n) {
      if (!out.first) out.first = picked.map((pl) => places[pl]);
      if (++out.count * out.scale >= maxCount) stop = true;
      return;
    }
    if (++out.nodes > maxNodes) { stop = true; out.complete = false; return; }
    // A position already searched to its end without an answer has none this time either.
    const memo = remember ? `${lo},${hi},${used}` : '';
    if (remember && dead.has(memo)) return;
    const before = out.count;
    for (let k = 0; k < tray.length && !stop; k++) {
      if (used & (1 << k)) continue;
      const list = at[k][i];
      for (let j = 0; j < list.length && !stop; j += 3) {
        const plo = list[j], phi = list[j + 1];
        if ((plo & lo) | (phi & hi)) continue;
        const cells = placeCells[list[j + 2]];
        lo |= plo; hi |= phi;
        for (const c of cells) filled[c] = 1;
        picked.push(list[j + 2]);
        if (regionsOk(cells, used | (1 << k))) go(i + 1, used | (1 << k));
        picked.pop();
        for (const c of cells) filled[c] = 0;
        lo &= ~plo; hi &= ~phi;
      }
    }
    if (remember && !stop && out.count === before) dead.add(memo);
  };
  go(0, 0);
  if (stop && out.count * out.scale >= maxCount) out.complete = false;
  return out;
}

/** How constrained a deal is: its answers (each counted once, not once per turn of the board) and the search they took. */
export interface Measure {
  /** Distinct answers, up to the cap. */
  answers: number;
  /** Search steps the solver took. */
  nodes: number;
  /** True when every answer was counted, false when the count stopped at a cap. */
  complete: boolean;
}

/** Counts the ways to finish a board with its tray pieces, up to `cap` answers or `maxNodes` steps. */
export function measure(s: PackingState, cap = 10, maxNodes = 2000): Measure {
  const r = search(s, cap, maxNodes, true);
  return { answers: Math.max(r.count ? 1 : 0, Math.round(r.count * r.scale)), nodes: r.nodes, complete: r.complete };
}

/**
 * One way to fill the open cells left with the tray pieces, every placed piece staying where it
 * is, or null when there is none.
 */
export function completion(s: PackingState): Placement[] | null {
  return search(s, 1, 5e6).first;
}

// ---- generation ------------------------------------------------------------------

export interface PackingPlan {
  /** The board's side. */
  side: number;
  /** Relative odds of a piece's size, by cell count. */
  sizes: Record<number, number>;
  flips: boolean;
  /** Where the deal is taken among its measured cuts: 0 the loosest, 1 the most constrained. */
  pick: number;
}

/** The board grows a size every stretch of the table; within one, the deals tighten. */
const TIERS: { to: number; side: number; sizes: Record<number, number> }[] = [
  { to: 10, side: 4, sizes: { 3: 1, 4: 4, 5: 2 } },
  { to: 36, side: 5, sizes: { 3: 1, 4: 3, 5: 4 } },
  { to: 76, side: 6, sizes: { 3: 0.5, 4: 2, 5: 5 } },
  { to: 118, side: 7, sizes: { 4: 2, 5: 6 } },
];

/** How a level scales with the element: the board's side, the piece sizes, flipping and how tight a cut is dealt. */
export function sizeFor(z: number): PackingPlan {
  const zz = Math.min(118, Math.max(1, Math.round(z)));
  let from = 1;
  for (const t of TIERS) {
    if (zz <= t.to) {
      const u = (zz - from) / Math.max(1, t.to - from);
      // A hexomino joins the largest board from z 100.
      const sizes: Record<number, number> = zz >= 100 ? { ...t.sizes, 6: 1.5 } : { ...t.sizes };
      return { side: t.side, sizes, flips: zz >= 90, pick: 0.2 + 0.8 * u };
    }
    from = t.to + 1;
  }
  return sizeFor(118);
}

/** How many cuts are carved and measured for one deal. */
const CUTS = 6;

/** Piece sizes that add up to the board: at most one tromino and one hexomino, nothing smaller than three. */
function dealSizes(rng: Rng, plan: PackingPlan): number[] {
  const total = plan.side * plan.side;
  const kinds = Object.keys(plan.sizes).map(Number);
  for (let attempt = 0; attempt < 50; attempt++) {
    const out: number[] = [];
    let sum = 0;
    while (sum < total) {
      const left = total - sum;
      const opts = kinds.filter((k) => k <= left && (left - k === 0 || left - k >= 3) && ((k !== 3 && k !== 6) || !out.includes(k)));
      if (!opts.length) break;
      const k = opts[weighted(rng, opts.map((o) => plan.sizes[o]))];
      out.push(k);
      sum += k;
    }
    if (sum === total) return out;
  }
  // Only if every attempt fell short: fours with one tromino or one five to make up the rest.
  const out = Array(Math.floor(total / 4)).fill(4);
  if (total % 4 === 1) out[0] = 5;
  else if (total % 4 === 3) out.push(3);
  else if (total % 4 === 2) { out[0] = 5; out[1] = 5; }
  return out;
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A straight bar, or the 2 by 2 square: the pieces that fit almost anywhere. */
function easyFit(shape: Cell[]): boolean {
  const b = bounds(shape);
  return b.w === 1 || b.h === 1 || (shape.length === 4 && b.w === 2 && b.h === 2);
}

interface Kind { size: number; easy: boolean; forms: Cell[][] }

let kinds: Kind[] | null = null;

/**
 * Every free polyomino of three to six cells, each with its distinct orientations (row by row,
 * so a form's first cell is the one it covers first). Left out: the domino and the 2 by 3 and 1 by 6
 * hexominoes, which fill a square too easily.
 */
function library(): Kind[] {
  if (kinds) return kinds;
  const out: Kind[] = [];
  let level = new Map<string, Cell[]>([['0,0', [{ x: 0, y: 0 }]]]);
  for (let size = 2; size <= 6; size++) {
    const next = new Map<string, Cell[]>();
    for (const shape of level.values()) {
      const has = new Set(shape.map(key));
      for (const c of shape) for (const d of neighbors(c)) {
        if (has.has(key(d))) continue;
        const grown = normalize([...shape, d]);
        const k = canonical(grown);
        if (!next.has(k)) next.set(k, grown);
      }
    }
    level = next;
    if (size < 3) continue;
    for (const shape of level.values()) {
      const b = bounds(shape);
      if (size === 6 && (Math.min(b.w, b.h) === 1 || (b.w * b.h === 6))) continue;
      const forms = new Map<string, Cell[]>();
      for (const flip of [false, true]) for (let r = 0; r < 4; r++) {
        const f = oriented(shape, r as Rot, flip);
        forms.set(f.map(key).join(';'), f);
      }
      out.push({ size, easy: easyFit(shape), forms: [...forms.values()] });
    }
  }
  kinds = out;
  return out;
}

function neighbors(c: Cell): Cell[] {
  return [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }];
}

/**
 * Cuts the square into pieces of the given sizes, every one a different shape, or null when the
 * search runs out of steps. A randomized depth-first tiling: the first open cell, row by row, is
 * covered by an unused shape in some orientation, tried in random order; a step that leaves an open
 * region no remaining sizes can make is taken back. At most `easyCap` easy fits are used.
 */
function carve(rng: Rng, side: number, sizes: number[], easyCap: number): Cell[][] | null {
  const n = side * side;
  const lib = library();
  const need = new Map<number, number>();
  for (const k of sizes) need.set(k, (need.get(k) ?? 0) + 1);
  const filled = new Uint8Array(n);
  const used = new Uint8Array(lib.length);
  const cut: Cell[][] = [];
  let easy = 0, steps = 0;
  const seen = new Uint8Array(n);
  /** True when every open region can still be made from the sizes left. */
  const fillable = (): boolean => {
    const sums = new Uint8Array(n + 1);
    sums[0] = 1;
    for (const [k, c] of need) for (let j = 0; j < c; j++) for (let v = n - k; v >= 0; v--) if (sums[v]) sums[v + k] = 1;
    seen.fill(0);
    for (let i = 0; i < n; i++) {
      if (filled[i] || seen[i]) continue;
      let count = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!, x = c % side;
        count++;
        for (const d of [x > 0 ? c - 1 : -1, x < side - 1 ? c + 1 : -1, c - side, c + side]) {
          if (d >= 0 && d < n && !filled[d] && !seen[d]) { seen[d] = 1; stack.push(d); }
        }
      }
      if (!sums[count]) return false;
    }
    return true;
  };
  const go = (from: number): boolean => {
    let i = from;
    while (i < n && filled[i]) i++;
    if (i === n) return true;
    if (++steps > 1500) return false;
    const x0 = i % side, y0 = Math.floor(i / side);
    const opts: { kind: number; cells: number[] }[] = [];
    lib.forEach((kd, li) => {
      if (used[li] || !need.get(kd.size) || (kd.easy && easy >= easyCap)) return;
      for (const f of kd.forms) {
        const ax = x0 - f[0].x, ay = y0 - f[0].y;
        const cells: number[] = [];
        for (const c of f) {
          const x = ax + c.x, y = ay + c.y;
          if (x < 0 || y < 0 || x >= side || y >= side || filled[y * side + x]) break;
          cells.push(y * side + x);
        }
        if (cells.length === f.length) opts.push({ kind: li, cells });
      }
    });
    for (let k = opts.length - 1; k > 0; k--) {
      const j = randInt(rng, k + 1);
      [opts[k], opts[j]] = [opts[j], opts[k]];
    }
    for (const o of opts) {
      const kd = lib[o.kind];
      for (const c of o.cells) filled[c] = 1;
      used[o.kind] = 1;
      need.set(kd.size, need.get(kd.size)! - 1);
      if (kd.easy) easy++;
      cut.push(o.cells.map((c) => ({ x: c % side, y: Math.floor(c / side) })));
      if (fillable() && go(i + 1)) return true;
      cut.pop();
      if (kd.easy) easy--;
      need.set(kd.size, need.get(kd.size)! + 1);
      used[o.kind] = 0;
      for (const c of o.cells) filled[c] = 0;
      if (steps > 1500) return false;
    }
    return false;
  };
  return go(0) ? cut : null;
}

/** A level built from a cut: the pieces shuffled, turned and (where flipping is offered) sometimes mirrored. */
function dealOf(rng: Rng, side: number, cut: Cell[][], flips: boolean): PackingState {
  const order = shuffle(rng, cut.map((_, i) => i));
  const solution: Cell[] = [];
  const pieces: Piece[] = order.map((src, id) => {
    const cells = cut[src];
    solution[id] = { x: Math.min(...cells.map((c) => c.x)), y: Math.min(...cells.map((c) => c.y)) };
    return { id, shape: normalize(cells), rot: randInt(rng, 4) as Rot, flip: flips && rand(rng) < 0.5, at: null };
  });
  return { w: side, h: side, outline: Array(side * side).fill(true), pieces, flips, moves: 0, par: pieces.length, solution };
}

/** How tight a measured cut is: the search steps it took per answer found (log scale). */
const hardness = (m: Measure): number => Math.log2((1 + m.nodes) / (m.answers + 0.5));

/**
 * A fresh level for an element: a square and the pieces that fill it, shuffled and turned. Several
 * cuts are carved and measured; the plan's pick says which of them, loosest to tightest, is dealt.
 */
export function newPacking(z: number, seed: number): PackingState {
  const rng = seeded(seed);
  const plan = sizeFor(z);
  const side = plan.side;
  const easyCap = side >= 6 ? 1 : 2;
  const found: { s: PackingState; h: number }[] = [];
  for (let attempt = 0; attempt < 60 && found.length < CUTS; attempt++) {
    const sizes = dealSizes(rng, plan);
    // There are only five tetrominoes, two of them easy fits.
    if (sizes.filter((k) => k === 4).length > 3 + Math.min(2, easyCap)) continue;
    const cut = carve(rng, side, sizes, easyCap);
    if (!cut) continue;
    const s = dealOf(rng, side, cut, plan.flips);
    found.push({ s, h: hardness(measure(s)) });
  }
  if (!found.length) return fallback(side);
  // A stable sort, so equal cuts keep the order they were carved in.
  found.sort((a, b) => a.h - b.h);
  return found[Math.round(plan.pick * (found.length - 1))].s;
}

/** The square cut into straight columns, only if every attempt failed (never seen in tests). */
function fallback(side: number): PackingState {
  const cols: Cell[][] = Array.from({ length: side }, (_, x) => Array.from({ length: side }, (__, y) => ({ x, y })));
  return dealOf(seeded(1), side, cols, false);
}

/** The carved answer applied to a level: every piece at its home, unturned. */
export function solvedState(s: PackingState): PackingState {
  const next = clonePacking(s);
  next.pieces.forEach((p) => {
    p.rot = 0;
    p.flip = false;
    p.at = { ...next.solution[p.id] };
  });
  return next;
}

// ---- hints ------------------------------------------------------------------------

/** How many ways a tray piece could go down on the board as it is: every corner, every orientation. */
export function placesFor(s: PackingState, id: number): number {
  const p = s.pieces.find((q) => q.id === id);
  if (!p) return 0;
  const free = freeCells(s);
  let n = 0;
  for (const f of formsOf(s, p)) {
    const b = bounds(f.cells);
    for (let y = 0; y + b.h <= s.h; y++) for (let x = 0; x + b.w <= s.w; x++) if (fits(s, free, f.cells, x, y)) n++;
  }
  return n;
}

/**
 * The next piece to set, for the Hint: of one way to finish the board, the piece with the fewest
 * places it could go right now (the larger on a tie), where that way puts it. Null when the board
 * is full or can no longer be finished.
 */
export function nextPlacement(s: PackingState): Placement | null {
  const done = completion(s);
  if (!done?.length) return null;
  const size = (pl: Placement) => s.pieces.find((q) => q.id === pl.piece)!.shape.length;
  let best = done[0], bestN = Infinity;
  for (const pl of done) {
    const n = placesFor(s, pl.piece);
    if (n < bestN || (n === bestN && size(pl) > size(best))) { best = pl; bestN = n; }
  }
  return best;
}
