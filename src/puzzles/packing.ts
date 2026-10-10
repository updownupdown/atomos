// Packing: fit a tray of pieces into an outline so every open cell is filled.
//
// A level is carved from its own answer: an outline is grown on a small grid
// (a compact blob, a mirror-symmetric one, one with a hole through it, or a
// looser one with arms), a few of its cells are filled in advance as fixed
// blocks, and the rest is cut into polyominoes of two to five cells. The
// pieces are handed over shuffled and turned. Heavier elements bring larger
// outlines, more blocks, one decoy piece that belongs nowhere, and at the top
// of the table pieces that arrive mirrored and must be flipped. Every piece
// can be moved, turned, flipped (when allowed) and lifted freely, so the
// board is never stuck.
//
// Game rule, not physics: the pieces are neutral clusters and the outline a
// neutral socket; nothing here is labeled as a nucleus or an orbital.

import { pick, rand, randInt, seeded, weighted, type Rng } from './rng';

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

export type OutlineStyle = 'blob' | 'mirror' | 'ring' | 'arms';

export interface PackingState {
  w: number;
  h: number;
  /** Which grid cells belong to the outline (w*h, row-major), blocked ones included. */
  outline: boolean[];
  /** Outline cells filled from the start; nothing can go there. */
  blocked: boolean[];
  pieces: Piece[];
  /** Whether the flip control is offered. */
  flips: boolean;
  /** How many tray pieces belong nowhere (0 or 1). The view never says which. */
  decoys: number;
  style: OutlineStyle;
  /** Placements made so far. */
  moves: number;
  /** One placement per piece that belongs. */
  par: number;
  /** Where each piece (by id) sits at rotation 0, unflipped, in the carved answer; null for the decoy. */
  solution: (Cell | null)[];
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
    blocked: [...s.blocked],
    pieces: s.pieces.map((p) => ({ ...p, shape: p.shape.map((c) => ({ ...c })), at: p.at ? { ...p.at } : null })),
    solution: s.solution.map((c) => (c ? { ...c } : null)),
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

/** True when the piece, in the given orientation and corner, lies on open outline cells. */
export function canPlace(s: PackingState, id: number, at: Cell, rot?: Rot, flip?: boolean): boolean {
  const p = s.pieces.find((q) => q.id === id);
  if (!p) return false;
  const occ = occupancy(s);
  for (const c of oriented(p.shape, rot ?? p.rot, flip ?? p.flip)) {
    const x = at.x + c.x, y = at.y + c.y;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
    const i = y * s.w + x;
    if (!s.outline[i] || s.blocked[i]) return false;
    if (occ[i] !== -1 && occ[i] !== id) return false;
  }
  return true;
}

/** Open outline cells not yet covered. */
export function cellsLeft(s: PackingState): number {
  const occ = occupancy(s);
  let n = 0;
  s.outline.forEach((on, i) => { if (on && !s.blocked[i] && occ[i] === -1) n++; });
  return n;
}

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
    p.at = canPlace(next, p.id, at) ? at : null;
  }
  return next;
}

// ---- generation ------------------------------------------------------------------

function neighbors(c: Cell): Cell[] {
  return [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }];
}

export interface PackingPlan {
  /** Outline cells, blocked ones included. */
  n: number;
  w: number;
  h: number;
  blocked: number;
  decoys: number;
  flips: boolean;
}

/** How a level scales with the element: outline size, grid, blocks, decoy and flipping. */
export function sizeFor(z: number): PackingPlan {
  const zz = Math.min(118, Math.max(1, z));
  const n = 10 + Math.round((zz * 24) / 118);
  const w = Math.min(7, Math.ceil(Math.sqrt(n * 1.5)));
  const h = Math.min(7, Math.ceil((n * 1.5) / w));
  return {
    n, w, h,
    blocked: zz >= 80 ? 3 : zz >= 40 ? 2 : zz >= 12 ? 1 : 0,
    decoys: zz >= 30 ? 1 : 0,
    flips: zz >= 90,
  };
}

