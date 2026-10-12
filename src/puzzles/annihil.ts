// Annihil: peg solitaire with matter and antimatter.
//
// Particles (red, filled) and antiparticles (blue, rings) sit in the holes of a board. A piece
// jumps over a neighboring piece of the opposite kind, straight along a row or column, into the
// empty hole just beyond, and the piece it jumped over is annihilated. Like never jumps like.
// Leave a single piece. Every board is built backward from one piece by undoing jumps, so every
// deal can be cleared; a solver checks it and measures how many wrong turns it holds.
//
// Game rule, not physics: a particle meeting its antiparticle destroys both, in a flash of
// gamma rays; here the jumper survives.

import { rand, randInt, seeded, type Rng } from './rng';

/** 0 an empty hole, 1 a particle, 2 an antiparticle. Cells off the board are never used. */
export type Piece = 0 | 1 | 2;

export interface AnnihilState {
  w: number;
  h: number;
  /** Which cells are holes of the board. */
  mask: boolean[];
  cells: Piece[];
  moves: number;
  par: number;
  /** The last jump, for the view to animate. */
  last: Jump | null;
}

export interface Jump {
  from: number;
  over: number;
  to: number;
}

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const opposite = (p: Piece): Piece => (p === 1 ? 2 : p === 2 ? 1 : 0);

export function pieceCount(s: { cells: Piece[] }): number {
  let n = 0;
  for (const c of s.cells) if (c) n++;
  return n;
}

/** The jumps from cell `from`, given the board. */
export function jumpsFrom(s: { w: number; h: number; mask: boolean[]; cells: Piece[] }, from: number): Jump[] {
  const p = s.cells[from];
  if (!p) return [];
  const out: Jump[] = [];
  const x = from % s.w, y = (from / s.w) | 0;
  for (let d = 0; d < 4; d++) {
    const x1 = x + DX[d], y1 = y + DY[d], x2 = x + 2 * DX[d], y2 = y + 2 * DY[d];
    if (x2 < 0 || y2 < 0 || x2 >= s.w || y2 >= s.h) continue;
    const over = y1 * s.w + x1, to = y2 * s.w + x2;
    if (!s.mask[to] || s.cells[to] || s.cells[over] !== opposite(p)) continue;
    out.push({ from, over, to });
  }
  return out;
}

export function allJumps(s: { w: number; h: number; mask: boolean[]; cells: Piece[] }): Jump[] {
  const out: Jump[] = [];
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i]) out.push(...jumpsFrom(s, i));
  return out;
}

export function solved(s: AnnihilState): boolean {
  return pieceCount(s) === 1;
}

/** No jump left with more than one piece on the board. */
export function deadEnd(s: AnnihilState): boolean {
  return pieceCount(s) > 1 && allJumps(s).length === 0;
}

/** Plays the jump from `from` to `to`; null when it is not a legal jump. */
export function jump(s: AnnihilState, from: number, to: number): AnnihilState | null {
  const j = jumpsFrom(s, from).find((m) => m.to === to);
  if (!j) return null;
  const cells = s.cells.slice();
  cells[to] = cells[from];
  cells[from] = 0;
  cells[j.over] = 0;
  return { ...s, cells, moves: s.moves + 1, last: j };
}

export function cloneAnnihil(s: AnnihilState): AnnihilState {
  return { ...s, mask: s.mask.slice(), cells: s.cells.slice(), last: null };
}

// ---- the solver ---------------------------------------------------------------------

/**
 * Searches the boards reachable from a position, in place on one array with a hash kept as it
 * goes (two 32-bit Zobrist halves folded into one number key). Two questions, both remembered
 * across calls for the same board shape:
 * - `canClear`: can the board still be cleared to one piece? A depth-first search that stops at
 *   the first way through and remembers the dead ends it proved.
 * - `odds`: the chance that jumping at random clears it, over every jump at every turn: how
 *   many wrong turns it holds. This visits every reachable board, so it has a budget, and
 *   returns null past it.
 */
export class Solver {
  private readonly n: number;
  /** For each cell and direction, the cell jumped over and the cell landed on (or -1). */
  private readonly over: Int16Array;
  private readonly land: Int16Array;
  private readonly z1: Int32Array;
  private readonly z2: Int32Array;
  private readonly chance = new Map<number, number>();
  private readonly clear = new Map<number, boolean>();
  private work: Int8Array;
  private h1 = 0;
  private h2 = 0;
  private count = 0;
  /** Boards visited so far, all questions together. */
  visited = 0;

