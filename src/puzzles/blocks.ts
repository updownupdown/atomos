// Blocks: cut the grid into rectangles.
//
// Numbers sit in some cells. Cut the whole grid into rectangles so that each holds exactly one
// number, and that number is its area in cells. Drag from corner to corner to draw one; a new
// rectangle replaces any it overlaps; tap one to remove it. Every deal has exactly one answer,
// and a step-by-step human-style solver reaches it without guessing.
//
// Game rule, not physics: the colors borrow the subshells' sizes (an s subshell holds 2
// electrons, p 6, d 10, f 14), but nothing in an atom is cut into rectangles.

import { rand, randInt, seeded, type Rng } from './rng';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Clue { cell: number; area: number }

export interface BlocksState {
  size: number;
  clues: Clue[];
  /** The player's rectangles, oldest first. */
  rects: Rect[];
  /** The one answer: each clue's rectangle, in clue order. */
  solution: Rect[];
  /** Rectangles drawn. */
  moves: number;
  /** One rectangle per number. */
  par: number;
  /** How the solver rated the deal. */
  score: number;
}

// ---- rectangles -------------------------------------------------------------------------------

export const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const holds = (r: Rect, n: number, cell: number): boolean => {
  const x = cell % n, y = Math.floor(cell / n);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
};
export function cellsOf(r: Rect, n: number): number[] {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(y * n + x);
  return out;
}
/** The rectangle with two cells as opposite corners. */
export function spanning(n: number, a: number, b: number): Rect {
  const ax = a % n, ay = Math.floor(a / n), bx = b % n, by = Math.floor(b / n);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx) + 1, h: Math.abs(ay - by) + 1 };
}

// ---- rules ------------------------------------------------------------------------------------

/** What is wrong with a rectangle: no number, more than one, or one that is not its area. */
export type Flaw = 'none' | 'many' | 'area' | null;

export function flawOf(s: BlocksState, r: Rect): Flaw {
  const inside = s.clues.filter((c) => holds(r, s.size, c.cell));
  if (!inside.length) return 'none';
  if (inside.length > 1) return 'many';
  return inside[0].area === r.w * r.h ? null : 'area';
}

/** The player's rectangles that break a rule, by index. */
export function flawed(s: BlocksState): number[] {
  const out: number[] = [];
  s.rects.forEach((r, i) => { if (flawOf(s, r)) out.push(i); });
  return out;
}

export function covered(s: BlocksState): number {
  return s.rects.reduce((a, r) => a + r.w * r.h, 0);
}

export function solved(s: BlocksState): boolean {
  return covered(s) === s.size * s.size && s.rects.length === s.clues.length && flawed(s).length === 0;
}

/** A rectangle that is not part of the answer, by index, or -1. */
export function firstWrong(s: BlocksState): number {
  return s.rects.findIndex((r) => !s.solution.some((q) => sameRect(q, r)));
}

/** The rectangle covering a cell, by index, or -1. */
export function rectAt(s: BlocksState, cell: number): number {
  return s.rects.findIndex((r) => holds(r, s.size, cell));
}

// ---- moves ------------------------------------------------------------------------------------

export function cloneBlocks(s: BlocksState): BlocksState {
  return { ...s, rects: s.rects.slice() };
}

/** Draws a rectangle, replacing any it overlaps. Null when it is already there. */
export function drawRect(s: BlocksState, r: Rect): BlocksState | null {
  if (s.rects.some((q) => sameRect(q, r))) return null;
  const next = cloneBlocks(s);
  next.rects = s.rects.filter((q) => !overlaps(q, r));
  next.rects.push({ ...r });
  next.moves++;
  return next;
}

/** Removes the rectangle covering a cell. Null when there is none. */
export function removeAt(s: BlocksState, cell: number): BlocksState | null {
  const i = rectAt(s, cell);
  if (i < 0) return null;
  const next = cloneBlocks(s);
  next.rects.splice(i, 1);
  return next;
}

// ---- candidates and counting ---------------------------------------------------------------

/** Every rectangle that could serve a clue: its area, holding its cell and no other number. */
export function candidatesFor(n: number, clues: Clue[], k: number): Rect[] {
  const { cell, area } = clues[k];
  const cx = cell % n, cy = Math.floor(cell / n);
  const out: Rect[] = [];
  for (let w = 1; w <= Math.min(n, area); w++) {
    if (area % w) continue;
    const h = area / w;
    if (h > n) continue;
    for (let y = Math.max(0, cy - h + 1); y <= Math.min(cy, n - h); y++) {
      for (let x = Math.max(0, cx - w + 1); x <= Math.min(cx, n - w); x++) {
        const r = { x, y, w, h };
        if (clues.some((c, j) => j !== k && holds(r, n, c.cell))) continue;
        out.push(r);
      }
    }
  }
  return out;
}

