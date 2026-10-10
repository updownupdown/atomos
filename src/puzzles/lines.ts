// Field Lines: draw one path through the grid that obeys every mark on it.
//
// The path runs along the edges of a small grid from a start node to an end
// node, and cuts the grid's cells into pockets. Marks constrain it:
//
//   dots     beads on edges the path must run over;
//   gaps     broken edges the path cannot cross;
//   colours  coloured tiles: no pocket may hold two colours of tile;
//   counts   1 to 3 droplets in a cell: the path runs along exactly that many
//            of the cell's four sides;
//   pairs    coloured rings: a pocket holding a ring holds exactly two marks of
//            the ring's colour (rings and tiles alike);
//   shapes   tiny bead polyominoes: a pocket holding shapes is exactly those
//            shapes fitted together, unrotated.
//
// A level is built from a random self-avoiding walk, and every mark is read off
// that walk, so an answer always exists; any path meeting the marks counts.
// Rules arrive a band of elements at a time, two or three kinds per level.
//
// Game rule, not physics: the colours borrow the sub-shell palette for mood,
// nothing here is labelled as a field line or an orbital.

import { rand, randInt, seeded, type Rng } from './rng';

export type Kind = 's' | 'p' | 'd' | 'f';

export interface Pt { x: number; y: number }

export type Rule = 'dots' | 'colours' | 'counts' | 'gaps' | 'pairs' | 'shapes';

/** A symbol sitting in a cell. */
export type Mark =
  | { type: 'colour'; c: Kind }
  | { type: 'pair'; c: Kind }
  | { type: 'count'; n: number }
  /** Cells of the shape, normalised to start at (0, 0) and sorted row by row. */
  | { type: 'shape'; cells: Pt[] };

export interface LinesState {
  /** Cells across and down; nodes are (cols+1) by (rows+1). */
  cols: number;
  rows: number;
  /** Nodes a path may begin on (one, or two at high z). */
  starts: Pt[];
  /** Border nodes a path may finish on (one, or two at high z). */
  ends: Pt[];
  /** Edge keys (see edgeKey) that the path must cover. */
  dots: string[];
  /** Edge keys the path cannot cross. */
  gaps: string[];
  /** The symbol in each cell (row-major, cols*rows), or null. */
  marks: (Mark | null)[];
  /** The rule kinds this level uses, in introduction order. */
  rules: Rule[];
  /** The path drawn so far, from a start node; empty before the first stroke. */
  path: Pt[];
  /** Check attempts. */
  moves: number;
  /** One check: get it right first time. */
  par: number;
  won: boolean;
  /** The walk the marks were read from. */
  solution: Pt[];
}

export const RULE_ORDER: Rule[] = ['dots', 'colours', 'counts', 'gaps', 'pairs', 'shapes'];

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

/** The four sides of a cell, as edge keys. */
export function cellSides(cols: number, i: number): string[] {
  const x = i % cols, y = Math.floor(i / cols);
  return [
    edgeKey({ x, y }, { x: x + 1, y }),
    edgeKey({ x, y: y + 1 }, { x: x + 1, y: y + 1 }),
    edgeKey({ x, y }, { x, y: y + 1 }),
    edgeKey({ x: x + 1, y }, { x: x + 1, y: y + 1 }),
  ];
}

