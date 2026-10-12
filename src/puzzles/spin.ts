// Spin: a binary grid of electron spins.
//
// Every cell takes spin up or spin down. Each row and each column holds as many ups as downs,
// no three alike sit next to each other in a line, and a few neighboring pairs are linked: "="
// means the two spins match, "x" means they differ. Some cells are dealt filled; fill the rest.
// Every deal has exactly one answer.
//
// Game rule, not physics: real spins pair up in orbitals, not in rows of a grid.

import { rand, randInt, seeded, type Rng } from './rng';

/** 0 empty, 1 up, 2 down. */
export type Spin = 0 | 1 | 2;

/** A link between two side-by-side cells: they match or they differ. */
export interface Link {
  a: number;
  b: number;
  same: boolean;
}

export interface SpinState {
  size: number;
  cells: Spin[];
  /** Cells dealt filled; they cannot be changed. */
  given: boolean[];
  links: Link[];
  /** The one answer. */
  solution: Spin[];
  moves: number;
  par: number;
}

/** Board size for an element: 4 for the first row, 6 up to barium, 8 from lanthanum on. */
export function spinSize(z: number): number {
  return z <= 2 ? 4 : z <= 56 ? 6 : 8;
}

/** How many cells are dealt filled, as a share of the board: fewer with heavier elements. */
function givenShare(z: number): number {
  return z <= 2 ? 0.5 : z <= 18 ? 0.42 : z <= 56 ? 0.32 : z <= 86 ? 0.26 : 0.2;
}

/** How many links are dealt: more on the big boards, where they carry the deduction. */
function linkCount(z: number, size: number): number {
  return size === 4 ? 1 : size === 6 ? (z <= 18 ? 2 : 4) : z <= 86 ? 6 : 8;
}

/** The flaws a filled or part-filled grid shows: cells in a run of three, rows or columns with
 *  too many of one spin, and broken links. Each is a cell index. */
export function flaws(s: SpinState): Set<number> {
  const n = s.size, c = s.cells;
  const out = new Set<number>();
  const half = n / 2;
  for (let k = 0; k < n; k++) {
    let ru = 0, rd = 0, cu = 0, cd = 0;
    for (let i = 0; i < n; i++) {
      const r = c[k * n + i], col = c[i * n + k];
      if (r === 1) ru++; else if (r === 2) rd++;
      if (col === 1) cu++; else if (col === 2) cd++;
      // Runs of three along the row and the column.
      if (i >= 2) {
        const a = c[k * n + i - 2], b = c[k * n + i - 1];
        if (r && r === a && r === b) { out.add(k * n + i - 2); out.add(k * n + i - 1); out.add(k * n + i); }
        const p = c[(i - 2) * n + k], q = c[(i - 1) * n + k];
        if (col && col === p && col === q) { out.add((i - 2) * n + k); out.add((i - 1) * n + k); out.add(i * n + k); }
      }
    }
    if (ru > half) for (let i = 0; i < n; i++) if (c[k * n + i] === 1) out.add(k * n + i);
    if (rd > half) for (let i = 0; i < n; i++) if (c[k * n + i] === 2) out.add(k * n + i);
    if (cu > half) for (let i = 0; i < n; i++) if (c[i * n + k] === 1) out.add(i * n + k);
    if (cd > half) for (let i = 0; i < n; i++) if (c[i * n + k] === 2) out.add(i * n + k);
  }
  for (const l of s.links) {
    const a = c[l.a], b = c[l.b];
    if (a && b && (a === b) !== l.same) { out.add(l.a); out.add(l.b); }
  }
  return out;
}

export function full(s: SpinState): boolean {
  return s.cells.every((v) => v !== 0);
}

export function solved(s: SpinState): boolean {
  return full(s) && flaws(s).size === 0;
}

