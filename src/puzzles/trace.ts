// Trace: one trail through every cell, meeting the numbers in order.
//
// A grid with some cells numbered 1 to k. Draw one trail from 1, cell to cell across shared
// edges, that passes through every cell exactly once and meets the numbers in order, ending on
// k. On harder boards walls between some cells block the way. Every board has exactly one answer.
//
// Game rule, not physics: an electron does not visit every site of a lattice in turn; the trail
// is drawn like one only for the look of it.

import { hamiltonian } from './bond';
import { randInt, seeded, type Rng } from './rng';

export interface TraceState {
  size: number;
  /** The numbered cells, in order: checkpoints[0] holds 1, the last holds k. */
  checkpoints: number[];
  /** Walls, as edge keys (see edgeKey). */
  walls: number[];
  /** The trail as drawn, from the cell holding 1; empty before it is begun. */
  path: number[];
  /** The one answer. */
  solution: number[];
  /** Strokes that changed the trail. */
  moves: number;
  /** One stroke from each number to the next. */
  par: number;
}

/** Board size, walls and how many numbers stay, for the difficulty dial d (1 to 100). */
export function traceShape(d: number): { size: number; walls: number; keep: number } {
  const size = d <= 12 ? 5 : d <= 36 ? 6 : d <= 68 ? 7 : 8;
  const t = Math.min(1, Math.max(0, (d - 1) / 99));
  // Walls arrive from Easy on, a few more with every step of the dial.
  const walls = d <= 22 ? 0 : Math.round(1 + (size + 2) * ((d - 22) / 78));
  // The fewest numbers the board may come down to, as a share of its cells: generous at first,
  // spare at Expert. Fewer may be needed to keep one answer, never more are taken.
  const keep = Math.max(3, Math.round(size * size * (0.44 - 0.3 * t)));
  return { size, walls, keep };
}

/** A direction-free key for the edge between two neighboring cells. */
export const edgeKey = (a: number, b: number): number => (a < b ? a * 4096 + b : b * 4096 + a);

/** Cells next to `cell` across sides, walls or not. */
export function neighbors(n: number, cell: number): number[] {
  const x = cell % n, y = Math.floor(cell / n);
  const out: number[] = [];
  if (y > 0) out.push(cell - n);
  if (x < n - 1) out.push(cell + 1);
  if (y < n - 1) out.push(cell + n);
  if (x > 0) out.push(cell - 1);
  return out;
}

/** Cells next to `cell` with no wall between. */
export function open(s: { size: number; walls: number[] }, cell: number, walls: Set<number> = new Set(s.walls)): number[] {
  return neighbors(s.size, cell).filter((o) => !walls.has(edgeKey(cell, o)));
}

/** The number in each cell, 1 to k, or 0. */
export function numberAt(s: TraceState): Int16Array {
  const out = new Int16Array(s.size * s.size);
  s.checkpoints.forEach((c, i) => { out[c] = i + 1; });
  return out;
}

/** How many numbers the trail has met. */
export function reached(s: TraceState): number {
  const num = numberAt(s);
  let k = 0;
  for (const c of s.path) if (num[c]) k++;
  return k;
}

export function solved(s: TraceState): boolean {
  const n = s.size;
  return s.path.length === n * n && s.path[n * n - 1] === s.checkpoints[s.checkpoints.length - 1];
}

/** The trail has reached the last number with cells still left out. */
export function endedShort(s: TraceState): boolean {
  return s.path.length > 0 && s.path.length < s.size * s.size && s.path[s.path.length - 1] === s.checkpoints[s.checkpoints.length - 1];
}

// ---- the solver -------------------------------------------------------------------------
//
// Counts trails from 1 through every cell to k, meeting the numbers in order, by walking one
// cell at a time. A step is cut off when it would leave a cell with too few ways in and out to
// be passed later, or split the cells still to visit into pieces.

