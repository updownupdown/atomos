// Drop: pack a well with falling clusters of nucleons.
//
// A well, a few cells wide and deep, and a dealt queue of small clusters of one to four nucleons.
// The clusters come in order. For each one, choose where it goes (and, with a tap, which way it
// is turned) and let go: it falls straight down until it lands on the floor or on something
// already there. Fill the well to the brim with no gap left anywhere. A gap sealed under a
// cluster can never be filled, and the clusters add up to exactly the well, so every one counts.
//
// Every deal is built by filling the well with clusters that each land flush, so the dealt order
// always works. Par is one drop per cluster plus the fewest turns any answer needs, found by a
// search over the well's surface.
//
// Game rule, not physics: nucleons are not dropped into wells, and a nucleus is not square.

import { rand, randInt, seeded, weighted, type Rng } from './rng';

export type Cell = [number, number];

export interface Piece {
  /** Its cells as dealt, x right and y down from the top-left of its box. */
  cells: Cell[];
  /** protons[i]: cell i is a proton (else a neutron). */
  protons: boolean[];
}

export interface DropState {
  width: number;
  depth: number;
  /** Row by row from the top: -1 empty, else the index of the piece filling it. */
  grid: number[];
  pieces: Piece[];
  /** The piece to drop next (pieces.length once all are down). */
  next: number;
  /** Quarter turns clockwise the current piece has been given, 0 to 3. */
  rot: number;
  /** The column the current piece's left edge hangs over. */
  col: number;
  /** How many pieces after the current one the queue shows (99: all of them). */
  preview: number;
  /** The turns each piece was dropped with (for drawing it the way it fell). */
  turns: number[];
  moves: number;
  par: number;
}

/** The cluster shapes, by size: one to four cells, every one solid in each column. */
export const SHAPES: Cell[][][] = [
  [],
  [[[0, 0]]],
  [[[0, 0], [1, 0]]],
  [[[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [1, 1]]],
  [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[1, 0], [1, 1], [1, 2], [0, 2]],
  ],
];

export interface DropShape {
  width: number;
  depth: number;
  /** Weights of cluster sizes 1 to 4. */
  sizes: [number, number, number, number];
  preview: number;
  /** Whether pieces are dealt turned at random (else as the builder laid them). */
  turned: boolean;
  /** The least number of tempting dead ends along the way (see `traps`). */
  traps: number;
}

/**
 * The board for dial d (1 to 100). Very easy: a well four wide and three deep, small clusters,
 * the whole queue in view and every cluster dealt the right way up. The well widens to seven and
 * deepens to six, the clusters grow to fours, the queue shows fewer, and from Easy on clusters
 * come turned at random.
 */
export function dropShape(d: number): DropShape {
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  const width = d <= 15 ? 4 : d <= 45 ? 5 : d <= 80 ? 6 : 7;
  const depth = d <= 8 ? 3 : d <= 28 ? 4 : d <= 62 ? 5 : d <= 80 ? 6 : 5;
  const mono = Math.max(0, 3 - t * 8);
  const two = Math.max(0.6, 3 - t * 3.5);
  const three = 3;
  const four = 1 + t * 6;
  const preview = d <= 20 ? 99 : d <= 45 ? 4 : d <= 75 ? 3 : 2;
  const traps = d <= 20 ? 0 : d <= 40 ? 2 : d <= 60 ? 4 : d <= 80 ? 7 : 10;
  return { width, depth, sizes: [mono, two, three, four], preview, turned: d > 20, traps };
}

/** A piece's cells after `rot` quarter turns clockwise, back in the top-left corner. Cell order is
 *  kept, so each cell keeps its nucleon. */
export function turned(cells: Cell[], rot: number): Cell[] {
  let out = cells.map(([x, y]) => [x, y] as Cell);
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) {
    const h = Math.max(...out.map(([, y]) => y)) + 1;
    out = out.map(([x, y]) => [h - 1 - y, x]);
  }
  const mx = Math.min(...out.map(([x]) => x)), my = Math.min(...out.map(([, y]) => y));
  return out.map(([x, y]) => [x - mx, y - my]);
}

export const boxW = (cells: Cell[]): number => Math.max(...cells.map(([x]) => x)) + 1;
export const boxH = (cells: Cell[]): number => Math.max(...cells.map(([, y]) => y)) + 1;

