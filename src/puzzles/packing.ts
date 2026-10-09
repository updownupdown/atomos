// Packing: fit a tray of pieces into an outline so nothing sticks out.
//
// A level is carved from its own answer: an outline blob is grown on a small
// grid, cut into polyominoes of two to five cells, and the pieces handed over
// shuffled and turned. Every piece can be moved, turned and lifted freely, so
// the board is never stuck. The outline is filled when all its cells are
// covered, which by construction means every piece is on it.
//
// Game rule, not physics: the pieces are "clusters" of electron-like droplets
// and the outline is a neutral socket; nothing here is labelled as an orbital.

import { pick, randInt, seeded, weighted, type Rng } from './rng';

export interface Cell { x: number; y: number }
export type Rot = 0 | 1 | 2 | 3;

export interface Piece {
  id: number;
  /** The shape at rotation 0, normalised so its minimum x and y are 0. */
  shape: Cell[];
  rot: Rot;
  /** Grid position of the rotated shape's top-left bounding corner; null while in the tray. */
  at: Cell | null;
}

export interface PackingState {
  w: number;
  h: number;
  /** Which grid cells belong to the outline (w*h, row-major). */
  outline: boolean[];
  pieces: Piece[];
  /** Placements made so far. */
  moves: number;
  /** One placement per piece. */
  par: number;
  /** Where each piece (by id) sits at rotation 0 in the carved answer. */
  solution: Cell[];
}

export type PackingMove =
  | { kind: 'place'; piece: number; at: Cell }
  | { kind: 'lift'; piece: number }
  | { kind: 'rotate'; piece: number };

const key = (c: Cell) => `${c.x},${c.y}`;

/** Shifts cells so the minimum x and y are 0 and orders them row by row. */
export function normalise(cells: Cell[]): Cell[] {
  const mx = Math.min(...cells.map((c) => c.x));
  const my = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - mx, y: c.y - my })).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The shape turned a quarter turn clockwise `rot` times, normalised. */
export function rotated(shape: Cell[], rot: Rot): Cell[] {
  let cells = shape;
  for (let i = 0; i < rot; i++) cells = cells.map((c) => ({ x: -c.y, y: c.x }));
  return normalise(cells);
}

/** The piece's cells in its current rotation, relative to its own top-left corner. */
export function cellsOf(p: Piece): Cell[] {
  return rotated(p.shape, p.rot);
}

export function bounds(cells: Cell[]): { w: number; h: number } {
  return { w: Math.max(...cells.map((c) => c.x)) + 1, h: Math.max(...cells.map((c) => c.y)) + 1 };
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

/** True when the piece, at the given rotation and corner, lies within the outline on free cells. */
export function canPlace(s: PackingState, id: number, at: Cell, rot?: Rot): boolean {
  const p = s.pieces.find((q) => q.id === id);
  if (!p) return false;
  const occ = occupancy(s);
  for (const c of rotated(p.shape, rot ?? p.rot)) {
    const x = at.x + c.x, y = at.y + c.y;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
    const i = y * s.w + x;
    if (!s.outline[i]) return false;
    if (occ[i] !== -1 && occ[i] !== id) return false;
  }
  return true;
}

export function solved(s: PackingState): boolean {
  const occ = occupancy(s);
  return s.outline.every((on, i) => !on || occ[i] !== -1);
}

/** Applies a move and returns the new state, or null when it changes nothing or is not allowed. */
export function applyMove(s: PackingState, m: PackingMove): PackingState | null {
  const next = clonePacking(s);
  const p = next.pieces.find((q) => q.id === m.piece);
  if (!p) return null;
  if (m.kind === 'place') {
    if (!canPlace(s, m.piece, m.at)) return null;
    if (p.at && p.at.x === m.at.x && p.at.y === m.at.y) return null;
    p.at = { ...m.at };
    next.moves += 1;
    return next;
  }
  if (m.kind === 'lift') {
    if (!p.at) return null;
    p.at = null;
    return next;
  }
  // Rotate about the bounding box centre; a turned piece that no longer fits drops back to the tray.
  const before = bounds(cellsOf(p));
  const rot = ((p.rot + 1) % 4) as Rot;
  const after = bounds(rotated(p.shape, rot));
  p.rot = rot;
  if (p.at) {
    const at = { x: p.at.x + Math.floor((before.w - after.w) / 2), y: p.at.y + Math.floor((before.h - after.h) / 2) };
    p.at = canPlace(next, p.id, at) ? at : null;
  }
  return next;
}

// ---- generation ------------------------------------------------------------------

function neighbours(c: Cell): Cell[] {
  return [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }];
}

