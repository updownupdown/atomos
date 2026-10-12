// Bond: join each pair of like electrons with one path.
//
// A grid with pairs of colored dots. Drag a path from one dot of a pair to the other through
// empty cells, one cell to the next. Paths never cross and every cell ends up on a path. Each
// board has exactly one answer.
//
// Game rule, not physics: bonding electrons pair up, but not along paths on a grid.

import { rand, randInt, seeded, type Rng } from './rng';

export interface BondState {
  size: number;
  /** The dots, two cells per pair; the pair's index is its color. */
  pairs: [number, number][];
  /** The player's paths, one per pair: cells from one of its dots, in order. Empty when not begun. */
  paths: number[][];
  /** The one answer: every pair's full path, from its first dot to its second. */
  solution: number[][];
  /** Strokes drawn. */
  moves: number;
  /** One stroke per pair. */
  par: number;
}

/** Board size and how many pairs it holds, by element. */
export function bondShape(z: number): { size: number; pairs: [number, number] } {
  if (z <= 10) return { size: 5, pairs: [3, 4] };
  if (z <= 36) return { size: 6, pairs: [4, 5] };
  if (z <= 86) return { size: 7, pairs: [5, 7] };
  return { size: 8, pairs: [6, 8] };
}

/** Cells next to `cell`, across sides. */
export function neighbors(n: number, cell: number): number[] {
  const x = cell % n, y = Math.floor(cell / n);
  const out: number[] = [];
  if (y > 0) out.push(cell - n);
  if (x < n - 1) out.push(cell + 1);
  if (y < n - 1) out.push(cell + n);
  if (x > 0) out.push(cell - 1);
  return out;
}

export const adjacent = (n: number, a: number, b: number): boolean => neighbors(n, a).includes(b);

/** One backbite step on a path through every cell: from one end, step to a neighbor already on
 *  the path and reverse the loop that makes. Many such steps mix the path thoroughly. */
function backbite(n: number, path: number[], rng: Rng): number[] {
  const p = randInt(rng, 2) ? path.slice().reverse() : path.slice();
  const head = p[0];
  const nb = neighbors(n, head).filter((c) => c !== p[1]);
  if (!nb.length) return p;
  const c = nb[randInt(rng, nb.length)];
  const k = p.indexOf(c);
  return [...p.slice(0, k).reverse(), ...p.slice(k)];
}

/** Where a path turns back on itself within a 2 by 2 block: the index after which to cut it.
 *  A piece holding such a turn could be redrawn two ways, so the deal cuts every one. */
function tightTurns(n: number, path: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < path.length; i++) if (adjacent(n, path[i], path[i + 3])) out.push(i + 1);
  return out;
}

/**
 * A random path through every cell (a Hamiltonian path) with few tight turns: a snake, mixed by
 * backbite steps, then walked on while any step that adds no tight turn (or, now and then, any
 * step) is kept, until the count is down to `turns` or the steps run out.
 */
export function hamiltonian(n: number, rng: Rng, turns = 0, steps = 4000): number[] {
  let path: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) path.push(y * n + (y % 2 ? n - 1 - x : x));
  for (let i = 0; i < n * n * 10; i++) path = backbite(n, path, rng);
  let u = tightTurns(n, path).length;
  for (let i = 0; i < steps && u > turns; i++) {
    const next = backbite(n, path, rng);
    const u2 = tightTurns(n, next).length;
    if (u2 <= u || rand(rng) < 0.1) { path = next; u = u2; }
  }
  return path;
}

/** Cuts the path at every tight turn, plus `extra` cuts at random, into the pieces that become
 *  the pairs. */
export function cut(n: number, path: number[], extra: number, rng: Rng): number[][] {
  const cuts = new Set(tightTurns(n, path));
  for (let e = 0; e < extra; e++) cuts.add(2 + randInt(rng, Math.max(1, path.length - 5)));
  const pieces: number[][] = [];
  let start = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) { pieces.push(path.slice(start, c + 1)); start = c + 1; }
  pieces.push(path.slice(start));
  return pieces;
}

/** Whether the paths as drawn fill the board with every pair joined. */
export function solved(s: BondState): boolean {
  const n = s.size;
  const seen = new Set<number>();
  for (let p = 0; p < s.pairs.length; p++) {
    const path = s.paths[p];
    if (!complete(s, p)) return false;
    for (const c of path) seen.add(c);
  }
  return seen.size === n * n;
}

/** A pair's path runs from one of its dots to the other. */
export function complete(s: BondState, p: number): boolean {
  const path = s.paths[p];
  if (path.length < 2) return false;
  const [a, b] = s.pairs[p];
  const first = path[0], last = path[path.length - 1];
  return (first === a && last === b) || (first === b && last === a);
}