const shapeKey = (cells: Cell[]): string => cells.map(([x, y]) => `${x},${y}`).sort().join(';');

/** The distinct ways a piece can face, each with the fewest taps from turn `from` that reach it. */
export function facings(cells: Cell[], from = 0): { rot: number; taps: number; cells: Cell[] }[] {
  const seen = new Map<string, { rot: number; taps: number; cells: Cell[] }>();
  for (let taps = 0; taps < 4; taps++) {
    const rot = (from + taps) % 4;
    const c = turned(cells, rot);
    const k = shapeKey(c);
    if (!seen.has(k)) seen.set(k, { rot, taps, cells: c });
  }
  return [...seen.values()];
}

export function current(s: DropState): Cell[] | null {
  return s.next < s.pieces.length ? turned(s.pieces[s.next].cells, s.rot) : null;
}

/** Where a piece with these cells, its left edge over column `col`, comes to rest: the row its
 *  box's top lands on. Null when it does not fit across the well or would stick out of the top. */
export function landing(s: DropState, cells: Cell[], col: number): number | null {
  const W = s.width, H = s.depth;
  if (col < 0 || col + boxW(cells) > W) return null;
  const free = (y0: number) => cells.every(([x, y]) => {
    const r = y0 + y;
    return r < H && (r < 0 || s.grid[r * W + col + x] < 0);
  });
  let y0 = -boxH(cells);
  while (free(y0 + 1)) y0++;
  return y0 < 0 ? null : y0;
}

/** Empty cells with something above them: gaps that can never be filled. */
export function sealed(s: DropState): number[] {
  const out: number[] = [];
  for (let x = 0; x < s.width; x++) {
    let roof = false;
    for (let y = 0; y < s.depth; y++) {
      const i = y * s.width + x;
      if (s.grid[i] >= 0) roof = true;
      else if (roof) out.push(i);
    }
  }
  return out;
}

export function solved(s: DropState): boolean {
  return s.grid.every((v) => v >= 0);
}

export function cloneDrop(s: DropState): DropState {
  return { ...s, grid: s.grid.slice(), turns: s.turns.slice() };
}

/** The current piece turned a quarter clockwise, kept inside the well. */
export function rotate(s: DropState): DropState | null {
  if (s.next >= s.pieces.length) return null;
  const next = cloneDrop(s);
  next.rot = (s.rot + 1) % 4;
  next.col = Math.max(0, Math.min(s.width - boxW(current(next)!), s.col));
  next.moves++;
  return next;
}

/** Moves the hanging piece to a column (no move counted). Null when nothing changes. */
export function slide(s: DropState, col: number): DropState | null {
  const c = current(s);
  if (!c) return null;
  const to = Math.max(0, Math.min(s.width - boxW(c), col));
  if (to === s.col) return null;
  return { ...s, col: to };
}

/** Drops the current piece where it hangs. Null when it cannot go there. */
export function drop(s: DropState): DropState | null {
  const c = current(s);
  if (!c) return null;
  const y0 = landing(s, c, s.col);
  if (y0 === null) return null;
  const next = cloneDrop(s);
  for (const [x, y] of c) next.grid[(y0 + y) * s.width + s.col + x] = s.next;
  next.turns[s.next] = s.rot;
  next.next++;
  next.rot = 0;
  next.moves++;
  if (next.next < s.pieces.length) next.col = Math.max(0, Math.min(s.width - boxW(s.pieces[next.next].cells), s.col));
  return next;
}

// ---- the search ----------------------------------------------------------------------

/** Each column's filled height, counted from the floor; null when a gap is sealed in. */
export function heights(s: DropState): number[] | null {
  if (sealed(s).length) return null;
  const h: number[] = [];
  for (let x = 0; x < s.width; x++) {
    let y = 0;
    while (y < s.depth && s.grid[y * s.width + x] < 0) y++;
    h.push(s.depth - y);
  }
  return h;
}

/** A facing ready for the search: its lowest and highest cell in each column of its box. */
interface Face { rot: number; taps: number; cells: Cell[]; bottom: number[]; top: number[] }

function face(f: { rot: number; taps: number; cells: Cell[] }): Face {
  const w = boxW(f.cells);
  const bottom = Array<number>(w).fill(-1), top = Array<number>(w).fill(99);
  for (const [x, y] of f.cells) { bottom[x] = Math.max(bottom[x], y); top[x] = Math.min(top[x], y); }
  return { ...f, bottom, top };
}