/** Counts the answers up to `limit`, or -1 when the search runs past `budget` steps. */
export function countSolutions(n: number, checkpoints: number[], walls: number[], limit = 2, budget = 300_000, keep?: number[][]): number {
  const N = n * n;
  const wall = new Set(walls);
  const adj: number[][] = Array.from({ length: N }, (_, c) => neighbors(n, c).filter((o) => !wall.has(edgeKey(c, o))));
  const num = new Int16Array(N);
  checkpoints.forEach((c, i) => { num[c] = i + 1; });
  const K = checkpoints.length;
  const start = checkpoints[0], end = checkpoints[K - 1];
  const seen = new Uint8Array(N);
  const path: number[] = [start];
  seen[start] = 1;
  const mark = new Uint8Array(N);
  const stack = new Int32Array(N);
  let found = 0, steps = 0, over = false;

  // Every cell still to visit needs two ways in and out (one for the end), counting the head.
  const roomy = (u: number, head: number): boolean => {
    let free = 0;
    for (const o of adj[u]) if (!seen[o] || o === head) free++;
    return free >= (u === end ? 1 : 2);
  };
  // The cells still to visit hang together with the head.
  const connected = (head: number, left: number): boolean => {
    mark.fill(0);
    let top = 0, count = 0;
    stack[top++] = head;
    mark[head] = 1;
    while (top) {
      const c = stack[--top];
      for (const o of adj[c]) {
        if (seen[o] || mark[o]) continue;
        mark[o] = 1;
        count++;
        stack[top++] = o;
      }
    }
    return count === left;
  };

  const rec = (head: number, next: number): void => {
    if (over || found >= limit) return;
    if (++steps > budget) { over = true; return; }
    const visited = path.length;
    if (visited === N) {
      if (head === end) { found++; keep?.push(path.slice()); }
      return;
    }
    for (const o of adj[head]) {
      if (seen[o]) continue;
      if (num[o] && num[o] !== next) continue;
      if (o === end && visited + 1 !== N) continue;
      seen[o] = 1;
      path.push(o);
      let ok = true;
      for (const u of adj[head]) if (!seen[u] && !roomy(u, o)) { ok = false; break; }
      if (ok) ok = connected(o, N - visited - 1);
      if (ok) rec(o, num[o] ? next + 1 : next);
      path.pop();
      seen[o] = 0;
      if (over || found >= limit) return;
    }
  };
  rec(start, 2);
  return over ? -1 : found;
}

// ---- dealing ------------------------------------------------------------------------------

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
}

/**
 * Deals a board for dial d: a random trail through every cell (a Hamiltonian path, mixed by
 * backbite steps), walls on edges the trail never crosses, and numbers set along it at its start,
 * its end and every few cells. While the solver finds a second trail, a number is added where the
 * two part; then numbers are taken away, one at a time, while the answer stays the only one.
 */
export function newTrace(d: number, seed: number): TraceState {
  const rng = seeded(seed);
  const { size: n, walls: wallCount, keep } = traceShape(d);
  const N = n * n;
  for (let attempt = 0; ; attempt++) {
    const path = hamiltonian(n, rng, N, 0);
    const at = new Int32Array(N);
    path.forEach((c, i) => { at[c] = i; });
    // Walls on edges the trail does not use.
    const free: number[] = [];
    for (let c = 0; c < N; c++) for (const o of neighbors(n, c)) if (o > c && Math.abs(at[c] - at[o]) !== 1) free.push(edgeKey(c, o));
    const walls = shuffle(free, rng).slice(0, wallCount).sort((a, b) => a - b);
    // Numbers every two to four cells to begin with.
    const idx = new Set<number>([0, N - 1]);
    for (let i = 2 + randInt(rng, 2); i < N - 1; i += 2 + randInt(rng, 3)) idx.add(i);
    const cps = () => [...idx].sort((a, b) => a - b).map((i) => path[i]);
    let ok = false;
    for (let k = 0; k < N; k++) {
      const other: number[][] = [];
      const found = countSolutions(n, cps(), walls, 2, 300_000, other);
      if (found === 1) { ok = true; break; }
      if (found === -1) break;
      // Number the first cell where another trail parts from this one.
      const alt = other.find((p) => p.some((c, i) => c !== path[i]))!;
      let i = 0;
      while (alt[i] === path[i]) i++;
      idx.add(i);
    }
    if (!ok) { if (attempt < 20) continue; throw new Error('Trace: no deal'); }
    // Take numbers away while the answer stays the only one, down to the dial's share.
    const inner = shuffle([...idx].filter((i) => i !== 0 && i !== N - 1), rng);
    for (const i of inner) {
      if (idx.size <= keep) break;
      idx.delete(i);
      if (countSolutions(n, cps(), walls, 2, 60_000) !== 1) idx.add(i);
    }
    const checkpoints = cps();
    return { size: n, checkpoints, walls, path: [], solution: path, moves: 0, par: checkpoints.length - 1 };
  }
}

