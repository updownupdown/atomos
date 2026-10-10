// Slide Until Stop: an ice maze. The droplet slides in the chosen direction
// until a rock or the edge stops it. Stop exactly on the goal ring to win;
// passing over the goal does not count.
//
// Heavier elements add, one at a time:
//   sparks   the droplet must pass over (or stop on) every spark before the
//            ring counts;
//   sticky   patches the droplet stops on as soon as it enters;
//   cracks   thin ice that breaks into a rock once the droplet has left it;
//   arrows   one-way cells, entered only while moving the way they point
//            (leaving is free).
//
// A level is a random field checked by breadth-first search over (cell,
// sparks collected, cracks broken). The goal is put where the shortest route
// is longest within the element's range, and a field is kept only when that
// route actually uses each kind of tile on the board, so none is decoration.

import { pick, rand, randInt, seeded, type Rng } from './rng';

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

/**
 * Tiles: '.' ice, '#' rock, '~' sticky, '%' crack, and '^' 'v' '<' '>' arrows
 * (enterable only moving up, down, left, right).
 */
export type Tile = '.' | '#' | '~' | '%' | '^' | 'v' | '<' | '>';

export interface SlideStopState {
  size: number;
  /** Row-major, size*size, the tiles as dealt (cracks stay '%'; see `broken`). */
  tiles: Tile[];
  /** Spark cells, in a fixed order; bit i of `got` is spark i. */
  sparks: number[];
  got: number;
  /** Bit i set once the i-th crack (row-major order) has broken into a rock. */
  broken: number;
  start: number;
  goal: number;
  /** The droplet's cell index. */
  pos: number;
  moves: number;
  /** Shortest number of slides from the start to a win. */
  par: number;
}

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ARROW: Record<Dir, Tile> = { up: '^', down: 'v', left: '<', right: '>' };
const ARROWS = new Set<Tile>(['^', 'v', '<', '>']);

export function cloneSlideStop(s: SlideStopState): SlideStopState {
  return { ...s, tiles: [...s.tiles], sparks: [...s.sparks] };
}

export const cellX = (s: { size: number }, i: number): number => i % s.size;
export const cellY = (s: { size: number }, i: number): number => Math.floor(i / s.size);

/** The cracks' cells in row-major order: crack i is bit i of `broken`. */
export function cracksOf(s: Pick<SlideStopState, 'tiles'>): number[] {
  const out: number[] = [];
  s.tiles.forEach((t, i) => { if (t === '%') out.push(i); });
  return out;
}

/** True when a cell is a rock now: dealt as one, or a crack already broken. */
export function isRock(s: SlideStopState, i: number): boolean {
  if (s.tiles[i] === '#') return true;
  if (s.tiles[i] !== '%') return false;
  return (s.broken >> cracksOf(s).indexOf(i) & 1) === 1;
}

export interface Run {
  /** Where the droplet comes to rest; equals the start when nothing moves. */
  end: number;
  /** Cells entered, in order, ending with `end`. */
  path: number[];
  got: number;
  broken: number;
}

/** Shared mover for play and the solver: the board, the sparks and cracks as index lookups. */
interface Geo {
  size: number;
  tiles: Tile[];
  sparkBit: Int8Array;
  crackBit: Int8Array;
}

function geoOf(s: Pick<SlideStopState, 'size' | 'tiles' | 'sparks'>): Geo {
  const n = s.size * s.size;
  const sparkBit = new Int8Array(n).fill(-1);
  s.sparks.forEach((c, i) => { sparkBit[c] = i; });
  const crackBit = new Int8Array(n).fill(-1);
  let k = 0;
  s.tiles.forEach((t, i) => { if (t === '%') crackBit[i] = k++; });
  return { size: s.size, tiles: s.tiles, sparkBit, crackBit };
}

function runOn(g: Geo, from: number, got: number, broken: number, dir: Dir, path: number[] | null): [number, number, number] {
  const [dx, dy] = DELTA[dir];
  const size = g.size;
  let x = from % size, y = (from - x) / size;
  let cur = from;
  for (;;) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
    const ni = ny * size + nx;
    const t = g.tiles[ni];
    if (t === '#') break;
    if (t === '%' && (broken >> g.crackBit[ni] & 1)) break;
    if (ARROWS.has(t) && t !== ARROW[dir]) break;
    // Leaving a crack breaks it.
    if (g.crackBit[cur] >= 0) broken |= 1 << g.crackBit[cur];
    x = nx; y = ny; cur = ni;
    path?.push(ni);
    if (g.sparkBit[ni] >= 0) got |= 1 << g.sparkBit[ni];
    if (t === '~') break;
  }
  return [cur, got, broken];
}