/** Every way to drop a facing flush on a surface: the column and the surface after. */
function flush(f: Face, h: number[], depth: number): { col: number; after: number[] }[] {
  const w = f.bottom.length;
  const out: { col: number; after: number[] }[] = [];
  for (let col = 0; col + w <= h.length; col++) {
    // The row the box's top lands on, and whether every column of the piece touches down.
    let y0 = Infinity;
    for (let x = 0; x < w; x++) y0 = Math.min(y0, depth - h[col + x] - 1 - f.bottom[x]);
    if (y0 < 0) continue;
    let ok = true;
    for (let x = 0; x < w && ok; x++) ok = y0 + f.bottom[x] === depth - h[col + x] - 1;
    if (!ok) continue;
    const after = h.slice();
    for (let x = 0; x < w; x++) after[col + x] = depth - (y0 + f.top[x]);
    out.push({ col, after });
  }
  return out;
}

export interface Step { rot: number; col: number; taps: number }

/**
 * A deal's search over the well's surface. A surface (each column's height) is packed into one
 * number, digit by digit in base depth + 1, so the search allocates almost nothing; what each
 * surface costs to finish from each piece on is remembered.
 */
class Search {
  private faces: Face[][];
  private base: number;
  private pow: number[];
  private full: number;
  /** Fewest moves to finish, by piece and surface. */
  readonly cost = new Map<number, number>();
  /** The best drop found from each piece and surface: facing index and column. */
  private choice = new Map<number, number>();
  /** One heights buffer per piece, so the recursion never shares one. */
  private bufs: number[][];

  /** Set once the search has looked at more surfaces than its limit; its answers are then void. */
  over = false;

  constructor(private readonly s: DropState, private readonly limit = Infinity) {
    this.faces = s.pieces.map((p) => facings(p.cells, 0).map(face));
    this.base = s.depth + 1;
    this.pow = Array.from({ length: s.width + 1 }, (_, c) => this.base ** c);
    this.full = this.code(Array(s.width).fill(s.depth));
    this.bufs = s.pieces.map(() => Array<number>(s.width).fill(0));
  }

  code(h: number[]): number {
    let k = 0;
    for (let c = h.length - 1; c >= 0; c--) k = k * this.base + h[c];
    return k;
  }

  decode(k: number, into: number[]): number[] {
    for (let c = 0; c < this.s.width; c++) { into[c] = k % this.base; k = Math.floor(k / this.base); }
    return into;
  }

  /** The surface after dropping facing f over column col on surface h, or -1 if not flush. */
  private after(f: Face, h: number[], hk: number, col: number): number {
    const w = f.bottom.length, depth = this.s.depth;
    let y0 = Infinity;
    for (let x = 0; x < w; x++) y0 = Math.min(y0, depth - h[col + x] - 1 - f.bottom[x]);
    if (y0 < 0) return -1;
    let k = hk;
    for (let x = 0; x < w; x++) {
      if (y0 + f.bottom[x] !== depth - h[col + x] - 1) return -1;
      k += (depth - (y0 + f.top[x]) - h[col + x]) * this.pow[col + x];
    }
    return k;
  }