export function cloneLines(s: LinesState): LinesState {
  return {
    ...s,
    starts: s.starts.map((p) => ({ ...p })),
    ends: s.ends.map((p) => ({ ...p })),
    dots: [...s.dots],
    gaps: [...s.gaps],
    marks: [...s.marks],
    rules: [...s.rules],
    path: s.path.map((p) => ({ ...p })),
    solution: s.solution.map((p) => ({ ...p })),
  };
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

// ---- shapes ----------------------------------------------------------------------

/** Moves a set of cells to start at (0, 0), sorted row by row. */
export function normalise(cells: Pt[]): Pt[] {
  const minX = Math.min(...cells.map((p) => p.x)), minY = Math.min(...cells.map((p) => p.y));
  return cells.map((p) => ({ x: p.x - minX, y: p.y - minY })).sort((a, b) => a.y - b.y || a.x - b.x);
}

const shapeKey = (cells: Pt[]): string => cells.map((p) => `${p.x},${p.y}`).join(';');

/** True when the cells (indices) are exactly covered by the shapes, unrotated. */
export function tiles(cols: number, rows: number, cells: number[], shapes: Pt[][]): boolean {
  if (shapes.reduce((a, sh) => a + sh.length, 0) !== cells.length) return false;
  const free = new Set(cells);
  const used = shapes.map(() => false);
  const go = (): boolean => {
    if (!free.size) return true;
    let first = Infinity;
    for (const i of free) if (i < first) first = i;
    const fx = first % cols, fy = Math.floor(first / cols);
    const tried = new Set<string>();
    for (let k = 0; k < shapes.length; k++) {
      if (used[k]) continue;
      const key = shapeKey(shapes[k]);
      if (tried.has(key)) continue;
      tried.add(key);
      const a = shapes[k][0];
      const placed: number[] = [];
      let fits = true;
      for (const p of shapes[k]) {
        const x = fx + p.x - a.x, y = fy + p.y - a.y;
        const j = y * cols + x;
        if (x < 0 || y < 0 || x >= cols || y >= rows || !free.has(j)) { fits = false; break; }
        placed.push(j);
      }
      if (!fits) continue;
      for (const j of placed) free.delete(j);
      used[k] = true;
      if (go()) return true;
      used[k] = false;
      for (const j of placed) free.add(j);
    }
    return false;
  };
  return go();
}

// ---- judging ---------------------------------------------------------------------

export interface Verdict {
  /** Starts on a start, ends on an end, one grid step at a time, never revisiting a node. */
  complete: boolean;
  /** Dotted edges the path does not cover. */
  missed: string[];
  /** Broken edges the path runs over (drawing never allows it; checked anyway). */
  crossed: string[];
  /** Cells whose mark is broken, sorted. */
  failed: number[];
  /** Everything met. */
  ok: boolean;
}

function validSteps(s: LinesState, path: Pt[]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p.x < 0 || p.y < 0 || p.x > s.cols || p.y > s.rows) return false;
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    if (i && !adjacent(path[i - 1], p)) return false;
  }
  return true;
}

/** How a path measures up against every mark: which ones it breaks. */
export function verdict(s: LinesState, path: Pt[]): Verdict {
  const edges = pathEdges(path);
  const missed = s.dots.filter((k) => !edges.has(k));
  const crossed = s.gaps.filter((k) => edges.has(k));
  const complete = path.length > 1 && validSteps(s, path) && s.starts.some((p) => same(p, path[0])) && s.ends.some((p) => same(p, path[path.length - 1]));
  const reg = regions(s.cols, s.rows, path);
  const pockets = new Map<number, number[]>();
  reg.forEach((r, i) => (pockets.get(r) ?? pockets.set(r, []).get(r)!).push(i));
  const failed = new Set<number>();
  for (const cells of pockets.values()) {
    // Colours: one colour of tile per pocket.
    const tilesIn = cells.filter((i) => s.marks[i]?.type === 'colour');
    if (new Set(tilesIn.map((i) => (s.marks[i] as { c: Kind }).c)).size > 1) tilesIn.forEach((i) => failed.add(i));
    // Pairs: each ring's colour appears exactly twice in its pocket.
    for (const i of cells) {
      const m = s.marks[i];
      if (m?.type !== 'pair') continue;
      const n = cells.filter((j) => { const o = s.marks[j]; return (o?.type === 'pair' || o?.type === 'colour') && o.c === m.c; }).length;
      if (n !== 2) failed.add(i);
    }
    // Shapes: the pocket is exactly its shapes fitted together.
    const shapeCells = cells.filter((i) => s.marks[i]?.type === 'shape');
    if (shapeCells.length && !tiles(s.cols, s.rows, cells, shapeCells.map((i) => (s.marks[i] as { cells: Pt[] }).cells))) shapeCells.forEach((i) => failed.add(i));
  }
  // Counts: exactly n sides of the cell on the path.
  s.marks.forEach((m, i) => {
    if (m?.type !== 'count') return;
    if (cellSides(s.cols, i).filter((k) => edges.has(k)).length !== m.n) failed.add(i);
  });
  const out = [...failed].sort((a, b) => a - b);
  return { complete, missed, crossed, failed: out, ok: complete && !missed.length && !crossed.length && !out.length };
}