/** Answers to the numbers, up to `limit`, each a rectangle per clue. */
export function solutions(n: number, clues: Clue[], limit = 2): Rect[][] {
  const cands = clues.map((_, k) => candidatesFor(n, clues, k).map((r) => ({ r, cells: cellsOf(r, n) })));
  const cover = new Int16Array(n * n).fill(-1);
  const pick: Rect[] = Array(clues.length);
  const placed = new Uint8Array(clues.length);
  const out: Rect[][] = [];
  const fits = (cells: number[]) => cells.every((c) => cover[c] < 0);
  const step = (left: number): void => {
    if (out.length >= limit) return;
    if (!left) { out.push(pick.slice()); return; }
    // Every free cell must still be reachable.
    const reach = new Uint8Array(n * n);
    let best = -1, bestCount = 1e9;
    for (let k = 0; k < clues.length; k++) {
      if (placed[k]) continue;
      let count = 0;
      for (const c of cands[k]) if (fits(c.cells)) { count++; for (const x of c.cells) reach[x] = 1; }
      if (count === 0) return;
      if (count < bestCount) { bestCount = count; best = k; }
    }
    for (let i = 0; i < n * n; i++) if (cover[i] < 0 && !reach[i]) return;
    for (const c of cands[best]) {
      if (!fits(c.cells)) continue;
      for (const x of c.cells) cover[x] = best;
      placed[best] = 1; pick[best] = c.r;
      step(left - 1);
      placed[best] = 0;
      for (const x of c.cells) cover[x] = -1;
      if (out.length >= limit) return;
    }
  };
  step(clues.length);
  return out;
}

// ---- the human-style solver -----------------------------------------------------------------

/**
 * One deduction. `one-way`: a number fits only one way. `only-cover`: a cell only one rectangle
 * can cover. `reach`: a cell only one number can reach, so that number covers it. `core`: every
 * way a number fits covers some cells, so no other number can. `room`: one way to fit a number
 * would leave another number, or a cell, with no way at all.
 */
export interface Step {
  kind: 'one-way' | 'only-cover' | 'reach' | 'core' | 'room';
  /** The clue the step is about. */
  clue: number;
  /** The rectangle placed (one-way and only-cover). */
  place: Rect | null;
  /** The cell the step turns on (only-cover, reach), or -1. */
  cell: number;
  /** Ways struck out: [clue, rect]. */
  strike: [number, Rect][];
  /** 0 places, 1 reach and core, 2 room. */
  level: number;
}

export interface Knowledge {
  n: number;
  clues: Clue[];
  /** Each clue's ways still possible. */
  cands: Rect[][];
  /** Each clue's rectangle once placed. */
  placed: (Rect | null)[];
}

export function freshKnowledge(n: number, clues: Clue[]): Knowledge {
  return { n, clues, cands: clues.map((_, k) => candidatesFor(n, clues, k)), placed: clues.map(() => null) };
}

export function placeIn(kn: Knowledge, k: number, r: Rect): void {
  kn.placed[k] = r;
  kn.cands[k] = [r];
  for (let j = 0; j < kn.clues.length; j++) if (j !== k) kn.cands[j] = kn.cands[j].filter((q) => !overlaps(q, r));
}

/** What the player has right: their rectangles that belong to the answer, placed. */
export function knowledgeOf(s: BlocksState): Knowledge {
  const kn = freshKnowledge(s.size, s.clues);
  s.rects.forEach((r) => {
    const k = s.solution.findIndex((q) => sameRect(q, r));
    if (k >= 0) placeIn(kn, k, r);
  });
  return kn;
}