  /** The fewest moves that finish from piece i on surface hk, the piece not yet turned. */
  best(i: number, hk: number): number {
    const s = this.s;
    if (i === s.pieces.length) return hk === this.full ? 0 : Infinity;
    const key = i * this.pow[s.width] + hk;
    const hit = this.cost.get(key);
    if (hit !== undefined) return hit;
    if (this.cost.size > this.limit) { this.over = true; return Infinity; }
    const h = this.decode(hk, this.bufs[i]);
    let cost = Infinity, pick = -1;
    const faces = this.faces[i];
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      for (let col = 0; col + f.bottom.length <= s.width; col++) {
        const nk = this.after(f, h, hk, col);
        if (nk < 0) continue;
        const c = f.taps + 1 + this.best(i + 1, nk);
        if (c < cost) { cost = c; pick = fi * 16 + col; }
        // best() above may have reused deeper buffers only, so h is intact.
      }
    }
    this.cost.set(key, cost);
    if (pick >= 0) this.choice.set(key, pick);
    return cost;
  }

  /** The cheapest answer from piece i on surface h, the piece already given `rot` turns. */
  plan(i: number, h: number[], rot: number): { cost: number; steps: Step[] } | null {
    const s = this.s;
    const hk = this.code(h);
    if (i >= s.pieces.length) return hk === this.full ? { cost: 0, steps: [] } : null;
    let first: { cost: number; step: Step; after: number } | null = null;
    for (const f of facings(s.pieces[i].cells, rot).map(face)) {
      for (let col = 0; col + f.bottom.length <= s.width; col++) {
        const nk = this.after(f, h, hk, col);
        if (nk < 0) continue;
        const c = f.taps + 1 + this.best(i + 1, nk);
        if (!first || c < first.cost) first = { cost: c, step: { rot: f.rot, col, taps: f.taps }, after: nk };
      }
    }
    if (!first || !Number.isFinite(first.cost)) return null;
    const steps = [first.step];
    let cur = first.after;
    for (let j = i + 1; j < s.pieces.length; j++) {
      const key = j * this.pow[s.width] + cur;
      const pick = this.choice.get(key)!;
      const f = this.faces[j][Math.floor(pick / 16)], col = pick % 16;
      steps.push({ rot: f.rot, col, taps: f.taps });
      cur = this.after(f, this.decode(cur, Array(s.width)), cur, col);
    }
    return { cost: first.cost, steps };
  }

  /** The flush drops of piece i on surface h, and whether the well can be filled after each. */
  options(i: number, h: number[]): { rot: number; col: number; after: number[]; alive: boolean }[] {
    const out: { rot: number; col: number; after: number[]; alive: boolean }[] = [];
    const hk = this.code(h);
    for (const f of this.faces[i]) for (let col = 0; col + f.bottom.length <= this.s.width; col++) {
      const nk = this.after(f, h, hk, col);
      if (nk < 0) continue;
      out.push({ rot: f.rot, col, after: this.decode(nk, Array(this.s.width)), alive: Number.isFinite(this.best(i + 1, nk)) });
    }
    return out;
  }
}

/** A search kept for one deal: what it learns about the deal's surfaces serves every later
 *  question about the same deal, so hints after the first are instant. */
export class DropSolver {
  private search: Search;
  constructor(private readonly deal: DropState) { this.search = new Search(deal); }

  /** The cheapest way to finish from s (a board of this deal), or null. */
  plan(s: DropState): { cost: number; steps: Step[] } | null {
    const h = heights(s);
    if (!h || s.pieces !== this.deal.pieces) return h ? plan(s) : null;
    return this.search.plan(s.next, h, s.rot);
  }
}

/**
 * The cheapest way to finish from here, in moves (a drop each plus every tap of a turn), and its
 * steps; null when the well can no longer be filled. Searches the surface of the well piece by
 * piece, remembering each surface it has finished from.
 */
export function plan(s: DropState): { cost: number; steps: Step[] } | null {
  const h = heights(s);
  if (!h) return null;
  return new Search(s).plan(s.next, h, s.rot);
}

/** Whether the well can still be filled from here. */
export function alive(s: DropState): boolean {
  return plan(s) !== null;
}

/**
 * How many tempting dead ends the deal holds: along the cheapest answer, at each piece, the
 * flush drops (any facing, any column) after which the well can no longer be filled.
 */
export function traps(s0: DropState): number {
  const h0 = heights(s0);
  if (!h0) return 0;
  return trapsOf(new Search(s0), s0, h0);
}

function trapsOf(search: Search, s0: DropState, h0: number[]): number {
  const p = search.plan(s0.next, h0, s0.rot);
  if (!p) return 0;
  let h = h0, count = 0;
  p.steps.forEach((step, k) => {
    const opts = search.options(s0.next + k, h);
    count += opts.filter((o) => !o.alive).length;
    h = opts.find((o) => o.rot === step.rot && o.col === step.col)!.after;
  });
  return count;
}

/** The state after dropping the current piece turned `rot` from its dealt way, over `col`. */
export function place(s: DropState, rot: number, col: number): DropState | null {
  return drop({ ...s, rot, col });
}

// ---- dealing --------------------------------------------------------------------------

/** Every cluster shape's facings, by size, for the builder. */
const BUILD_FACES = SHAPES.flatMap((list, size) => list.map((base) => ({ size, faces: facings(base).map(face) })));

