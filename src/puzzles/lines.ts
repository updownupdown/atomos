// Field Lines: draw one path through the grid that obeys every mark it passes.
//
// The path runs along the edges of a small grid from a start node to an end
// node. Two kinds of mark constrain it: dots on edges, which the path must
// run over, and coloured cells, which the path must sort so that every region
// it cuts the grid into holds one colour only. A level is built from a random
// self-avoiding walk, and the marks are read off that walk, so an answer always
// exists; any path meeting the marks counts.
//
// Game rule, not physics: the colours borrow the sub-shell palette for mood,
// nothing here is labelled as a field line or an orbital.

import { rand, randInt, seeded, type Rng } from './rng';

export type Kind = 's' | 'p' | 'd' | 'f';

export interface Pt { x: number; y: number }

export interface LinesState {
  /** Cells across and down; nodes are (cols+1) by (rows+1). */
  cols: number;
  rows: number;
  start: Pt;
  end: Pt;
  /** Edge keys (see edgeKey) that the path must cover. */
  dots: string[];
  /** Colour per cell (row-major, cols*rows), or null for a plain cell. */
  colours: (Kind | null)[];
  /** The path drawn so far, from the start node; empty before the first stroke. */
  path: Pt[];
  /** Check attempts. */
  moves: number;
  /** One check: get it right first time. */
  par: number;
  won: boolean;
  /** The walk the marks were read from. */
  solution: Pt[];
}

export const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

export const adjacent = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/** A direction-free name for the edge between two neighbouring nodes. */
export function edgeKey(a: Pt, b: Pt): string {
  const first = a.y < b.y || (a.y === b.y && a.x < b.x);
  const [p, q] = first ? [a, b] : [b, a];
  return `${p.x},${p.y}-${q.x},${q.y}`;
}

export function edgeOf(key: string): [Pt, Pt] {
  const [a, b] = key.split('-').map((s) => s.split(',').map(Number));
  return [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }];
}

export function pathEdges(path: Pt[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < path.length; i++) out.add(edgeKey(path[i - 1], path[i]));
  return out;
}

export function cloneLines(s: LinesState): LinesState {
  return { ...s, dots: [...s.dots], colours: [...s.colours], path: s.path.map((p) => ({ ...p })), solution: s.solution.map((p) => ({ ...p })) };
}

/** Region id per cell, where the path's edges are walls. */
export function regions(cols: number, rows: number, path: Pt[]): number[] {
  const walls = pathEdges(path);
  const id: number[] = Array(cols * rows).fill(-1);
  let next = 0;
  for (let seed = 0; seed < id.length; seed++) {
    if (id[seed] !== -1) continue;
    const stack = [seed];
    id[seed] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cols, y = Math.floor(i / cols);
      const step = (nx: number, ny: number, a: Pt, b: Pt) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        const j = ny * cols + nx;
        if (id[j] !== -1 || walls.has(edgeKey(a, b))) return;
        id[j] = next;
        stack.push(j);
      };
      step(x + 1, y, { x: x + 1, y }, { x: x + 1, y: y + 1 });
      step(x - 1, y, { x, y }, { x, y: y + 1 });
      step(x, y + 1, { x, y: y + 1 }, { x: x + 1, y: y + 1 });
      step(x, y - 1, { x, y }, { x: x + 1, y });
    }
    next++;
  }
  return id;
}

export interface Verdict {
  complete: boolean;
  /** Dotted edges the path does not cover. */
  missed: string[];
  /** Coloured cells sharing a region with another colour. */
  clashes: number[];
}

/** How a path measures up against the marks. */
export function verdict(s: LinesState, path: Pt[]): Verdict {
  const edges = pathEdges(path);
  const missed = s.dots.filter((k) => !edges.has(k));
  const reg = regions(s.cols, s.rows, path);
  const seen = new Map<number, Set<Kind>>();
  s.colours.forEach((k, i) => {
    if (!k) return;
    (seen.get(reg[i]) ?? seen.set(reg[i], new Set()).get(reg[i])!).add(k);
  });
  const clashes: number[] = [];
  s.colours.forEach((k, i) => { if (k && seen.get(reg[i])!.size > 1) clashes.push(i); });
  const complete = path.length > 1 && same(path[0], s.start) && same(path[path.length - 1], s.end);
  return { complete, missed, clashes };
}

export function satisfies(s: LinesState, path: Pt[]): boolean {
  const v = verdict(s, path);
  return v.complete && !v.missed.length && !v.clashes.length;
}

export function solved(s: LinesState): boolean {
  return s.won;
}

const inGrid = (s: LinesState, p: Pt) => p.x >= 0 && p.y >= 0 && p.x <= s.cols && p.y <= s.rows;

/**
 * Moves the pen to a node: onto the start to begin, onto a free neighbour of
 * the pen to extend, or back onto the previous node to retract. Null when the
 * node is not reachable in one step.
 */
export function extend(s: LinesState, node: Pt): LinesState | null {
  if (s.won || !inGrid(s, node)) return null;
  const next = cloneLines(s);
  if (!s.path.length) {
    if (!same(node, s.start)) return null;
    next.path = [{ ...node }];
    return next;
  }
  const last = s.path[s.path.length - 1];
  if (s.path.length > 1 && same(node, s.path[s.path.length - 2])) {
    next.path.pop();
    return next;
  }
  if (!adjacent(last, node) || s.path.some((p) => same(p, node))) return null;
  next.path.push({ ...node });
  return next;
}