export function satisfies(s: LinesState, path: Pt[]): boolean {
  return verdict(s, path).ok;
}

export function solved(s: LinesState): boolean {
  return s.won;
}

const inGrid = (s: LinesState, p: Pt) => p.x >= 0 && p.y >= 0 && p.x <= s.cols && p.y <= s.rows;

export const isStart = (s: LinesState, p: Pt): boolean => s.starts.some((q) => same(q, p));
export const isEnd = (s: LinesState, p: Pt): boolean => s.ends.some((q) => same(q, p));

/**
 * Moves the pen to a node: onto a start to begin, onto a free neighbour of the
 * pen across an unbroken edge to extend, or back onto the previous node to
 * retract. Null when the node is not reachable in one step.
 */
export function extend(s: LinesState, node: Pt): LinesState | null {
  if (s.won || !inGrid(s, node)) return null;
  const next = cloneLines(s);
  if (!s.path.length) {
    if (!isStart(s, node)) return null;
    next.path = [{ ...node }];
    return next;
  }
  const last = s.path[s.path.length - 1];
  if (s.path.length > 1 && same(node, s.path[s.path.length - 2])) {
    next.path.pop();
    return next;
  }
  if (!adjacent(last, node) || s.path.some((p) => same(p, node))) return null;
  if (s.gaps.includes(edgeKey(last, node))) return null;
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
  const W = cols + 1, H = rows + 1;
  const seen = new Uint8Array(W * H);
  const id = (p: Pt) => p.y * W + p.x;
  seen[id(start)] = 1;
  const path: Pt[] = [start];
  const endId = id(end);
  const mark = new Int32Array(W * H);
  let stamp = 0;
  const stack: number[] = [];
  /** How many free nodes the pen can still reach, or -1 when the end is cut off. */
  const reach = (from: number): number => {
    stamp++;
    stack.length = 0;
    stack.push(from);
    mark[from] = stamp;
    let n = 0, found = false;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      if (i === endId) found = true;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H || seen[j] || mark[j] === stamp) continue;
        mark[j] = stamp;
        stack.push(j);
      }
    }
    return found ? n : -1;
  };
  let budget = 6000;
  const go = (): boolean => {
    if (--budget < 0) return false;
    const cur = path[path.length - 1];
    if (same(cur, end)) return path.length >= minLen;
    const steps = shuffled(rng, [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
    for (const d of steps) {
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      if (n.x < 0 || n.y < 0 || n.x > cols || n.y > rows) continue;
      const k = id(n);
      if (seen[k]) continue;
      // Prune: the end must stay reachable, with room left for the minimum length.
      const r = reach(k);
      if (r < 0 || path.length + r < minLen) continue;
      seen[k] = 1;
      path.push(n);
      if (go()) return true;
      path.pop();
      seen[k] = 0;
      if (budget < 0) return false;
    }
    return false;
  };
  return go() ? path.map((p) => ({ ...p })) : null;
}

function borderNodes(cols: number, rows: number): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) if (x === 0 || y === 0 || x === cols || y === rows) out.push({ x, y });
  return out;
}

function allEdges(cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    if (x < cols) out.push(edgeKey({ x, y }, { x: x + 1, y }));
    if (y < rows) out.push(edgeKey({ x, y }, { x, y: y + 1 }));
  }
  return out;
}

const clampZ = (z: number) => Math.min(118, Math.max(1, Math.round(z)));

/** Grid size for an element: 4x4 cells early, 5x5 in the middle, 6x6 late. */
export function sizeFor(z: number): { cols: number; rows: number } {
  const t = clampZ(z);
  const cols = t < 20 ? 4 : t < 56 ? 5 : 6;
  return { cols, rows: cols };
}

/** The element at which each rule first appears. */
export const INTRO: Record<Rule, number> = { dots: 1, colours: 1, counts: 12, gaps: 24, pairs: 36, shapes: 50 };

/**
 * Which rule kinds a level uses: the newest kind for its band plus one or two
 * older ones, so a level mixes two or three kinds and never all at once.
 */