/** How many cells the outline has for an element, and the grid that holds it. */
export function sizeFor(z: number): { w: number; h: number; n: number } {
  const n = 11 + Math.round((Math.min(118, Math.max(1, z)) * 19) / 118);
  const w = n <= 14 ? 4 : n <= 20 ? 5 : 6;
  const h = Math.min(6, Math.ceil(n / w) + 1);
  return { w, h, n };
}

/** Grows a compact blob of n cells from the grid centre. */
function growOutline(rng: Rng, w: number, h: number, n: number): boolean[] {
  const on: boolean[] = Array(w * h).fill(false);
  const idx = (c: Cell) => c.y * w + c.x;
  const inside = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h;
  on[idx({ x: Math.floor(w / 2), y: Math.floor(h / 2) })] = true;
  for (let count = 1; count < n; count++) {
    const frontier = new Map<string, Cell>();
    for (let i = 0; i < on.length; i++) {
      if (!on[i]) continue;
      for (const nb of neighbours({ x: i % w, y: Math.floor(i / w) })) if (inside(nb) && !on[idx(nb)]) frontier.set(key(nb), nb);
    }
    const cells = [...frontier.values()];
    const weights = cells.map((c) => {
      const k = neighbours(c).filter((nb) => inside(nb) && on[idx(nb)]).length;
      return k * k;
    });
    on[idx(cells[weighted(rng, weights)])] = true;
  }
  return on;
}

/** Cuts the outline into edge-connected pieces of 2 to 5 cells, or null when the cut leaves an orphan. */
function carve(rng: Rng, w: number, outline: boolean[]): Cell[][] | null {
  const owner: number[] = outline.map((on) => (on ? -1 : -2));
  const pieces: Cell[][] = [];
  const idx = (c: Cell) => c.y * w + c.x;
  const free = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < w && idx(c) < owner.length && owner[idx(c)] === -1;
  for (;;) {
    const open: Cell[] = [];
    owner.forEach((o, i) => { if (o === -1) open.push({ x: i % w, y: Math.floor(i / w) }); });
    if (!open.length) break;
    const seed = pick(rng, open);
    const target = 2 + randInt(rng, 4);
    const piece: Cell[] = [seed];
    owner[idx(seed)] = pieces.length;
    while (piece.length < target) {
      const frontier = new Map<string, Cell>();
      for (const c of piece) for (const nb of neighbours(c)) if (free(nb)) frontier.set(key(nb), nb);
      if (!frontier.size) break;
      const c = pick(rng, [...frontier.values()]);
      owner[idx(c)] = pieces.length;
      piece.push(c);
    }
    if (piece.length === 1) {
      // An orphan joins a small neighbour, or the cut is thrown away.
      const hosts = neighbours(seed).filter((nb) => nb.x >= 0 && nb.y >= 0 && nb.x < w && idx(nb) < owner.length && owner[idx(nb)] >= 0 && pieces[owner[idx(nb)]].length < 5);
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

/** A fresh level for an element: an outline and the pieces that fill it, shuffled and turned. */
export function newPacking(z: number, seed: number): PackingState {
  const rng = seeded(seed);
  const { w, h, n } = sizeFor(z);
  let outline = growOutline(rng, w, h, n);
  let cut: Cell[][] | null = null;
  for (let attempt = 0; attempt < 60 && !cut; attempt++) {
    cut = carve(rng, w, outline);
    if (!cut && attempt % 10 === 9) outline = growOutline(rng, w, h, n);
  }
  if (!cut) {
    // Vanishingly rare; a plain rectangle of dominoes keeps the level playable.
    outline = Array(w * h).fill(false);
    cut = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x += 2) {
      outline[y * w + x] = outline[y * w + x + 1] = true;
      cut.push([{ x, y }, { x: x + 1, y }]);
    }
  }
  const order = cut.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const solution: Cell[] = [];
  const pieces: Piece[] = order.map((src, id) => {
    const cells = cut[src];
    solution[id] = { x: Math.min(...cells.map((c) => c.x)), y: Math.min(...cells.map((c) => c.y)) };
    return { id, shape: normalise(cells), rot: randInt(rng, 4) as Rot, at: null };
  });
  return { w, h, outline, pieces, moves: 0, par: pieces.length, solution };
}

/** The carved answer applied to a level: every piece at its home at rotation 0. Used by tests and hints. */
export function solvedState(s: PackingState): PackingState {
  const next = clonePacking(s);
  next.pieces.forEach((p) => { p.rot = 0; p.at = { ...next.solution[p.id] }; });
  return next;
}