/** Lifts the last node off the path. */
export function retract(s: LinesState): LinesState | null {
  if (s.won || !s.path.length) return null;
  const next = cloneLines(s);
  next.path.pop();
  return next;
}

export function clearPath(s: LinesState): LinesState | null {
  if (s.won || !s.path.length) return null;
  return { ...cloneLines(s), path: [] };
}

/** Judges the path as drawn: one more attempt, and a win when it meets every mark. */
export function check(s: LinesState): LinesState {
  const next = cloneLines(s);
  next.moves += 1;
  next.won = satisfies(s, s.path);
  return next;
}

// ---- generation ------------------------------------------------------------------

function shuffled<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A random self-avoiding walk from start to end of at least `minLen` nodes, or null within the budget. */
function walk(rng: Rng, cols: number, rows: number, start: Pt, end: Pt, minLen: number): Pt[] | null {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const path: Pt[] = [start];
  let budget = 40000;
  const go = (): boolean => {
    if (--budget < 0) return false;
    const cur = path[path.length - 1];
    if (same(cur, end)) return path.length >= minLen;
    const steps = shuffled(rng, [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
    for (const d of steps) {
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      if (n.x < 0 || n.y < 0 || n.x > cols || n.y > rows) continue;
      const k = `${n.x},${n.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      path.push(n);
      if (go()) return true;
      path.pop();
      seen.delete(k);
      if (budget < 0) return false;
    }
    return false;
  };
  return go() ? path.map((p) => ({ ...p })) : null;
}

function borderNodes(cols: number, rows: number): Pt[] {
  const out: Pt[] = [];
  for (let x = 0; x <= cols; x++) for (let y = 0; y <= rows; y++) if (x === 0 || y === 0 || x === cols || y === rows) out.push({ x, y });
  return out;
}

/** Grid size and mark counts for an element. */
export function sizeFor(z: number): { cols: number; rows: number; dots: number; kinds: number; perRegion: number } {
  const t = Math.min(118, Math.max(1, z));
  const cols = t < 20 ? 4 : t < 55 ? 5 : 6;
  const rows = cols;
  return { cols, rows, dots: 2 + Math.floor(t / 30), kinds: t < 40 ? 2 : 3, perRegion: t < 55 ? 1 : 2 };
}

/** A fresh level for an element: marks read off a hidden walk. */
export function newLines(z: number, seed: number): LinesState {
  const rng = seeded(seed);
  const { cols, rows, dots: dotCount, kinds, perRegion } = sizeFor(z);
  const corners: Pt[] = [{ x: 0, y: rows }, { x: 0, y: 0 }, { x: cols, y: rows }, { x: cols, y: 0 }];
  const palette = shuffled(rng, ['s', 'p', 'd', 'f'] as Kind[]).slice(0, kinds);
  const nodes = (cols + 1) * (rows + 1);
  let best: { path: Pt[]; start: Pt; end: Pt } | null = null;
  for (let attempt = 0; attempt < 30 && !best; attempt++) {
    const start = corners[randInt(rng, 4)];
    const ends = borderNodes(cols, rows).filter((p) => Math.abs(p.x - start.x) + Math.abs(p.y - start.y) >= Math.max(3, cols));
    const end = ends[randInt(rng, ends.length)];
    const minLen = Math.max(cols + rows, Math.round(nodes * (attempt < 10 ? 0.5 : 0.35)));
    const path = walk(rng, cols, rows, start, end, minLen);
    if (!path) continue;
    const reg = regions(cols, rows, path);
    if (Math.max(...reg) < 1) continue;
    best = { path, start, end };
  }
  if (!best) {
    // Vanishingly rare: a plain hook round the grid still cuts it in two.
    const path: Pt[] = [];
    for (let y = rows; y >= 0; y--) path.push({ x: 1, y });
    for (let x = 2; x <= cols; x++) path.push({ x, y: 0 });
    best = { path, start: path[0], end: path[path.length - 1] };
  }
  const { path, start, end } = best;

  // Dots: a spread of the walk's edges.
  const edges = [...pathEdges(path)];
  const dots = shuffled(rng, edges).slice(0, Math.min(dotCount, edges.length)).sort();

  // Colours: every region takes one colour, shown on a few of its cells.
  const reg = regions(cols, rows, path);
  const regionCount = Math.max(...reg) + 1;
  const regionKind: Kind[] = [];
  for (let r = 0; r < regionCount; r++) regionKind.push(palette[randInt(rng, palette.length)]);
  // Two neighbouring regions of one colour would make the constraint toothless; force a difference somewhere.
  if (regionCount > 1 && regionKind.every((k) => k === regionKind[0])) regionKind[randInt(rng, regionCount)] = palette.find((k) => k !== regionKind[0]) ?? regionKind[0];
  const colours: (Kind | null)[] = Array(cols * rows).fill(null);
  for (let r = 0; r < regionCount; r++) {
    const cells = reg.map((id, i) => (id === r ? i : -1)).filter((i) => i >= 0);
    const n = Math.min(cells.length, perRegion + (cells.length > 4 && rand(rng) < 0.5 ? 1 : 0));
    for (const i of shuffled(rng, cells).slice(0, n)) colours[i] = regionKind[r];
  }

  return { cols, rows, start, end, dots, colours, path: [], moves: 0, par: 1, won: false, solution: path };
}