export function rulesFor(z: number, rng: Rng): { rules: Rule[]; extraStart: boolean; extraEnd: boolean } {
  const t = clampZ(z);
  const pickOne = <T>(items: T[]): T => items[randInt(rng, items.length)];
  let rules: Rule[];
  if (t < INTRO.counts) rules = ['dots', 'colours'];
  else if (t < INTRO.gaps) rules = ['counts', pickOne<Rule>(['dots', 'colours'])];
  else if (t < INTRO.pairs) rules = ['gaps', pickOne<Rule>(['counts', 'colours']), ...(rand(rng) < 0.3 ? ['dots' as Rule] : [])];
  else if (t < INTRO.shapes) rules = ['pairs', pickOne<Rule>(['colours', 'colours', 'gaps', 'counts'])];
  else if (t < 64) rules = ['shapes', pickOne<Rule>(['dots', 'gaps', 'colours'])];
  else {
    // The full mix: one of the heavier kinds, then one or two partners.
    const heavy = pickOne<Rule>(['counts', 'pairs', 'shapes', 'pairs', 'shapes']);
    const rest = shuffled(rng, RULE_ORDER.filter((r) => r !== heavy));
    const n = rand(rng) < 0.25 + (t - 64) / 100 ? 2 : 1;
    rules = [heavy, ...rest.slice(0, n)];
  }
  const set = new Set(rules);
  rules = RULE_ORDER.filter((r) => set.has(r));
  const two = t >= 80 && rand(rng) < 0.5;
  const extraStart = two && rand(rng) < 0.5;
  return { rules, extraStart, extraEnd: two && !extraStart };
}