/** Which pair's path (or dot) holds each cell: -1 for an empty cell. */
export function occupancy(s: BondState): Int8Array {
  const occ = new Int8Array(s.size * s.size).fill(-1);
  s.pairs.forEach(([a, b], p) => { occ[a] = p; occ[b] = p; });
  s.paths.forEach((path, p) => { for (const c of path) occ[c] = p; });
  return occ;
}

// ---- the solver -------------------------------------------------------------------------
//
// Counts the answers to a board, up to a limit, by growing one path at a time from its first dot
// toward its second, cell by cell. It stops early when an empty cell is boxed in (no path can
// ever reach it), or when some pair's dots can no longer be joined through the empties.

/** Counts the answers to the board (up to `limit`), or returns -1 when the search runs past
 *  `budget` steps. */
export function countSolutions(n: number, pairs: [number, number][], limit = 2, budget = 400_000, keep?: Int8Array[]): number {
  const occ = new Int8Array(n * n).fill(-1);
  pairs.forEach(([a, b], p) => { occ[a] = p; occ[b] = p; });
  let found = 0;
  let steps = 0;
  let over = false;
  const nb: number[][] = Array.from({ length: n * n }, (_, c) => neighbors(n, c));
  const heads = pairs.map(([a]) => a);
  const done = pairs.map(() => false);

  // An empty cell with fewer than two open sides, counting path heads and unfinished dots as
  // open, can never be on a path.
  const boxed = (): boolean => {
    for (let c = 0; c < n * n; c++) {
      if (occ[c] !== -1) continue;
      let open = 0;
      for (const d of nb[c]) {
        if (occ[d] === -1) open++;
        else {
          const p = occ[d];
          if (!done[p] && (heads[p] === d || pairs[p][1] === d)) open++;
        }
      }
      if (open < 2) return true;
    }
    return false;
  };
  // Every unfinished pair's head can still reach its end dot through empties.
  const joinable = (): boolean => {
    const seen = new Uint8Array(n * n);
    for (let p = 0; p < pairs.length; p++) {
      if (done[p]) continue;
      seen.fill(0);
      const end = pairs[p][1];
      const stack = [heads[p]];
      seen[heads[p]] = 1;
      let ok = false;
      while (stack.length && !ok) {
        const c = stack.pop()!;
        for (const d of nb[c]) {
          if (d === end) { ok = true; break; }
          if (occ[d] === -1 && !seen[d]) { seen[d] = 1; stack.push(d); }
        }
      }
      if (!ok) return false;
    }
    return true;
  };

  // Legal next cells for an unfinished pair's head.
  const options = (p: number): number[] => {
    const out: number[] = [];
    const end = pairs[p][1];
    for (const d of nb[heads[p]]) if (d === end || occ[d] === -1) out.push(d);
    return out;
  };
  // Every region of empty cells touches some unfinished pair's head, or nothing will ever fill it.
  const regionsLive = (): boolean => {
    const seen = new Uint8Array(n * n);
    for (let c = 0; c < n * n; c++) {
      if (occ[c] !== -1 || seen[c]) continue;
      const stack = [c];
      seen[c] = 1;
      let live = false;
      while (stack.length) {
        const x = stack.pop()!;
        for (const d of nb[x]) {
          if (occ[d] === -1) { if (!seen[d]) { seen[d] = 1; stack.push(d); } }
          else if (!done[occ[d]] && heads[occ[d]] === d) live = true;
        }
      }
      if (!live) return false;
    }
    return true;
  };
  const rec = (): void => {
    if (over || found >= limit) return;
    if (++steps > budget) { over = true; return; }
    // The pair with the fewest ways on; none left means every pair is joined.
    let p = -1;
    let best: number[] | null = null;
    for (let q = 0; q < pairs.length; q++) {
      if (done[q]) continue;
      const o = options(q);
      if (!best || o.length < best.length) { best = o; p = q; }
      if (o.length === 0) return;
    }
    if (p < 0) {
      // Every pair joined; the answer counts only if every cell is used.
      for (let c = 0; c < n * n; c++) if (occ[c] === -1) return;
      found++;
      keep?.push(occ.slice());
      return;
    }
    const head = heads[p];
    const end = pairs[p][1];
    for (const d of best!) {
      if (d === end) {
        done[p] = true;
        heads[p] = end;
        if (!boxed() && regionsLive() && joinable()) rec();
        heads[p] = head;
        done[p] = false;
        continue;
      }
      occ[d] = p;
      heads[p] = d;
      if (!boxed() && regionsLive() && joinable()) rec();
      heads[p] = head;
      occ[d] = -1;
    }
  };
  rec();
  return over ? -1 : found;
}