/** The simplest deduction left, or null when none applies (or every number is placed). */
export function nextStep(kn: Knowledge): Step | null {
  const { n, clues, cands, placed } = kn;
  const open = clues.map((_, k) => k).filter((k) => !placed[k]);
  if (!open.length) return null;
  for (const k of open) {
    if (cands[k].length === 0) return null;
    if (cands[k].length === 1) return { kind: 'one-way', clue: k, place: cands[k][0], cell: -1, strike: [], level: 0 };
  }
  // Which open clues' ways cover each free cell.
  const taken = new Uint8Array(n * n);
  for (const r of placed) if (r) for (const c of cellsOf(r, n)) taken[c] = 1;
  const by: { k: number; r: Rect }[][] = Array.from({ length: n * n }, () => []);
  for (const k of open) for (const r of cands[k]) for (const c of cellsOf(r, n)) by[c].push({ k, r });
  for (let c = 0; c < n * n; c++) {
    if (taken[c]) continue;
    if (by[c].length === 0) return null;
    if (by[c].length === 1) return { kind: 'only-cover', clue: by[c][0].k, place: by[c][0].r, cell: c, strike: [], level: 0 };
  }
  // Reach: a free cell only one number can cover.
  for (let c = 0; c < n * n; c++) {
    if (taken[c] || !by[c].length) continue;
    const k = by[c][0].k;
    if (!by[c].every((e) => e.k === k)) continue;
    const strike = cands[k].filter((r) => !holds(r, n, c)).map((r): [number, Rect] => [k, r]);
    if (strike.length) return { kind: 'reach', clue: k, place: null, cell: c, strike, level: 1 };
  }
  // Core: cells every way of a number covers, closed to the others.
  for (const k of open) {
    let core = cellsOf(cands[k][0], n);
    for (const r of cands[k]) core = core.filter((c) => holds(r, n, c));
    if (!core.length) continue;
    const strike: [number, Rect][] = [];
    for (const j of open) if (j !== k) for (const r of cands[j]) if (core.some((c) => holds(r, n, c))) strike.push([j, r]);
    if (strike.length) return { kind: 'core', clue: k, place: null, cell: core[0], strike, level: 1 };
  }
  // Room: a way that would leave another number, or a cell, nothing.
  for (const k of open) {
    for (const r of cands[k]) {
      let dead = false;
      for (const j of open) if (j !== k && cands[j].every((q) => overlaps(q, r))) { dead = true; break; }
      if (!dead) {
        for (let c = 0; c < n * n && !dead; c++) {
          if (taken[c] || holds(r, n, c)) continue;
          if (by[c].every((e) => e.k === k || overlaps(e.r, r))) dead = true;
        }
      }
      if (dead) return { kind: 'room', clue: k, place: null, cell: -1, strike: [[k, r]], level: 2 };
    }
  }
  return null;
}

export function applyStep(kn: Knowledge, st: Step): void {
  if (st.place) { placeIn(kn, st.clue, st.place); return; }
  for (const [k, r] of st.strike) kn.cands[k] = kn.cands[k].filter((q) => !sameRect(q, r));
}

/** Solves the way a person would, simplest step first: the rating (one per reach or core step,
 *  three per room step), or -1 when the steps run out. */
export function rate(n: number, clues: Clue[]): number {
  const kn = freshKnowledge(n, clues);
  let score = 0;
  for (let guard = 0; guard < 2000; guard++) {
    if (kn.placed.every(Boolean)) return score;
    const st = nextStep(kn);
    if (!st) return -1;
    score += st.level === 1 ? 1 : st.level === 2 ? 3 : 0;
    applyStep(kn, st);
  }
  return -1;
}

// ---- dealing --------------------------------------------------------------------------------

/**
 * Board size, the largest rectangle, and how hard a deal to pick, for the difficulty dial d
 * (1..100). `level` picks, among `pool` good deals, the easiest (0) to the hardest (1).
 */
export function blocksShape(d: number): { size: number; maxArea: number; level: number; pool: number } {
  const dd = Math.max(1, Math.min(100, Math.round(d)));
  const bands: [number, number][] = [[1, 5], [15, 6], [33, 7], [51, 8], [69, 9], [87, 10]];
  let b = 0;
  while (b + 1 < bands.length && dd >= bands[b + 1][0]) b++;
  const from = bands[b][0], to = b + 1 < bands.length ? bands[b + 1][0] - 1 : 100;
  const pos = to > from ? (dd - from) / (to - from) : 1;
  const level = b === 0 ? pos : 0.15 + 0.85 * pos;
  const size = bands[b][1];
  // Rectangles grow with the dial: up to 5 cells at first, up to 14 (an f subshell) at the top.
  const maxArea = Math.min(size * 2, Math.round(5 + (9 * (dd - 1)) / 99));
  // Hard dials search wider for the hardest of many deals.
  const pool = 2 + Math.round(level * (3 + (9 * dd) / 100));
  return { size, maxArea, level, pool };
}

/** A random cut of the grid into rectangles of 2 to maxArea cells, or null when it boxes a
 *  single cell in. Each free cell in reading order is the top-left corner of the next one. */