/** Grows an outline of n cells; the weights decide whether it is compact or has arms. */
function grow(rng: Rng, w: number, h: number, n: number, style: OutlineStyle): boolean[] | null {
  const on: boolean[] = Array(w * h).fill(false);
  const idx = (c: Cell) => c.y * w + c.x;
  const inside = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h;
  const mirror = (c: Cell): Cell => ({ x: w - 1 - c.x, y: c.y });
  const start = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  on[idx(start)] = true;
  let count = 1;
  if (style === 'mirror' && !on[idx(mirror(start))]) { on[idx(mirror(start))] = true; count++; }
  while (count < n) {
    const frontier = new Map<string, Cell>();
    for (let i = 0; i < on.length; i++) {
      if (!on[i]) continue;
      for (const nb of neighbors({ x: i % w, y: Math.floor(i / w) })) if (inside(nb) && !on[idx(nb)]) frontier.set(key(nb), nb);
    }
    let cells = [...frontier.values()];
    if (style === 'mirror') {
      // Cells added in mirror pairs; a lone center cell only when one is needed to land on n.
      cells = cells.filter((c) => (mirror(c).x === c.x ? true : n - count >= 2));
    }
    if (!cells.length) return null;
    const weights = cells.map((c) => {
      const k = neighbors(c).filter((nb) => inside(nb) && on[idx(nb)]).length;
      return style === 'arms' ? (k === 1 ? 3 : 1) : k * k;
    });
    const c = cells[weighted(rng, weights)];
    on[idx(c)] = true;
    count++;
    if (style === 'mirror' && !on[idx(mirror(c))]) { on[idx(mirror(c))] = true; count++; }
  }
  return count === n ? on : null;
}

/** A blob with one or two interior cells taken out, so the outline has a hole through it. */
function ring(rng: Rng, w: number, h: number, n: number): boolean[] | null {
  const holes = n >= 22 ? 2 : 1;
  const on = grow(rng, w, h, n + holes, 'blob');
  if (!on) return null;
  const interior = (i: number) => {
    const x = i % w, y = Math.floor(i / w);
    return on[i] && neighbors({ x, y }).every((nb) => nb.x >= 0 && nb.y >= 0 && nb.x < w && nb.y < h && on[nb.y * w + nb.x]);
  };
  for (let k = 0; k < holes; k++) {
    const options = on.map((_, i) => i).filter(interior);
    if (!options.length) return null;
    on[pick(rng, options)] = false;
  }
  return on;
}

/** Cuts the open cells into edge-connected pieces of 2 to 5 cells, or null when the cut leaves an orphan. */
function carve(rng: Rng, w: number, open: boolean[], big: boolean): Cell[][] | null {
  const owner: number[] = open.map((on) => (on ? -1 : -2));
  const pieces: Cell[][] = [];
  const idx = (c: Cell) => c.y * w + c.x;
  const valid = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < w && idx(c) < owner.length;
  const free = (c: Cell) => valid(c) && owner[idx(c)] === -1;
  for (;;) {
    const left: Cell[] = [];
    owner.forEach((o, i) => { if (o === -1) left.push({ x: i % w, y: Math.floor(i / w) }); });
    if (!left.length) break;
    const seed = pick(rng, left);
    // Larger outlines lean on larger pieces so the tray stays manageable.
    const target = 2 + weighted(rng, big ? [1, 3, 4, 3] : [3, 4, 3, 1]);
    const piece: Cell[] = [seed];
    owner[idx(seed)] = pieces.length;
    while (piece.length < target) {
      const frontier = new Map<string, Cell>();
      for (const c of piece) for (const nb of neighbors(c)) if (free(nb)) frontier.set(key(nb), nb);
      if (!frontier.size) break;
      const c = pick(rng, [...frontier.values()]);
      owner[idx(c)] = pieces.length;
      piece.push(c);
    }
    if (piece.length === 1) {
      // An orphan joins a small neighbor, or the cut is thrown away.
      const hosts = neighbors(seed).filter((nb) => valid(nb) && owner[idx(nb)] >= 0 && pieces[owner[idx(nb)]].length < 5);
      if (!hosts.length) return null;
      const host = owner[idx(pick(rng, hosts))];
      owner[idx(seed)] = host;
      pieces[host].push(seed);
      continue;
    }
    pieces.push(piece);
  }
  return pieces.length >= 2 ? pieces : null;
}