export function cloneTrace(s: TraceState): TraceState {
  return { ...s, path: s.path.slice() };
}

// ---- drawing the trail --------------------------------------------------------------------

/**
 * Begins a stroke at a cell: on the 1 with nothing drawn, a fresh trail; on a cell of the trail,
 * the trail cut back to it. Returns false when the cell starts nothing.
 */
export function begin(s: TraceState, cell: number): boolean {
  if (!s.path.length) {
    if (cell !== s.checkpoints[0]) return false;
    s.path = [cell];
    return true;
  }
  const k = s.path.indexOf(cell);
  if (k < 0) return false;
  s.path = s.path.slice(0, k + 1);
  return true;
}

/** Why a step is refused, or null when it can be taken. */
export function blocked(s: TraceState, cell: number, walls: Set<number> = new Set(s.walls)): 'wall' | 'order' | 'end' | 'far' | null {
  const head = s.path[s.path.length - 1];
  if (head === undefined || !neighbors(s.size, head).includes(cell)) return 'far';
  if (walls.has(edgeKey(head, cell))) return 'wall';
  if (s.path.includes(cell)) return null;
  if (head === s.checkpoints[s.checkpoints.length - 1]) return 'end';
  const num = s.checkpoints.indexOf(cell);
  if (num >= 0 && num !== reached(s)) return 'order';
  return null;
}

/**
 * Extends the trail into a neighboring cell during a stroke. Back onto the trail pulls it in to
 * that cell; across a wall, onto a number out of turn, or on past the last number does nothing.
 */
export function extend(s: TraceState, cell: number, walls?: Set<number>): boolean {
  if (blocked(s, cell, walls)) return false;
  const k = s.path.indexOf(cell);
  if (k >= 0) { s.path = s.path.slice(0, k + 1); return true; }
  s.path.push(cell);
  return true;
}

/** The first place the trail strays from the answer, or -1 when all of it is right. */
export function firstWrong(s: TraceState): number {
  for (let i = 0; i < s.path.length; i++) if (s.path[i] !== s.solution[i]) return i;
  return -1;
}

/** Where the trail must go next and why, from the right part of it. */
export function nextStep(s: TraceState): { cell: number; why: string } | null {
  const n = s.size;
  const len = s.path.length;
  if (len >= n * n) return null;
  const cell = s.solution[len];
  if (!len) return { cell, why: 'Start the trail on the 1.' };
  const head = s.path[len - 1];
  const walls = new Set(s.walls);
  const on = new Set(s.path);
  const ways = open(s, head, walls).filter((o) => !on.has(o) && !blocked(s, o, walls));
  const next = s.checkpoints[reached(s)];
  if (cell === next) return { cell, why: `The ${reached(s) + 1} is next, right here.` };
  if (ways.length === 1) return { cell, why: 'Only one way on from here.' };
  // A cell with the head as one of only two ways in must be passed now, or it is cut off.
  const free = open(s, cell, walls).filter((o) => !on.has(o) || o === head).length;
  if (free <= 2) return { cell, why: 'Take that cell now, or it gets cut off.' };
  return { cell, why: 'The trail runs this way.' };
}