/** Where a slide from the droplet's cell ends, what it collects and what it breaks. */
export function slideRun(s: SlideStopState, dir: Dir, from = s.pos): Run {
  const path: number[] = [];
  const [end, got, broken] = runOn(geoOf(s), from, s.got, s.broken, dir, path);
  return { end, path, got, broken };
}

/** Where a slide from `from` in `dir` comes to rest. Equals `from` when nothing moves. */
export function slideEnd(s: SlideStopState, from: number, dir: Dir): number {
  return slideRun(s, dir, from).end;
}

/** Slides the droplet; null when it cannot move that way. */
export function slide(s: SlideStopState, dir: Dir): SlideStopState | null {
  const r = slideRun(s, dir);
  if (r.end === s.pos) return null;
  return { ...cloneSlideStop(s), pos: r.end, got: r.got, broken: r.broken, moves: s.moves + 1 };
}

export const allSparks = (s: { sparks: number[] }): number => (1 << s.sparks.length) - 1;

export function solved(s: SlideStopState): boolean {
  return s.pos === s.goal && s.got === allSparks(s);
}

interface Search {
  /** Distance of each visited state from the search start, -1 if unvisited. */
  dist: Int16Array;
  prev: Int32Array;
  via: Int8Array;
  states: number;
  sparkStates: number;
}

/** Breadth-first search over (cell, sparks, cracks) from the given state. */
function search(s: SlideStopState): Search {
  const g = geoOf(s);
  const n = s.size * s.size;
  const sparkStates = 1 << s.sparks.length;
  const states = n * sparkStates * (1 << cracksOf(s).length);
  const dist = new Int16Array(states).fill(-1);
  const prev = new Int32Array(states).fill(-1);
  const via = new Int8Array(states).fill(-1);
  const code = (p: number, got: number, br: number) => p + n * (got + sparkStates * br);
  const first = code(s.pos, s.got, s.broken);
  dist[first] = 0;
  const queue = new Int32Array(states);
  let qn = 0;
  queue[qn++] = first;
  for (let qi = 0; qi < qn; qi++) {
    const c = queue[qi];
    const p = c % n, rest = (c - p) / n, got = rest % sparkStates, br = (rest - got) / sparkStates;
    for (let d = 0; d < 4; d++) {
      const [e, g2, b2] = runOn(g, p, got, br, DIRS[d], null);
      if (e === p) continue;
      const nc = code(e, g2, b2);
      if (dist[nc] >= 0) continue;
      dist[nc] = dist[c] + 1;
      prev[nc] = c;
      via[nc] = d;
      queue[qn++] = nc;
    }
  }
  return { dist, prev, via, states, sparkStates };
}

function pathTo(sr: Search, target: number): Dir[] {
  const out: Dir[] = [];
  for (let c = target; sr.prev[c] >= 0; c = sr.prev[c]) out.push(DIRS[sr.via[c]]);
  return out.reverse();
}

/** The nearest winning state for a goal cell, as a state code, or -1. */
function bestWin(s: SlideStopState, sr: Search, goal: number): number {
  const n = s.size * s.size;
  const all = allSparks(s);
  let best = -1;
  for (let c = goal + n * all; c < sr.states; c += n * sr.sparkStates) {
    if (sr.dist[c] >= 0 && (best < 0 || sr.dist[c] < sr.dist[best])) best = c;
  }
  return best;
}

/** Shortest slide sequence from the current state to a win, or null when none is left. */
export function solve(s: SlideStopState): Dir[] | null {
  if (solved(s)) return [];
  const sr = search(s);
  const c = bestWin(s, sr, s.goal);
  return c < 0 ? null : pathTo(sr, c);
}

/** True when a win can still be reached from here. */
export function reachable(s: SlideStopState): boolean {
  return solve(s) !== null;
}

// ---- generation -----------------------------------------------------------------

export interface SlideStopPlan {
  size: number;
  sparks: number;
  sticky: number;
  cracks: number;
  arrows: number;
  minPar: number;
  maxPar: number;
}

/**
 * What an element's maze holds. The period gates sit at z 1, 3, 11, 19, 37,
 * 55 and 87, and each one brings something: sparks at 3, sticky patches at
 * 11, cracks at 19, arrows at 37, then more of everything.
 */