/** Whether setting cell i to v keeps every rule that can be checked so far. */
function fits(n: number, cells: Spin[], links: Link[], i: number, v: Spin): boolean {
  const x = i % n, y = Math.floor(i / n);
  const half = n / 2;
  const at = (xx: number, yy: number): Spin => (xx < 0 || yy < 0 || xx >= n || yy >= n ? 0 : cells[yy * n + xx]);
  // No run of three through this cell.
  if (at(x - 1, y) === v && at(x - 2, y) === v) return false;
  if (at(x + 1, y) === v && at(x + 2, y) === v) return false;
  if (at(x - 1, y) === v && at(x + 1, y) === v) return false;
  if (at(x, y - 1) === v && at(x, y - 2) === v) return false;
  if (at(x, y + 1) === v && at(x, y + 2) === v) return false;
  if (at(x, y - 1) === v && at(x, y + 1) === v) return false;
  let row = 0, col = 0;
  for (let k = 0; k < n; k++) {
    if (cells[y * n + k] === v) row++;
    if (cells[k * n + x] === v) col++;
  }
  if (row >= half || col >= half) return false;
  for (const l of links) {
    const o = l.a === i ? l.b : l.b === i ? l.a : -1;
    if (o < 0 || !cells[o]) continue;
    if ((cells[o] === v) !== l.same) return false;
  }
  return true;
}

/** Counts answers up to `limit`, filling empties in order with the simplest backtracking. */
export function countSolutions(n: number, cells: Spin[], links: Link[], limit = 2): number {
  const work = cells.slice();
  let found = 0;
  const step = (i: number): void => {
    if (found >= limit) return;
    while (i < n * n && work[i]) i++;
    if (i === n * n) { found++; return; }
    for (const v of [1, 2] as Spin[]) {
      if (!fits(n, work, links, i, v)) continue;
      work[i] = v;
      step(i + 1);
      work[i] = 0;
    }
  };
  step(0);
  return found;
}

/** The answer to a grid with exactly one, filled in; null when it has none or several. */
export function solve(n: number, cells: Spin[], links: Link[]): Spin[] | null {
  const work = cells.slice();
  let answer: Spin[] | null = null;
  let found = 0;
  const step = (i: number): void => {
    if (found >= 2) return;
    while (i < n * n && work[i]) i++;
    if (i === n * n) { found++; if (found === 1) answer = work.slice(); return; }
    for (const v of [1, 2] as Spin[]) {
      if (!fits(n, work, links, i, v)) continue;
      work[i] = v;
      step(i + 1);
      work[i] = 0;
    }
  };
  step(0);
  return found === 1 ? answer : null;
}

/** A random full grid that keeps the row, column and run rules. */
function fillRandom(n: number, rng: Rng): Spin[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells: Spin[] = Array(n * n).fill(0);
    let ok = true;
    const step = (i: number): boolean => {
      if (i === n * n) return true;
      const order: Spin[] = rand(rng) < 0.5 ? [1, 2] : [2, 1];
      for (const v of order) {
        if (!fits(n, cells, [], i, v)) continue;
        cells[i] = v;
        if (step(i + 1)) return true;
        cells[i] = 0;
      }
      return false;
    };
    ok = step(0);
    if (ok) return cells;
  }
  throw new Error('Spin: no full grid');
}

/**
 * Deals a board for element z: a random answer, a few links read off it, then givens removed
 * one by one while the answer stays the only one, down to the share the element asks for.
 */