/** A random polyomino of `size` cells that matches none of the given shapes in any orientation. */
function decoyShape(rng: Rng, size: number, avoid: Set<string>): Cell[] | null {
  for (let tries = 0; tries < 60; tries++) {
    const cells: Cell[] = [{ x: 0, y: 0 }];
    while (cells.length < size) {
      const has = new Set(cells.map(key));
      const options = cells.flatMap(neighbors).filter((c) => !has.has(key(c)));
      cells.push(pick(rng, options));
    }
    const shape = normalize(cells);
    if (!avoid.has(canonical(shape))) return shape;
  }
  return null;
}

function chooseStyle(rng: Rng, z: number): OutlineStyle {
  if (z < 20) return pick(rng, ['blob', 'mirror'] as OutlineStyle[]);
  if (z < 50) return pick(rng, ['blob', 'mirror', 'ring'] as OutlineStyle[]);
  return pick(rng, ['blob', 'mirror', 'ring', 'arms'] as OutlineStyle[]);
}

/** A fresh level for an element: an outline and the pieces that fill it, shuffled and turned. */
export function newPacking(z: number, seed: number): PackingState {
  const rng = seeded(seed);
  const plan = sizeFor(z);
  const { w, h, n } = plan;
  for (let attempt = 0; attempt < 200; attempt++) {
    const style = chooseStyle(rng, z);
    const outline = style === 'ring' ? ring(rng, w, h, n) : grow(rng, w, h, n, style);
    if (!outline) continue;
    // Blocks go on cells with at least two outline neighbors, so they read as part of the shape.
    const blocked: boolean[] = Array(w * h).fill(false);
    const inner = outline.map((on, i) => i).filter((i) => outline[i] && neighbors({ x: i % w, y: Math.floor(i / w) }).filter((c) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h && outline[c.y * w + c.x]).length >= 2);
    for (let k = 0; k < plan.blocked && inner.length; k++) blocked[inner.splice(randInt(rng, inner.length), 1)[0]] = true;
    const open = outline.map((on, i) => on && !blocked[i]);
    let cut: Cell[][] | null = null;
    for (let t = 0; t < 12 && !cut; t++) cut = carve(rng, w, open, n >= 22);
    if (!cut) continue;
    const shapes = cut.map(normalize);
    let extra: Cell[] | null = null;
    if (plan.decoys) {
      extra = decoyShape(rng, 3 + randInt(rng, 3), new Set(shapes.map(canonical)));
      if (!extra) continue;
    }
    const all = extra ? [...cut, extra] : cut;
    const order = all.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const solution: (Cell | null)[] = [];
    const pieces: Piece[] = order.map((src, id) => {
      const cells = all[src];
      solution[id] = src < cut!.length ? { x: Math.min(...cells.map((c) => c.x)), y: Math.min(...cells.map((c) => c.y)) } : null;
      return { id, shape: normalize(cells), rot: randInt(rng, 4) as Rot, flip: plan.flips && rand(rng) < 0.5, at: null };
    });
    return crop({ w, h, outline, blocked, pieces, flips: plan.flips, decoys: extra ? 1 : 0, style, moves: 0, par: cut.length, solution });
  }
  return fallback(w, h);
}

/** Trims the grid to the outline's bounding box, so the board is drawn as large as it can be. */
function crop(s: PackingState): PackingState {
  const xs: number[] = [], ys: number[] = [];
  s.outline.forEach((on, i) => { if (on) { xs.push(i % s.w); ys.push(Math.floor(i / s.w)); } });
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  const take = (a: boolean[]) => Array.from({ length: w * h }, (_, i) => a[(y0 + Math.floor(i / w)) * s.w + x0 + (i % w)]);
  return { ...s, w, h, outline: take(s.outline), blocked: take(s.blocked), solution: s.solution.map((c) => (c ? { x: c.x - x0, y: c.y - y0 } : null)) };
}

/** A plain rectangle of dominoes, only if every attempt failed (never seen in tests). */
function fallback(w: number, h: number): PackingState {
  const outline: boolean[] = Array(w * h).fill(false);
  const pieces: Piece[] = [];
  const solution: Cell[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x += 2) {
    outline[y * w + x] = outline[y * w + x + 1] = true;
    solution.push({ x, y });
    pieces.push({ id: pieces.length, shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }], rot: 1, flip: false, at: null });
  }
  return { w, h, outline, blocked: Array(w * h).fill(false), pieces, flips: false, decoys: 0, style: 'blob', moves: 0, par: pieces.length, solution };
}