function partition(n: number, maxArea: number, rng: Rng): Rect[] | null {
  const owner = new Int16Array(n * n).fill(-1);
  const rects: Rect[] = [];
  for (let i = 0; i < n * n; i++) {
    if (owner[i] >= 0) continue;
    const x = i % n, y = Math.floor(i / n);
    // How far right the row is free from here.
    let run = 0;
    while (x + run < n && owner[y * n + x + run] < 0) run++;
    const opts: { w: number; h: number; wt: number }[] = [];
    for (let w = 1; w <= run; w++) for (let h = 1; y + h <= n; h++) {
      const a = w * h;
      if (a > maxArea) break;
      if (a < 2) continue;
      // Cells below are free (nothing above has reached down yet beyond its own rectangle).
      let free = true;
      for (let yy = y; yy < y + h && free; yy++) for (let xx = x; xx < x + w; xx++) if (owner[yy * n + xx] >= 0) { free = false; break; }
      if (!free) break;
      // Prefer middling sizes and shapes that are not too thin.
      const thin = Math.max(w, h) / Math.min(w, h);
      opts.push({ w, h, wt: (1 + a) / (thin > 4 ? 6 : thin > 2 ? 2 : 1) });
    }
    if (!opts.length) return null;
    let r = rand(rng) * opts.reduce((s, o) => s + o.wt, 0);
    let pickO = opts[opts.length - 1];
    for (const o of opts) { r -= o.wt; if (r < 0) { pickO = o; break; } }
    const rect = { x, y, w: pickO.w, h: pickO.h };
    for (const c of cellsOf(rect, n)) owner[c] = rects.length;
    rects.push(rect);
  }
  return rects;
}

/** Numbers placed in the rectangles, moved about until the answer is the only one. */
function makeUnique(n: number, rects: Rect[], rng: Rng): Clue[] | null {
  const clues: Clue[] = rects.map((r) => { const cs = cellsOf(r, n); return { cell: cs[randInt(rng, cs.length)], area: r.w * r.h }; });
  const LIMIT = 6;
  let sols = solutions(n, clues, LIMIT);
  for (let iter = 0; iter < 6 * rects.length && sols.length > 1; iter++) {
    const alt = sols.find((sol) => sol.some((r, k) => !sameRect(r, rects[k])))!;
    const off = rects.map((_, k) => k).filter((k) => !sameRect(alt[k], rects[k]));
    const k = off[randInt(rng, off.length)];
    const cs = cellsOf(rects[k], n);
    const was = clues[k].cell;
    clues[k] = { ...clues[k], cell: cs[randInt(rng, cs.length)] };
    const next = solutions(n, clues, LIMIT);
    if (next.length <= sols.length || rand(rng) < 0.1) sols = next;
    else clues[k] = { ...clues[k], cell: was };
  }
  return sols.length === 1 ? clues : null;
}

function candidate(n: number, maxArea: number, rng: Rng): { clues: Clue[]; rects: Rect[]; score: number } | null {
  const rects = partition(n, maxArea, rng);
  if (!rects) return null;
  const clues = makeUnique(n, rects, rng);
  if (!clues) return null;
  const score = rate(n, clues);
  if (score < 0) return null;
  return { clues, rects, score };
}

/**
 * Deals a board for dial d: a few unique, human-solvable cuts of the grid, and of those the one
 * whose rating sits where the dial asks.
 */
export function newBlocks(d: number, seed: number): BlocksState {
  const rng = seeded(seed * 6271 + 101);
  const { size: n, maxArea, level, pool } = blocksShape(d);
  const found: { clues: Clue[]; rects: Rect[]; score: number }[] = [];
  for (let tries = 0; found.length < pool && tries < pool * 20; tries++) {
    const c = candidate(n, maxArea, rng);
    if (c) found.push(c);
  }
  while (!found.length) { const c = candidate(n, maxArea, rng); if (c) found.push(c); }
  found.sort((a, b) => a.score - b.score);
  const pick = found[Math.round(level * (found.length - 1))];
  // Clues in reading order, so the board reads naturally.
  const order = pick.clues.map((_, k) => k).sort((a, b) => pick.clues[a].cell - pick.clues[b].cell);
  return {
    size: n,
    clues: order.map((k) => pick.clues[k]),
    rects: [],
    solution: order.map((k) => pick.rects[k]),
    moves: 0,
    par: pick.clues.length,
    score: pick.score,
  };
}