/** Splits a pocket into one or two bead shapes no bigger than five cells or four across. */
function shapePieces(rng: Rng, cols: number, cells: number[]): Pt[][] | null {
  const toPts = (ids: number[]) => ids.map((i) => ({ x: i % cols, y: Math.floor(i / cols) }));
  const fits = (ids: number[]) => {
    if (ids.length < 2 || ids.length > 5) return false;
    const n = normalise(toPts(ids));
    return Math.max(...n.map((p) => p.x)) < 4 && Math.max(...n.map((p) => p.y)) < 4;
  };
  if (cells.length <= 5) return fits(cells) ? [normalise(toPts(cells))] : null;
  if (cells.length > 9) return null;
  const inSet = new Set(cells);
  const neighbours = (i: number) => {
    const x = i % cols;
    return [i - cols, i + cols, x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1].filter((j) => j >= 0 && inSet.has(j));
  };
  const connected = (ids: number[]) => {
    const set = new Set(ids);
    const seen = new Set([ids[0]]);
    const stack = [ids[0]];
    while (stack.length) for (const j of neighbours(stack.pop()!)) if (set.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
    return seen.size === ids.length;
  };
  for (let attempt = 0; attempt < 24; attempt++) {
    const size = Math.max(cells.length - 5, 2) + randInt(rng, Math.min(5, cells.length - 2) - Math.max(cells.length - 5, 2) + 1);
    const piece = [cells[randInt(rng, cells.length)]];
    const inPiece = new Set(piece);
    while (piece.length < size) {
      const frontier = [...new Set(piece.flatMap(neighbours))].filter((j) => !inPiece.has(j));
      if (!frontier.length) break;
      const j = frontier[randInt(rng, frontier.length)];
      piece.push(j);
      inPiece.add(j);
    }
    const rest = cells.filter((j) => !inPiece.has(j));
    if (!fits(piece) || !fits(rest) || !connected(rest)) continue;
    return [normalise(toPts(piece)), normalise(toPts(rest))];
  }
  return null;
}

interface Plan { cols: number; rows: number; rules: Rule[]; extraStart: boolean; extraEnd: boolean }

/** Reads marks for the planned rules off one walk; null when this walk cannot carry them. */
function marksFor(rng: Rng, plan: Plan, z: number, path: Pt[]): Pick<LinesState, 'dots' | 'gaps' | 'marks'> | null {
  const { cols, rows, rules } = plan;
  const has = (r: Rule) => rules.includes(r);
  const reg = regions(cols, rows, path);
  const regionCount = Math.max(...reg) + 1;
  if (regionCount < 2) return null;
  const pockets: number[][] = Array.from({ length: regionCount }, () => []);
  reg.forEach((r, i) => pockets[r].push(i));
  const marks: (Mark | null)[] = Array(cols * rows).fill(null);
  const freeIn = (r: number) => pockets[r].filter((i) => !marks[i]);
  const edges = pathEdges(path);
  const heavy = rules.length >= 3;

  // Shapes first: they need whole pockets.
  if (has('shapes')) {
    const want = z >= 80 && !heavy ? 2 : 1;
    let placed = 0;
    for (const r of shuffled(rng, pockets.map((_, r) => r)).sort((a, b) => Math.abs(pockets[a].length - 5) - Math.abs(pockets[b].length - 5))) {
      if (placed >= want) break;
      const pieces = shapePieces(rng, cols, pockets[r]);
      if (!pieces) continue;
      const spots = shuffled(rng, freeIn(r)).slice(0, pieces.length);
      pieces.forEach((cells, k) => { marks[spots[k]] = { type: 'shape', cells }; });
      placed++;
    }
    if (!placed) return null;
  }

  // Colours: every pocket takes one colour, shown on a few of its cells.
  const kinds = shuffled(rng, ['s', 'p', 'd', 'f'] as Kind[]).slice(0, z < 40 ? 2 : 3);
  if (has('colours')) {
    const perRegion = z < 56 ? 1 : 2;
    const regionKind = pockets.map(() => kinds[randInt(rng, kinds.length)]);
    if (regionKind.every((k) => k === regionKind[0])) regionKind[randInt(rng, regionCount)] = kinds.find((k) => k !== regionKind[0])!;
    pockets.forEach((_, r) => {
      const free = freeIn(r);
      const n = Math.min(free.length, perRegion + (free.length > 4 && rand(rng) < 0.5 ? 1 : 0));
      for (const i of shuffled(rng, free).slice(0, n)) marks[i] = { type: 'colour', c: regionKind[r] };
    });
    const shown = new Set(marks.filter((m) => m?.type === 'colour').map((m) => (m as { c: Kind }).c));
    if (shown.size < 2) return null;
  }

  // Pairs: a ring of a colour sits with exactly one other mark of that colour.
  if (has('pairs')) {
    const want = heavy ? 1 + randInt(rng, 2) : 2 + (z >= 70 ? 1 : 0);
    let placed = 0;
    for (const r of shuffled(rng, pockets.map((_, r) => r))) {
      if (placed >= want) break;
      const free = shuffled(rng, freeIn(r));
      const tilesIn = pockets[r].filter((i) => marks[i]?.type === 'colour');
      const tileKind = tilesIn.length ? (marks[tilesIn[0]] as { c: Kind }).c : null;
      if (tilesIn.length === 1 && free.length >= 1 && rand(rng) < 0.6) {
        marks[free[0]] = { type: 'pair', c: tileKind! };
      } else if (free.length >= 2) {
        const options = kinds.filter((k) => k !== tileKind && !pockets[r].some((i) => { const m = marks[i]; return (m?.type === 'pair' || m?.type === 'colour') && m.c === k; }));
        if (!options.length) continue;
        const c = options[randInt(rng, options.length)];
        marks[free[0]] = { type: 'pair', c };
        marks[free[1]] = { type: 'pair', c };
      } else continue;
      placed++;
    }
    if (!placed) return null;
  }

  // Counts: droplets in cells the path runs beside.
  if (has('counts')) {
    const want = Math.min(heavy ? 3 : 6, 2 + Math.floor(z / 25));
    const sideCount = (i: number) => cellSides(cols, i).filter((k) => edges.has(k)).length;
    const cands = shuffled(rng, marks.map((m, i) => (!m && sideCount(i) > 0 ? i : -1)).filter((i) => i >= 0));
    // Favour twos and threes: they say more about the path's turns.
    cands.sort((a, b) => (sideCount(a) === 1 ? 1 : 0) - (sideCount(b) === 1 ? 1 : 0));
    const chosen = cands.slice(0, want);
    if (chosen.length < 2) return null;
    for (const i of chosen) marks[i] = { type: 'count', n: sideCount(i) };
  }

  // Dots: a spread of the walk's edges.
  let dots: string[] = [];
  if (has('dots')) {
    const want = Math.min(heavy ? 3 : 6, 2 + Math.floor(z / 30));
    dots = shuffled(rng, [...edges]).slice(0, want).sort();
  }

  // Gaps: broken edges off the walk, mostly ones that touch it, to block tempting shortcuts.
  let gaps: string[] = [];
  if (has('gaps')) {
    const want = Math.min(heavy ? 4 : 7, 3 + Math.floor(z / 30));
    const onPath = new Set(path.map((p) => `${p.x},${p.y}`));
    const off = allEdges(cols, rows).filter((k) => !edges.has(k));
    const touching = shuffled(rng, off.filter((k) => edgeOf(k).some((p) => onPath.has(`${p.x},${p.y}`))));
    const others = shuffled(rng, off.filter((k) => !edgeOf(k).some((p) => onPath.has(`${p.x},${p.y}`))));
    const nearCount = Math.ceil(want * 0.75);
    gaps = [...touching.slice(0, nearCount), ...others, ...touching.slice(nearCount)].slice(0, want).sort();
    if (gaps.length < 2) return null;
  }

  return { dots, gaps, marks };
}

/** A fresh level for an element: marks read off a hidden walk. */
export function newLines(z: number, seed: number): LinesState {
  const rng = seeded(seed);
  const t = clampZ(z);
  const { cols, rows } = sizeFor(t);
  const chosen = rulesFor(t, rng);
  const plan: Plan = { cols, rows, ...chosen };
  const corners: Pt[] = [{ x: 0, y: rows }, { x: 0, y: 0 }, { x: cols, y: rows }, { x: cols, y: 0 }];
  const nodes = (cols + 1) * (rows + 1);
  for (let attempt = 0; attempt < 80; attempt++) {
    // A rule that will not take after many walks gives way to colours, so a level always comes out.
    if (attempt === 60 && plan.rules.includes('shapes')) plan.rules = RULE_ORDER.filter((r) => r === 'colours' || (r !== 'shapes' && plan.rules.includes(r)));
    const interior = t >= 30 && rand(rng) < 0.35;
    const start = interior ? { x: 1 + randInt(rng, cols - 1), y: 1 + randInt(rng, rows - 1) } : corners[randInt(rng, 4)];
    const ends = borderNodes(cols, rows).filter((p) => Math.abs(p.x - start.x) + Math.abs(p.y - start.y) >= Math.max(3, cols - (interior ? 1 : 0)));
    const end = ends[randInt(rng, ends.length)];
    const minLen = Math.max(cols + rows, Math.round(nodes * (attempt < 20 ? 0.5 : 0.35)));
    const path = walk(rng, cols, rows, start, end, minLen);
    if (!path) continue;
    const read = marksFor(rng, plan, t, path);
    if (!read) continue;
    const starts = [start];
    const endList = [end];
    if (plan.extraStart) {
      const pool = [];
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) if (!same({ x, y }, start) && !same({ x, y }, end) && Math.abs(x - start.x) + Math.abs(y - start.y) >= 2) pool.push({ x, y });
      starts.push(pool[randInt(rng, pool.length)]);
    }
    if (plan.extraEnd) {
      const pool = borderNodes(cols, rows).filter((p) => !same(p, start) && Math.abs(p.x - end.x) + Math.abs(p.y - end.y) >= 2);
      endList.push(pool[randInt(rng, pool.length)]);
    }
    const level: LinesState = { cols, rows, starts: shuffled(rng, starts), ends: shuffled(rng, endList), ...read, rules: [...plan.rules], path: [], moves: 0, par: 1, won: false, solution: path };
    if (satisfies(level, path)) return level;
  }
  // Vanishingly rare: a plain hook round the grid still cuts it in two.
  const path: Pt[] = [];
  for (let y = rows; y >= 0; y--) path.push({ x: 1, y });
  for (let x = 2; x <= cols; x++) path.push({ x, y: 0 });
  const marks: (Mark | null)[] = Array(cols * rows).fill(null);
  marks[cols * (rows - 1)] = { type: 'colour', c: 's' };
  marks[cols * rows - 1] = { type: 'colour', c: 'p' };
  return { cols, rows, starts: [path[0]], ends: [path[path.length - 1]], dots: [edgeKey(path[1], path[2])], gaps: [], marks, rules: ['dots', 'colours'], path: [], moves: 0, par: 1, won: false, solution: path };
}