/** Fills an empty well with randomly chosen flush drops, backing out of dead ends. */
function build(rng: Rng, shape: DropShape): { cells: Cell[] }[] | null {
  const W = shape.width, H = shape.depth;
  const out: { cells: Cell[] }[] = [];
  let budget = 4000;
  const step = (h: number[]): boolean => {
    if (h.every((v) => v === H)) return true;
    if (--budget < 0) return false;
    // Every drop covers the lowest column (the leftmost, if several): the well fills from the
    // floor up, and few surfaces are left that nothing can fill.
    let low = 0;
    for (let c = 1; c < W; c++) if (h[c] < h[low]) low = c;
    const options: { cells: Cell[]; after: number[]; w: number }[] = [];
    for (const { size, faces } of BUILD_FACES) {
      const wt = shape.sizes[size - 1] / SHAPES[size].length;
      if (wt <= 0) continue;
      for (const f of faces) for (const p of flush(f, h, H)) {
        if (p.col > low || p.col + f.bottom.length <= low) continue;
        options.push({ cells: f.cells.map(([x, y]) => [x + p.col, y] as Cell), after: p.after, w: wt });
      }
    }
    while (options.length) {
      const k = weighted(rng, options.map((o) => o.w));
      const o = options.splice(k, 1)[0];
      out.push({ cells: o.cells });
      if (step(o.after)) return true;
      out.pop();
      if (budget < 0) return false;
    }
    return false;
  };
  return step(Array(W).fill(0)) ? out : null;
}

/** The nucleons a cluster of n carries: true for a proton. A pair is one of each, like a
 *  deuteron; three are one way or the other; four are two and two, like an alpha particle. */
function nucleons(rng: Rng, n: number): boolean[] {
  const protons = n === 1 ? (rand(rng) < 0.5 ? 1 : 0) : n === 3 ? 1 + randInt(rng, 2) : n / 2;
  const out = Array.from({ length: n }, (_, i) => i < protons);
  for (let i = n - 1; i > 0; i--) { const j = randInt(rng, i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * Deals a well for dial d: the well filled with random flush drops gives the queue, in the order
 * they were laid; from Easy on each cluster is then dealt turned at random. Deals are redrawn
 * while they hold fewer tempting dead ends than the dial asks for. Par is the cheapest answer.
 */
export function newDrop(d: number, seed: number): DropState {
  const rng = seeded(seed);
  const shape = dropShape(d);
  let best: { s: DropState; score: number } | null = null;
  for (let attempt = 0; attempt < 8 || (!best && attempt < 60); attempt++) {
    const laid = build(rng, shape);
    if (!laid) continue;
    const pieces: Piece[] = laid.map(({ cells }) => {
      const mx = Math.min(...cells.map(([x]) => x));
      const norm = cells.map(([x, y]) => [x - mx, y] as Cell);
      const my = Math.min(...norm.map(([, y]) => y));
      const solid = norm.map(([x, y]) => [x, y - my] as Cell);
      const spun = shape.turned ? turned(solid, randInt(rng, 4)) : solid;
      return { cells: spun, protons: nucleons(rng, spun.length) };
    });
    const s: DropState = {
      width: shape.width, depth: shape.depth,
      grid: Array(shape.width * shape.depth).fill(-1),
      pieces, next: 0, rot: 0, col: 0, preview: shape.preview, turns: pieces.map(() => 0), moves: 0, par: 0,
    };
    s.col = Math.max(0, Math.floor((s.width - boxW(pieces[0].cells)) / 2));
    const h0 = Array<number>(s.width).fill(0);
    // Deals whose search runs long are passed over, which keeps dealing quick.
    const search = new Search(s, attempt < 8 ? 30000 : Infinity);
    const p = search.plan(0, h0, 0);
    if (!p || search.over) continue;
    s.par = p.cost;
    const score = shape.traps ? trapsOf(search, s, h0) : 0;
    if (search.over) continue;
    if (!best || score > best.score) best = { s, score };
    if (score >= shape.traps) break;
  }
  return best!.s;
}

/** The next good move from here: the cheapest answer's next step. Null when none is left. */
export function nextStep(s: DropState): Step | null {
  return plan(s)?.steps[0] ?? null;
}