export function slideStopPlan(z: number): SlideStopPlan {
  const minPar = Math.min(9, 3 + Math.floor(z / 20));
  return {
    size: z < 30 ? 7 : z < 80 ? 8 : 9,
    sparks: z >= 55 ? 3 : z >= 19 ? 2 : z >= 3 ? 1 : 0,
    sticky: z >= 55 ? 3 : z >= 11 ? 2 : 0,
    cracks: z >= 87 ? 3 : z >= 19 ? 2 : 0,
    arrows: z >= 87 ? 3 : z >= 37 ? 2 : 0,
    minPar,
    maxPar: minPar + 2 + Math.floor(z / 25),
  };
}

function shuffleFree(rng: Rng, tiles: Tile[]): number[] {
  const free = tiles.map((t, i) => (t === '.' ? i : -1)).filter((i) => i >= 0);
  for (let i = free.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free;
}

/** Which kinds of tile an optimal route uses: stops on sticky, breaks a crack, passes an arrow. */
function uses(s: SlideStopState, route: Dir[]): { sticky: boolean; crack: boolean; arrow: boolean } {
  const u = { sticky: false, crack: false, arrow: false };
  let cur = s;
  for (const d of route) {
    const r = slideRun(cur, d);
    if (cur.tiles[r.end] === '~') u.sticky = true;
    if (r.broken !== cur.broken) u.crack = true;
    if (r.path.some((i) => ARROWS.has(cur.tiles[i]))) u.arrow = true;
    cur = slide(cur, d)!;
  }
  return u;
}

/** A fresh ice maze for an element: bigger, longer and richer as z grows. */
export function newSlideStop(z: number, seed: number): SlideStopState {
  const rng = seeded(seed);
  const plan = slideStopPlan(z);
  const { size } = plan;
  const n = size * size;
  let fallback: SlideStopState | null = null;
  let fallbackScore = -1;
  for (let attempt = 0; attempt < 400; attempt++) {
    const density = 0.1 + rand(rng) * 0.08;
    const tiles: Tile[] = Array.from({ length: n }, () => (rand(rng) < density ? '#' : '.'));
    let free = shuffleFree(rng, tiles);
    const need = plan.sticky + plan.cracks + plan.arrows + plan.sparks + 3;
    if (free.length < need + 6) continue;
    for (let k = 0; k < plan.sticky; k++) tiles[free.pop()!] = '~';
    for (let k = 0; k < plan.cracks; k++) tiles[free.pop()!] = '%';
    for (let k = 0; k < plan.arrows; k++) tiles[free.pop()!] = pick(rng, ['^', 'v', '<', '>'] as Tile[]);
    free = shuffleFree(rng, tiles);
    const start = free.pop()!;
    const sparks = free.splice(0, plan.sparks).sort((a, b) => a - b);
    const base: SlideStopState = { size, tiles, sparks, got: 0, broken: 0, start, goal: start, pos: start, moves: 0, par: 0 };
    const sr = search(base);
    // The goal: a plain cell whose shortest win is as long as the range allows.
    let goal = -1, goalCode = -1, goalDist = -1;
    for (const c of free) {
      if (sparks.includes(c)) continue;
      const w = bestWin({ ...base, goal: c }, sr, c);
      if (w < 0) continue;
      const d = sr.dist[w];
      if (d > plan.maxPar) continue;
      if (d > goalDist || (d === goalDist && rand(rng) < 0.5)) { goal = c; goalCode = w; goalDist = d; }
    }
    if (goal < 0 || goalDist < Math.max(2, plan.minPar - 2)) continue;
    const level: SlideStopState = { ...base, goal, par: goalDist };
    const u = uses(level, pathTo(sr, goalCode));
    const misses = (plan.sticky && !u.sticky ? 1 : 0) + (plan.cracks && !u.crack ? 1 : 0) + (plan.arrows && !u.arrow ? 1 : 0);
    if (goalDist >= plan.minPar && misses === 0) return level;
    // Keep the best near miss in case nothing better turns up.
    const score = (goalDist >= plan.minPar ? 100 : goalDist * 5) - misses * 30;
    if (score > fallbackScore) { fallback = level; fallbackScore = score; }
  }
  if (fallback) return fallback;
  // Every random field failed, which the tests guard against: a plain corridor.
  const tiles: Tile[] = Array(n).fill('.');
  tiles[1] = '#';
  tiles[size + size - 1] = '#';
  const s: SlideStopState = { size, tiles, sparks: [], got: 0, broken: 0, start: 0, goal: size + size - 2, pos: 0, moves: 0, par: 0 };
  return { ...s, par: solve(s)?.length ?? 3 };
}