  constructor(readonly w: number, readonly h: number, readonly mask: boolean[], private readonly budget = 200_000) {
    this.n = w * h;
    this.over = new Int16Array(this.n * 4).fill(-1);
    this.land = new Int16Array(this.n * 4).fill(-1);
    for (let i = 0; i < this.n; i++) {
      if (!mask[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (let d = 0; d < 4; d++) {
        const x2 = x + 2 * DX[d], y2 = y + 2 * DY[d];
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
        const o = (y + DY[d]) * w + x + DX[d], t = y2 * w + x2;
        if (!mask[o] || !mask[t]) continue;
        this.over[i * 4 + d] = o;
        this.land[i * 4 + d] = t;
      }
    }
    // Fixed random keys (a seeded stream, so every run hashes alike).
    const rng = seeded(0x9e3779b9 ^ (w * 131 + h));
    this.z1 = new Int32Array(this.n * 3);
    this.z2 = new Int32Array(this.n * 3);
    for (let i = 0; i < this.n * 3; i++) { this.z1[i] = (rand(rng) * 4294967296) | 0; this.z2[i] = (rand(rng) * 4294967296) | 0; }
    this.work = new Int8Array(this.n);
  }

  private load(cells: Piece[]): number {
    this.h1 = 0; this.h2 = 0;
    let pieces = 0;
    for (let i = 0; i < this.n; i++) {
      const p = cells[i] | 0;
      this.work[i] = p;
      if (p) { this.h1 ^= this.z1[i * 3 + p]; this.h2 ^= this.z2[i * 3 + p]; pieces++; }
    }
    return pieces;
  }

  private key(): number {
    return (this.h1 >>> 0) * 2097152 + (this.h2 & 0x1fffff);
  }

  private flip(i: number, p: number): void {
    this.h1 ^= this.z1[i * 3 + p];
    this.h2 ^= this.z2[i * 3 + p];
  }

  /** Whether the board can still be cleared to one piece. */
  canClear(cells: Piece[]): boolean {
    const pieces = this.load(cells);
    return this.dfs(pieces);
  }

  private dfs(pieces: number): boolean {
    if (pieces <= 1) return true;
    const k = this.key();
    const known = this.clear.get(k);
    if (known !== undefined) return known;
    const c = this.chance.get(k);
    if (c !== undefined) return c > 0;
    this.visited++;
    const g = this.work;
    for (let i = 0; i < this.n; i++) {
      const p = g[i];
      if (!p) continue;
      const q = 3 - p;
      for (let d = 0; d < 4; d++) {
        const o = this.over[i * 4 + d];
        if (o < 0 || g[o] !== q) continue;
        const t = this.land[i * 4 + d];
        if (g[t]) continue;
        g[t] = p; g[i] = 0; g[o] = 0;
        this.flip(i, p); this.flip(o, q); this.flip(t, p);
        const ok = this.dfs(pieces - 1);
        g[t] = 0; g[i] = p; g[o] = q;
        this.flip(i, p); this.flip(o, q); this.flip(t, p);
        if (ok) { this.clear.set(k, true); return true; }
      }
    }
    this.clear.set(k, false);
    return false;
  }

  /** The chance that random jumping clears the board, 0 to 1; null past the budget. */
  odds(cells: Piece[]): number | null {
    const pieces = this.load(cells);
    this.count = 0;
    const v = this.walk(pieces);
    return v < 0 ? null : v;
  }

  private walk(pieces: number): number {
    if (pieces <= 1) return 1;
    const k = this.key();
    const known = this.chance.get(k);
    if (known !== undefined) return known;
    if (++this.count > this.budget) return -1;
    this.visited++;
    const g = this.work;
    let moves = 0, sum = 0;
    for (let i = 0; i < this.n; i++) {
      const p = g[i];
      if (!p) continue;
      const q = 3 - p;
      for (let d = 0; d < 4; d++) {
        const o = this.over[i * 4 + d];
        if (o < 0 || g[o] !== q) continue;
        const t = this.land[i * 4 + d];
        if (g[t]) continue;
        g[t] = p; g[i] = 0; g[o] = 0;
        this.flip(i, p); this.flip(o, q); this.flip(t, p);
        const r = this.walk(pieces - 1);
        g[t] = 0; g[i] = p; g[o] = q;
        this.flip(i, p); this.flip(o, q); this.flip(t, p);
        if (r < 0) return -1;
        moves++;
        sum += r;
      }
    }
    const v = moves ? sum / moves : 0;
    this.chance.set(k, v);
    return v;
  }
}

/** A good next jump from here: of the jumps that keep the board clearable, the first found.
 *  Null when none does. */
export function nextJump(s: AnnihilState, solver = new Solver(s.w, s.h, s.mask)): Jump | null {
  for (const m of allJumps(s)) {
    const next = jump(s, m.from, m.to)!;
    if (solver.canClear(next.cells)) return m;
  }
  return null;
}

// ---- the dial -----------------------------------------------------------------------

export interface AnnihilShape {
  w: number;
  h: number;
  /** Corner cells cut from the rectangle: how deep each corner's notch can go. */
  cut: number;
  pieces: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Board parameters for difficulty dial d, 1 to 100. */
export function annihilShape(d: number): AnnihilShape {
  d = Math.min(100, Math.max(1, Math.round(d)));
  const t = (d - 1) / 99;
  const pieces = Math.round(lerp(4, 15, t));
  const size = d <= 12 ? 4 : d <= 35 ? 5 : d <= 65 ? 6 : 7;
  const cut = size <= 4 ? 0 : size === 5 ? 1 : 2;
  return { w: size, h: size, cut, pieces };
}

/** The holes: a square with its corners notched, each by its own depth (0 to `cut`). */
function makeMask(w: number, h: number, cut: number, rng: Rng): boolean[] {
  const mask = new Array(w * h).fill(true);
  if (!cut) return mask;
  const corners: [number, number, number, number][] = [[0, 0, 1, 1], [w - 1, 0, -1, 1], [0, h - 1, 1, -1], [w - 1, h - 1, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    const depth = randInt(rng, cut + 1);
    // A stair-step notch: depth cells along each edge, cut diagonally.
    for (let i = 0; i < depth; i++) for (let j = 0; i + j < depth; j++) mask[(cy + sy * j) * w + cx + sx * i] = false;
  }
  return mask;
}

/** One board built backward: a single piece, then `pieces - 1` jumps undone at random. */
function buildBackward(w: number, h: number, mask: boolean[], pieces: number, rng: Rng): Piece[] | null {
  const cells: Piece[] = new Array(w * h).fill(0);
  const holes = mask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  // Start near the middle more often than at the rim.
  const mid = holes.filter((i) => { const x = i % w, y = (i / w) | 0; return x > 0 && y > 0 && x < w - 1 && y < h - 1; });
  const from = mid.length && rand(rng) < 0.7 ? mid : holes;
  const start = from[randInt(rng, from.length)];
  cells[start] = rand(rng) < 0.5 ? 1 : 2;
  for (let n = 1; n < pieces; n++) {
    // Every undone jump: a piece at A came from C over B, both empty now.
    const options: [number, number, number][] = [];
    for (let a = 0; a < cells.length; a++) {
      if (!cells[a]) continue;
      const x = a % w, y = (a / w) | 0;
      for (let d = 0; d < 4; d++) {
        const bx = x + DX[d], by = y + DY[d], cx = x + 2 * DX[d], cy = y + 2 * DY[d];
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const b = by * w + bx, c = cy * w + cx;
        if (!mask[b] || !mask[c] || cells[b] || cells[c]) continue;
        options.push([a, b, c]);
      }
    }
    if (!options.length) return null;
    const [a, b, c] = options[randInt(rng, options.length)];
    cells[c] = cells[a];
    cells[a] = 0;
    cells[b] = opposite(cells[c]);
  }
  return cells;
}

/** Boards built per deal; the dial picks among them by how forgiving they are. */
const CANDIDATES = 8;

/**
 * Deals a board for dial d: eight boards built backward from one piece, each solved forward to
 * be sure it clears, and ranked by the chance that random jumping clears it (how many wrong
 * turns it holds). The bottom of the dial takes the most forgiving, the top the least. Par is
 * the jumps it takes: one fewer than the pieces.
 */
export function newAnnihil(d: number, seed: number): AnnihilState {
  const shape = annihilShape(d);
  const t = (Math.min(100, Math.max(1, d)) - 1) / 99;
  const rng = seeded(seed);
  const built: { s: AnnihilState; odds: number }[] = [];
  for (let attempt = 0; attempt < CANDIDATES * 4 && built.length < CANDIDATES; attempt++) {
    const mask = makeMask(shape.w, shape.h, shape.cut, rng);
    const cells = buildBackward(shape.w, shape.h, mask, shape.pieces, rng);
    if (!cells) continue;
    const solver = new Solver(shape.w, shape.h, mask, 12_000);
    if (!solver.canClear(cells)) continue;
    // A board too big to weigh in full counts as the least forgiving.
    const odds = solver.odds(cells) ?? 0;
    built.push({ s: { w: shape.w, h: shape.h, mask, cells, moves: 0, par: shape.pieces - 1, last: null }, odds });
  }
  if (!built.length) throw new Error('Annihil: no board');
  // Most forgiving first; ties keep the order they were built in.
  const ranked = built.map((b, i) => ({ ...b, i })).sort((p, q) => q.odds - p.odds || p.i - q.i);
  return ranked[Math.round(t * (ranked.length - 1))].s;
}

/** The chance random jumping clears a dealt board, for measuring. */
export function randomOdds(s: AnnihilState): number | null {
  return new Solver(s.w, s.h, s.mask, 2_000_000).odds(s.cells);
}