/** The carved answer applied to a level: every real piece at its home, unturned; the decoy left in the tray. */
export function solvedState(s: PackingState): PackingState {
  const next = clonePacking(s);
  next.pieces.forEach((p) => {
    const home = next.solution[p.id];
    p.rot = 0;
    p.flip = false;
    p.at = home ? { ...home } : null;
  });
  return next;
}

// ---- hints ------------------------------------------------------------------------

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

/** The open cells not yet covered, as a w*h mask. */
function freeCells(s: PackingState): boolean[] {
  const occ = occupancy(s);
  return s.outline.map((on, i) => on && !s.blocked[i] && occ[i] === -1);
}

const fits = (s: PackingState, free: ArrayLike<boolean | number>, cells: Cell[], ax: number, ay: number): boolean =>
  cells.every((c) => { const x = ax + c.x, y = ay + c.y; return x >= 0 && y >= 0 && x < s.w && y < s.h && free[y * s.w + x]; });

/**
 * One way to fill the open cells left with tray pieces, every placed piece staying where it is, or
 * null when there is none. A depth-first search that always covers the first open cell, row by
 * row, trying each distinct shape there once; it backs off as soon as a lone open cell is cut off
 * (every piece has at least two cells) and remembers the positions it has seen fail. The decoy may
 * stay in the tray, like any piece.
 */
export function completion(s: PackingState): Placement[] | null {
  const { w, h } = s;
  const free = Uint8Array.from(freeCells(s), Number);
  const tray = s.pieces.filter((p) => !p.at).map((p) => {
    const forms = formsOf(s, p);
    return { id: p.id, forms, kind: forms.map((f) => f.cells.map(key).join(';')).sort().join('|') };
  });
  const used = tray.map(() => false);
  const out: Placement[] = [];
  const failed = new Set<string>();
  // The cells covered so far and the pieces used, as bit masks (a grid has at most 49 cells).
  let lo = 0, hi = 0, usedBits = 0;
  const flipCell = (i: number) => { if (i < 30) lo ^= 1 << i; else hi ^= 1 << (i - 30); };
  const lone = (i: number) => {
    const x = i % w, y = (i - x) / w;
    return !((x > 0 && free[i - 1]) || (x < w - 1 && free[i + 1]) || (y > 0 && free[i - w]) || (y < h - 1 && free[i + w]));
  };
  // A free neighbor of a cell the piece just covered, walled in alone.
  const cutOff = (cells: number[]) => cells.some((i) => {
    const x = i % w;
    return (x > 0 && free[i - 1] && lone(i - 1)) || (x < w - 1 && free[i + 1] && lone(i + 1))
      || (i >= w && free[i - w] && lone(i - w)) || (i + w < w * h && free[i + w] && lone(i + w));
  });
  const go = (from: number): boolean => {
    let i = from;
    while (i < free.length && !free[i]) i++;
    if (i === free.length) return true;
    if (lone(i)) return false;
    const memo = `${lo}:${hi}:${usedBits}`;
    if (failed.has(memo)) return false;
    const x = i % w, y = (i - x) / w;
    const tried = new Set<string>();
    for (let k = 0; k < tray.length; k++) {
      if (used[k] || tried.has(tray[k].kind)) continue;
      tried.add(tray[k].kind);
      for (const f of tray[k].forms) {
        // The form's first cell (row by row) lands on the first open cell: anything earlier is covered.
        const ax = x - f.cells[0].x, ay = y - f.cells[0].y;
        if (!fits(s, free, f.cells, ax, ay)) continue;
        const cells = f.cells.map((c) => (ay + c.y) * w + ax + c.x);
        for (const j of cells) { free[j] = 0; flipCell(j); }
        used[k] = true;
        usedBits ^= 1 << k;
        out.push({ piece: tray[k].id, at: { x: ax, y: ay }, rot: f.rot, flip: f.flip });
        if (!cutOff(cells) && go(i + 1)) return true;
        out.pop();
        usedBits ^= 1 << k;
        used[k] = false;
        for (const j of cells) { free[j] = 1; flipCell(j); }
      }
    }
    failed.add(memo);
    return false;
  };
  return go(0) ? out : null;
}

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