/** Deals a board for element z: a path through every cell with few tight turns, cut at each of
 *  them into the pairs, kept only when the solver finds it has exactly one answer. */
export function newBond(z: number, seed: number): BondState {
  const rng = seeded(seed);
  const { size: n, pairs: range } = bondShape(z);
  let fallback: number[][] | null = null;
  for (let attempt = 0; attempt < 240; attempt++) {
    const turns = range[0] - 1 + randInt(rng, 2);
    const path = hamiltonian(n, rng, turns);
    const have = tightTurns(n, path).length;
    const pieces = cut(n, path, Math.max(0, range[0] - 1 - have), rng);
    if (pieces.length < range[0] || pieces.length > range[1] || pieces.some((piece) => piece.length < 3)) continue;
    fallback ??= pieces;
    const pairs = pieces.map((piece): [number, number] => [piece[0], piece[piece.length - 1]]);
    if (countSolutions(n, pairs) === 1) return make(n, pieces);
  }
  // Never expected: a board that plays, even if it may have more than one answer.
  return make(n, fallback ?? cut(n, hamiltonian(n, rng, range[0] - 1), 0, rng).filter((piece) => piece.length >= 1));
}

function make(n: number, pieces: number[][]): BondState {
  return {
    size: n,
    pairs: pieces.map((piece) => [piece[0], piece[piece.length - 1]]),
    paths: pieces.map(() => []),
    solution: pieces,
    moves: 0,
    par: pieces.length,
  };
}

export function cloneBond(s: BondState): BondState {
  return { ...s, paths: s.paths.map((p) => p.slice()) };
}

// ---- drawing a path ----------------------------------------------------------------------

/** Begins a stroke at a cell: from a dot, a fresh path from that dot; from a cell on a path,
 *  that path cut back to the cell. Returns the pair, or -1 when the cell starts nothing. */
export function begin(s: BondState, cell: number): number {
  for (let p = 0; p < s.pairs.length; p++) {
    const [a, b] = s.pairs[p];
    if (cell === a || cell === b) {
      const path = s.paths[p];
      // Touching the far end of a finished path keeps it; anything else restarts from this dot.
      if (complete(s, p) && path[path.length - 1] === cell) return p;
      s.paths[p] = [cell];
      return p;
    }
  }
  for (let p = 0; p < s.paths.length; p++) {
    const k = s.paths[p].indexOf(cell);
    if (k >= 0) { s.paths[p] = s.paths[p].slice(0, k + 1); return p; }
  }
  return -1;
}

/**
 * Extends pair p's path into a cell during a stroke. Back onto the previous cell pulls the path
 * in; onto an earlier cell of its own cuts it back; onto another path's cell cuts that path
 * there; onto a dot of another pair, or through a finished path's far end, does nothing.
 */
export function extend(s: BondState, p: number, cell: number): boolean {
  const n = s.size;
  const path = s.paths[p];
  if (!path.length) return false;
  const head = path[path.length - 1];
  if (cell === head) return false;
  if (complete(s, p)) return false;
  if (!adjacent(n, head, cell)) return false;
  const k = path.indexOf(cell);
  if (k >= 0) { s.paths[p] = path.slice(0, k + 1); return true; }
  for (let q = 0; q < s.pairs.length; q++) {
    if (q === p) continue;
    const [qa, qb] = s.pairs[q];
    if (cell === qa || cell === qb) return false;
    const j = s.paths[q].indexOf(cell);
    if (j >= 0) s.paths[q] = s.paths[q].slice(0, j);
  }
  path.push(cell);
  return true;
}

/** A pair whose drawn path strays from the answer (from either dot), or -1 when none does. */
export function firstWrong(s: BondState): number {
  for (let p = 0; p < s.pairs.length; p++) {
    const path = s.paths[p];
    if (path.length < 2) continue;
    const sol = s.solution[p];
    const along = path[0] === sol[0] ? sol : sol.slice().reverse();
    for (let i = 0; i < path.length; i++) if (path[i] !== along[i]) return p;
  }
  return -1;
}

/** The answer's path for pair p, run from the dot the player's path starts at (or its first dot). */
export function answerFor(s: BondState, p: number): number[] {
  const sol = s.solution[p];
  const path = s.paths[p];
  return path.length && path[0] === sol[sol.length - 1] ? sol.slice().reverse() : sol.slice();
}