export function newSpin(z: number, seed: number): SpinState {
  const rng = seeded(seed);
  const n = spinSize(z);
  const solution = fillRandom(n, rng);
  // Links between side-by-side cells, spread out: no cell in two links.
  const links: Link[] = [];
  const used = new Set<number>();
  const want = linkCount(z, n);
  for (let tries = 0; links.length < want && tries < 400; tries++) {
    const i = randInt(rng, n * n);
    const horizontal = rand(rng) < 0.5;
    const x = i % n, y = Math.floor(i / n);
    if (horizontal ? x === n - 1 : y === n - 1) continue;
    const j = horizontal ? i + 1 : i + n;
    if (used.has(i) || used.has(j)) continue;
    used.add(i); used.add(j);
    links.push({ a: i, b: j, same: solution[i] === solution[j] });
  }
  // Start full, then clear cells in a random order while the answer stays unique.
  const cells = solution.slice();
  const order = Array.from({ length: n * n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const keep = Math.round(n * n * givenShare(z));
  let filled = n * n;
  for (const i of order) {
    if (filled <= keep) break;
    const v = cells[i];
    cells[i] = 0;
    if (countSolutions(n, cells, links) === 1) filled--;
    else cells[i] = v;
  }
  const given = cells.map((v) => v !== 0);
  // Par: the fewest taps that fill the answer. A tap sets up, a second tap down.
  let par = 0;
  for (let i = 0; i < n * n; i++) if (!given[i]) par += solution[i] === 1 ? 1 : 2;
  return { size: n, cells, given, links, solution, moves: 0, par };
}

export function cloneSpin(s: SpinState): SpinState {
  return { ...s, cells: s.cells.slice() };
}

/** Tapping a cell: empty to up, up to down, down to empty. Null for a given cell. */
export function tap(s: SpinState, i: number): SpinState | null {
  if (s.given[i]) return null;
  const next = cloneSpin(s);
  next.cells[i] = ((s.cells[i] + 1) % 3) as Spin;
  next.moves++;
  return next;
}

/** Sets a cell straight to a spin (the keyboard, Show me). Null for a given cell or no change. */
export function set(s: SpinState, i: number, v: Spin): SpinState | null {
  if (s.given[i] || s.cells[i] === v) return null;
  const next = cloneSpin(s);
  next.cells[i] = v;
  next.moves++;
  return next;
}

/** A cell filled against the answer, or -1 when every filled cell agrees with it. */
export function firstWrong(s: SpinState): number {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] && s.cells[i] !== s.solution[i]) return i;
  return -1;
}

/**
 * The next cell a solver would fill, and why: a cell with one spin forced by a run, a count or a
 * link, given what is filled and right so far. Null on a full board.
 */
export function nextForced(s: SpinState): { cell: number; spin: Spin; why: string } | null {
  const n = s.size;
  const c = s.cells;
  const half = n / 2;
  const at = (x: number, y: number): Spin => (x < 0 || y < 0 || x >= n || y >= n ? 0 : c[y * n + x]);
  const other = (v: Spin): Spin => (v === 1 ? 2 : 1);
  // Runs: two alike with an empty beside or between them.
  for (let i = 0; i < n * n; i++) {
    if (c[i]) continue;
    const x = i % n, y = Math.floor(i / n);
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const pairs: [Spin, Spin][] = [[at(x - dx, y - dy), at(x - 2 * dx, y - 2 * dy)], [at(x + dx, y + dy), at(x + 2 * dx, y + 2 * dy)], [at(x - dx, y - dy), at(x + dx, y + dy)]];
      for (const [p, q] of pairs) if (p && p === q) return { cell: i, spin: other(p), why: `Three ${p === 1 ? 'ups' : 'downs'} can't sit in a line.` };
    }
  }
  // Counts: a row or column with all of one spin placed.
  for (let k = 0; k < n; k++) {
    for (const row of [true, false]) {
      let up = 0, down = 0, empty = -1;
      for (let i = 0; i < n; i++) {
        const idx = row ? k * n + i : i * n + k;
        if (c[idx] === 1) up++; else if (c[idx] === 2) down++; else if (empty < 0) empty = idx;
      }
      if (empty < 0) continue;
      if (up === half) return { cell: empty, spin: 2, why: `This ${row ? 'row' : 'column'} has all its ups.` };
      if (down === half) return { cell: empty, spin: 1, why: `This ${row ? 'row' : 'column'} has all its downs.` };
    }
  }
  // Links with one side filled.
  for (const l of s.links) {
    const a = c[l.a], b = c[l.b];
    if (a && !b) return { cell: l.b, spin: l.same ? a : other(a), why: l.same ? 'Linked by =, so they match.' : 'Linked by x, so they differ.' };
    if (b && !a) return { cell: l.a, spin: l.same ? b : other(b), why: l.same ? 'Linked by =, so they match.' : 'Linked by x, so they differ.' };
  }
  // Nothing simple: any empty cell, from the answer.
  for (let i = 0; i < n * n; i++) if (!c[i]) return { cell: i, spin: s.solution[i], why: 'Try the other spin here and see what it forces.' };
  return null;
}
