// Slide Until Stop: a lattice maze. The electron slides in the chosen
// direction until a nucleus or the edge stops it. Stop exactly on the goal
// ring to win; passing over the goal does not count.
//
// Heavier elements add, one at a time (model name, then the name players see):
//   sparks   [photons] the electron must pass over (or stop on) every one
//            before the ring counts;
//   sticky   [potential wells] cells the electron stops on as soon as it enters;
//   cracks   [unstable nuclei] cells that decay into a blocker once the
//            electron has left them;
//   arrows   [drift arrows] one-way cells, entered only while moving the way
//            they point (leaving is free).
// Rocks ('#') are shown as fixed nuclei. The code keeps its original names so
// the tests and deals are untouched.
//
// How a level is built (see `newSlideStop`). The old way, a random scatter
// kept if solvable, left about two rocks in three and half the special tiles
// doing nothing: take one away and par stayed the same. Now every tile has a
// job:
//   1. Seed: a sparse random field with the element's special tiles, a start
//      and the photons.
//   2. Climb: 40 to 160 small edits (add, remove or move a rock; move a special
//      tile, a photon or the start), each kept when it does not lower the
//      score. The ring always goes on the cell whose shortest win is longest
//      within the element's par range. The score rewards that length, a route
//      that turns all four ways and stops inside the lattice rather than at
//      its edge, photons that force a detour, each kind of special tile
//      mattering, and wrong first slides; it charges for a naive win (always
//      sliding toward the nearest photon or the ring) and, a little, for
//      every tile.
//   3. Prune: each rock and special tile is tried as plain ice (a crack or an
//      arrow also as a rock). One whose loss changes neither par nor
//      solvability is taken away, one at a time, so every tile left is key.
//      Every kind of special tile must still matter as a whole: turning all
//      of that kind to ice changes par.
//   4. Decoys: a few rocks (1 to 3 by element) are then set as red herrings,
//      each the trial rock that adds the most reachable states, dead ends
//      and wrong first slides without touching par. A decoy is a rock that
//      par does not need but that changes where the first three slides can
//      stop.
//   5. Judge: the board is kept when par is in range, every kind matters,
//      the naive player loses, every special tile is key and every rock key
//      or one of the few decoys; else a fresh seed (up to 6), and the best
//      board seen if none passes.
// Breadth-first search over (cell, sparks collected, cracks broken) does all
// the checking; `analyzeSlideStop` and `tileRoles` give the tests the same
// measures. A deal takes about 15 ms on average.

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
  /** Per cell: 0 ice, 1 rock, 2 sticky, 3 crack, 4 + d an arrow pointing DIRS[d]. */
  kind: Int8Array;
  sparkBit: Int8Array;
  crackBit: Int8Array;
}

const KIND: Record<Tile, number> = { '.': 0, '#': 1, '~': 2, '%': 3, '^': 4, 'v': 5, '<': 6, '>': 7 };
const DX = DIRS.map((d) => DELTA[d][0]);
const DY = DIRS.map((d) => DELTA[d][1]);

function geoOf(s: Pick<SlideStopState, 'size' | 'tiles' | 'sparks'>): Geo {
  const n = s.size * s.size;
  const kind = new Int8Array(n);
  const sparkBit = new Int8Array(n).fill(-1);
  s.sparks.forEach((c, i) => { sparkBit[c] = i; });
  const crackBit = new Int8Array(n).fill(-1);
  let k = 0;
  s.tiles.forEach((t, i) => {
    kind[i] = KIND[t];
    if (t === '%') crackBit[i] = k++;
  });
  return { size: s.size, kind, sparkBit, crackBit };
}

/** What the last `runOn` collected and broke (its return value is where it stopped). */
let runGot = 0, runBroken = 0;

/** One slide in direction DIRS[d]; returns the cell it stops on and leaves `runGot` and `runBroken` set. */
function runOn(g: Geo, from: number, got: number, broken: number, d: number, path: number[] | null): number {
  const dx = DX[d], dy = DY[d];
  const { size, kind, crackBit, sparkBit } = g;
  let x = from % size, y = (from - x) / size;
  let cur = from;
  for (;;) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
    const ni = ny * size + nx;
    const t = kind[ni];
    if (t === 1) break;
    if (t === 3 && (broken >> crackBit[ni] & 1)) break;
    if (t >= 4 && t !== 4 + d) break;
    // Leaving a crack breaks it.
    if (crackBit[cur] >= 0) broken |= 1 << crackBit[cur];
    x = nx; y = ny; cur = ni;
    path?.push(ni);
    if (sparkBit[ni] >= 0) got |= 1 << sparkBit[ni];
    if (t === 2) break;
  }
  runGot = got;
  runBroken = broken;
  return cur;
}

/** Where a slide from the droplet's cell ends, what it collects and what it breaks. */
export function slideRun(s: SlideStopState, dir: Dir, from = s.pos): Run {
  const path: number[] = [];
  const end = runOn(geoOf(s), from, s.got, s.broken, DIRS.indexOf(dir), path);
  return { end, path, got: runGot, broken: runBroken };
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
  /** Visited state codes in the order reached (so by distance); the first `count` are filled. */
  order: Int32Array;
  count: number;
  /** With `links`: the state each slide leads to, four per state code (-1 when it goes nowhere). */
  next: Int32Array | null;
  states: number;
  sparkStates: number;
  n: number;
}

/** Where a search starts: a board and the electron's state on it. */
type Origin = Pick<SlideStopState, 'size' | 'tiles' | 'sparks' | 'pos' | 'got' | 'broken'>;

/** A level as the checks see it: the board, its photons, start and ring. */
type Board = Pick<SlideStopState, 'size' | 'tiles' | 'sparks' | 'start' | 'goal'>;

const fromStart = (b: Board): Origin => ({ size: b.size, tiles: b.tiles, sparks: b.sparks, pos: b.start, got: 0, broken: 0 });

/** Breadth-first search over (cell, sparks, cracks) from the given state. */
function search(s: Origin, links = false): Search {
  const g = geoOf(s);
  const n = s.size * s.size;
  const sparkStates = 1 << s.sparks.length;
  const states = n * sparkStates * (1 << cracksOf(s).length);
  // Only `dist` needs clearing: the others are read only for states the search reached, and set there.
  const dist = new Int16Array(states).fill(-1);
  const prev = new Int32Array(states);
  const via = new Int8Array(states);
  const next = links ? new Int32Array(states * 4) : null;
  const code = (p: number, got: number, br: number) => p + n * (got + sparkStates * br);
  const first = code(s.pos, s.got, s.broken);
  dist[first] = 0;
  prev[first] = -1;
  via[first] = -1;
  const queue = new Int32Array(states);
  let qn = 0;
  queue[qn++] = first;
  for (let qi = 0; qi < qn; qi++) {
    const c = queue[qi];
    const p = c % n, rest = (c - p) / n, got = rest % sparkStates, br = (rest - got) / sparkStates;
    for (let d = 0; d < 4; d++) {
      const e = runOn(g, p, got, br, d, null);
      const nc = e === p ? -1 : code(e, runGot, runBroken);
      if (next) next[c * 4 + d] = nc;
      if (nc < 0) continue;
      if (dist[nc] >= 0) continue;
      dist[nc] = dist[c] + 1;
      prev[nc] = c;
      via[nc] = d;
      queue[qn++] = nc;
    }
  }
  return { dist, prev, via, order: queue, count: qn, next, states, sparkStates, n };
}

function pathTo(sr: Search, target: number): Dir[] {
  const out: Dir[] = [];
  for (let c = target; sr.prev[c] >= 0; c = sr.prev[c]) out.push(DIRS[sr.via[c]]);
  return out.reverse();
}

/** The nearest winning state for a goal cell, as a state code, or -1. */
function bestWin(s: Pick<SlideStopState, 'size' | 'sparks'>, sr: Search, goal: number): number {
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

// ---- analysis -------------------------------------------------------------------

/** Fewest slides from the level's start to a win, or -1 when there is none. */
function parOf(b: Board): number {
  const sr = search(fromStart(b));
  const w = bestWin(b, sr, b.goal);
  return w < 0 ? -1 : sr.dist[w];
}

/** For every state the search reached, the fewest slides still needed to win (-1: none). Needs `links`. */
function winDistance(b: Board, sr: Search): Int16Array {
  const { n, states, order, count } = sr;
  const next = sr.next!;
  const all = allSparks(b);
  // Reverse the slide graph, then search back from every winning state.
  const head = new Int32Array(states).fill(-1);
  const link = new Int32Array(count * 4);
  const from = new Int32Array(count * 4);
  let e = 0;
  for (let i = 0; i < count; i++) {
    const c = order[i];
    for (let d = 0; d < 4; d++) {
      const t = next[c * 4 + d];
      if (t < 0) continue;
      from[e] = c;
      link[e] = head[t];
      head[t] = e++;
    }
  }
  const wd = new Int16Array(states).fill(-1);
  const queue = new Int32Array(count);
  let qn = 0;
  for (let i = 0; i < count; i++) {
    const c = order[i];
    const p = c % n;
    if (p === b.goal && ((c - p) / n) % sr.sparkStates === all) { wd[c] = 0; queue[qn++] = c; }
  }
  for (let qi = 0; qi < qn; qi++) {
    const t = queue[qi];
    for (let k = head[t]; k >= 0; k = link[k]) {
      const c = from[k];
      if (wd[c] >= 0) continue;
      wd[c] = wd[t] + 1;
      queue[qn++] = c;
    }
  }
  return wd;
}

/**
 * Whether a naive player wins: one who always takes the slide that stops
 * nearest (in grid steps) to the closest photon still out, or else the ring,
 * and never goes back to a state already seen.
 */
function greedyWins(b: Board, sr: Search, wd: Int16Array, limit: number): boolean {
  const { n, sparkStates } = sr;
  const next = sr.next!;
  const size = b.size;
  const steps = (a: number, c: number) => Math.abs((a % size) - (c % size)) + Math.abs(Math.floor(a / size) - Math.floor(c / size));
  const seen = new Set<number>();
  let c = sr.order[0];
  for (let k = 0; k <= limit; k++) {
    if (wd[c] === 0) return true;
    seen.add(c);
    const p = c % n, got = ((c - p) / n) % sparkStates;
    let target = b.goal, far = Infinity;
    b.sparks.forEach((sp, i) => {
      if (!(got >> i & 1) && steps(p, sp) < far) { far = steps(p, sp); target = sp; }
    });
    let best = -1, bd = Infinity;
    for (let d = 0; d < 4; d++) {
      const t = next[c * 4 + d];
      if (t < 0 || seen.has(t)) continue;
      const h = steps(t % n, target);
      if (h < bd) { bd = h; best = t; }
    }
    if (best < 0) return false;
    c = best;
  }
  return false;
}

export interface SlideStopReport {
  /** Fewest slides that win from the start; -1 when none does. */
  par: number;
  /** Distinct states (cell, photons absorbed, nuclei decayed) the electron can reach. */
  states: number;
  /** Reachable states from which no win is left: dead ends. */
  traps: number;
  /** First slides that do not begin a shortest win. */
  wrongFirst: number;
  /** Distinct directions on the solver's route. */
  dirs: number;
  /** A naive player, always sliding toward the nearest target, wins. */
  greedy: boolean;
  /** How many slides the photons add to the shortest win (0 without photons). */
  detour: number;
  /** Rocks and special tiles on the board. */
  tiles: number;
}

/** How a level plays: its par, how much there is to explore, and how easy it is to stumble on the win. */
export function analyzeSlideStop(s: Board): SlideStopReport {
  const sr = search(fromStart(s), true);
  const w = bestWin(s, sr, s.goal);
  const par = w < 0 ? -1 : sr.dist[w];
  const wd = winDistance(s, sr);
  let traps = 0;
  for (let i = 0; i < sr.count; i++) if (wd[sr.order[i]] < 0) traps++;
  let wrongFirst = 0;
  const first = sr.order[0];
  for (let d = 0; d < 4; d++) {
    const t = sr.next![first * 4 + d];
    if (t >= 0 && (wd[t] < 0 || wd[t] + 1 > par)) wrongFirst++;
  }
  const route = w < 0 ? [] : pathTo(sr, w);
  return {
    par,
    states: sr.count,
    traps,
    wrongFirst,
    dirs: new Set(route).size,
    greedy: par >= 0 && greedyWins(s, sr, wd, 2 * par + 4),
    detour: s.sparks.length && par >= 0 ? par - parOf({ ...s, sparks: [] }) : 0,
    tiles: s.tiles.filter((t) => t !== '.').length,
  };
}

/**
 * key: par or solvability changes without the tile (a crack or arrow is also
 * tried as a plain rock); decoy: par holds, but the cells the first few
 * slides can stop on change, so it sets a wrong turn; idle: neither.
 */
export type TileRole = 'key' | 'decoy' | 'idle';

/** How many opening slides a decoy has to shape. */
const EARLY = 3;

/** The cells the electron can rest on within `k` slides of the start, as a string of 0s and 1s. */
function earlyStops(b: Board, sr: Search, k: number): string {
  const seen = new Uint8Array(b.size * b.size);
  for (let i = 0; i < sr.count; i++) {
    const c = sr.order[i];
    if (sr.dist[c] > k) break;
    seen[c % sr.n] = 1;
  }
  return seen.join('');
}

function roleOf(b: Board, cell: number, par: number, early: string): TileRole {
  const t = b.tiles[cell];
  const tries: Tile[] = t === '%' || ARROWS.has(t) ? ['.', '#'] : ['.'];
  let decoy = false;
  for (const r of tries) {
    const tiles = [...b.tiles];
    tiles[cell] = r;
    const alt = { ...b, tiles };
    const sr = search(fromStart(alt));
    const w = bestWin(alt, sr, alt.goal);
    if ((w < 0 ? -1 : sr.dist[w]) !== par) return 'key';
    if (r === '.' && earlyStops(alt, sr, EARLY) !== early) decoy = true;
  }
  return decoy ? 'decoy' : 'idle';
}

/** Every rock and special tile on the board, with its role. */
export function tileRoles(s: Board): { cell: number; tile: Tile; role: TileRole }[] {
  const sr = search(fromStart(s));
  const w = bestWin(s, sr, s.goal);
  const par = w < 0 ? -1 : sr.dist[w];
  const early = earlyStops(s, sr, EARLY);
  const out: { cell: number; tile: Tile; role: TileRole }[] = [];
  s.tiles.forEach((t, i) => { if (t !== '.') out.push({ cell: i, tile: t, role: roleOf(s, i, par, early) }); });
  return out;
}

// ---- generation -----------------------------------------------------------------

export interface SlideStopPlan {
  size: number;
  sparks: number;
  /** The special tiles are at most this many; pruning keeps only the ones that matter, at least one of each. */
  sticky: number;
  cracks: number;
  arrows: number;
  minPar: number;
  maxPar: number;
  /** Rocks the board may keep only as decoys (see TileRole). */
  decoys: number;
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
    decoys: z >= 55 ? 3 : z >= 11 ? 2 : 1,
  };
}

const SPECIAL_KINDS: { key: 'sticky' | 'cracks' | 'arrows'; is: (t: Tile) => boolean }[] = [
  { key: 'sticky', is: (t) => t === '~' },
  { key: 'cracks', is: (t) => t === '%' },
  { key: 'arrows', is: (t) => ARROWS.has(t) },
];

/**
 * How many of the plan's kinds of special tile fail to matter: missing from
 * the board, or taking every one of that kind away leaves par as it is.
 */
function idleKinds(b: Board, plan: SlideStopPlan, par: number): number {
  let idle = 0;
  for (const k of SPECIAL_KINDS) {
    if (!plan[k.key]) continue;
    if (!b.tiles.some(k.is) || parOf({ ...b, tiles: b.tiles.map((t) => (k.is(t) ? '.' : t)) }) === par) idle++;
  }
  return idle;
}

/** Every kind of special tile matters as a whole, and the photons force a detour. */
function kindsMatter(b: Board, plan: SlideStopPlan, par: number): boolean {
  return idleKinds(b, plan, par) === 0 && (!plan.sparks || parOf({ ...b, sparks: [] }) !== par);
}

function shuffleFree(rng: Rng, tiles: Tile[]): number[] {
  const free = tiles.map((t, i) => (t === '.' ? i : -1)).filter((i) => i >= 0);
  return shuffle(rng, free);
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * What a route leans on: whether it stops on a sticky cell, breaks a crack and
 * passes an arrow, and how many of its slides stop inside the lattice (on a
 * well, or against a nucleus or an arrow) rather than at the edge.
 */
function uses(b: Board, route: Dir[]): { sticky: boolean; crack: boolean; arrow: boolean; inner: number } {
  const u = { sticky: false, crack: false, arrow: false, inner: 0 };
  const g = geoOf(b);
  const size = b.size;
  let pos = b.start, got = 0, broken = 0;
  const path: number[] = [];
  for (const d of route) {
    path.length = 0;
    const e = runOn(g, pos, got, broken, DIRS.indexOf(d), path);
    const g2 = runGot, b2 = runBroken;
    if (b.tiles[e] === '~') u.sticky = true;
    if (b2 !== broken) u.crack = true;
    if (path.some((i) => ARROWS.has(b.tiles[i]))) u.arrow = true;
    const x = (e % size) + DELTA[d][0], y = Math.floor(e / size) + DELTA[d][1];
    if (b.tiles[e] === '~' || (x >= 0 && y >= 0 && x < size && y < size)) u.inner++;
    pos = e; got = g2; broken = b2;
  }
  return u;
}

/** A board being built. `offset` is where the scan for the ring starts, so ties do not all go top-left. */
interface Draft extends Board {
  par: number;
  offset: number;
}

const levelOf = (d: Draft): SlideStopState => ({
  size: d.size, tiles: d.tiles, sparks: d.sparks, got: 0, broken: 0, start: d.start, goal: d.goal, pos: d.start, moves: 0, par: d.par,
});

/** A sparse random field: a few rocks, the plan's special tiles, a start and the photons. */
function seedField(rng: Rng, plan: SlideStopPlan): Draft {
  const { size } = plan;
  const n = size * size;
  const density = 0.06 + rand(rng) * 0.08;
  const tiles: Tile[] = Array.from({ length: n }, () => (rand(rng) < density ? '#' : '.'));
  let free = shuffleFree(rng, tiles);
  for (let k = 0; k < plan.sticky; k++) tiles[free.pop()!] = '~';
  for (let k = 0; k < plan.cracks; k++) tiles[free.pop()!] = '%';
  for (let k = 0; k < plan.arrows; k++) tiles[free.pop()!] = pick(rng, ['^', 'v', '<', '>'] as Tile[]);
  free = shuffleFree(rng, tiles);
  const start = free.pop()!;
  const sparks = free.splice(0, plan.sparks).sort((a, b) => a - b);
  return { size, tiles, sparks, start, goal: -1, par: -1, offset: randInt(rng, n) };
}

/** A ring placed on a draft: its par, the climb's score, and whether the board meets every requirement. */
interface Ringed { goal: number; par: number; score: number; good: boolean }

/** What the climb rewards; see `placeRing`. */
const W = { par: 10, short: 15, dir: 3, inner: 4, idleKind: 25, unused: 8, detour: 6, tile: 0.1, wrongFirst: 2, greedy: 12 };

/**
 * Puts the ring where the shortest win is longest within the plan's range and
 * scores the result for the climb: long, turning all four ways, stopping
 * inside the lattice rather than at its edge, leaning on every kind of special
 * tile, with photons that force a detour, wrong first slides and no win for a
 * naive player. Null when no cell in range can be won, or when the score
 * cannot reach `floor` (checked before each costlier step, to skip it).
 */
function placeRing(d: Draft, plan: SlideStopPlan, floor = -Infinity): Ringed | null {
  const n = d.size * d.size;
  const sr = search(fromStart(d), true);
  let goal = -1, goalCode = -1, par = -1;
  for (let k = 0; k < n; k++) {
    const c = (k + d.offset) % n;
    if (d.tiles[c] !== '.' || c === d.start || d.sparks.includes(c)) continue;
    const w = bestWin(d, sr, c);
    if (w < 0 || sr.dist[w] > plan.maxPar || sr.dist[w] <= par) continue;
    goal = c; goalCode = w; par = sr.dist[w];
  }
  if (goal < 0) return null;
  const route = pathTo(sr, goalCode);
  const ringed = { ...d, goal, par };
  const u = uses(ringed, route);
  const unused = (plan.sticky && !u.sticky ? 1 : 0) + (plan.cracks && !u.crack ? 1 : 0) + (plan.arrows && !u.arrow ? 1 : 0);
  const tiles = d.tiles.reduce((a, t) => a + (t === '.' ? 0 : 1), 0);
  let score = W.par * par - (par < plan.minPar ? W.short : 0) + W.dir * new Set(route).size + W.inner * u.inner
    - W.unused * unused - W.tile * tiles;
  const bonus = (s0: number) => s0 + W.detour + 2 * W.wrongFirst;
  if (bonus(score) < floor) return null;
  const detour = !plan.sparks || parOf({ ...ringed, sparks: [] }) !== par;
  if (detour) score += W.detour;
  if (score + 2 * W.wrongFirst < floor) return null;
  const idle = idleKinds(ringed, plan, par);
  score -= W.idleKind * idle;
  if (score + 2 * W.wrongFirst < floor) return null;
  // Wrong first slides, and whether a naive player stumbles on the win.
  const wd = winDistance(ringed, sr);
  const first = sr.order[0];
  let wrong = 0;
  for (let k = 0; k < 4; k++) {
    const t = sr.next![first * 4 + k];
    if (t >= 0 && (wd[t] < 0 || wd[t] + 1 > par)) wrong++;
  }
  const greedy = greedyWins(ringed, sr, wd, 2 * par + 4);
  score += W.wrongFirst * Math.min(wrong, 2) - (greedy ? W.greedy : 0);
  if (score < floor) return null;
  return { goal, par, score, good: par >= plan.minPar && detour && !idle && !greedy };
}

/** One small edit: add, remove or move a rock, move a special tile, a photon or the start. */
function mutate(rng: Rng, d: Draft): Draft {
  const tiles = [...d.tiles];
  const sparks = [...d.sparks];
  let start = d.start;
  const n = tiles.length;
  const plain = (c: number) => c >= 0 && c < n && tiles[c] === '.' && c !== start && !sparks.includes(c);
  const anyPlain = (): number => {
    for (let k = 0; k < 30; k++) { const c = randInt(rng, n); if (plain(c)) return c; }
    return -1;
  };
  const near = (c: number): number => {
    const [dx, dy] = DELTA[pick(rng, DIRS)];
    const x = (c % d.size) + dx, y = Math.floor(c / d.size) + dy;
    return x < 0 || y < 0 || x >= d.size || y >= d.size ? -1 : y * d.size + x;
  };
  const rocks: number[] = [], specials: number[] = [];
  tiles.forEach((t, i) => { if (t === '#') rocks.push(i); else if (t !== '.') specials.push(i); });
  const r = rand(rng);
  if (r < 0.3 || (r < 0.75 && !rocks.length)) {
    const c = anyPlain();
    if (c >= 0) tiles[c] = '#';
  } else if (r < 0.5) {
    tiles[pick(rng, rocks)] = '.';
  } else if (r < 0.75) {
    const from = pick(rng, rocks);
    const to = rand(rng) < 0.6 ? near(from) : anyPlain();
    if (plain(to)) { tiles[to] = '#'; tiles[from] = '.'; }
  } else if (r < 0.88 && specials.length) {
    const from = pick(rng, specials);
    const to = rand(rng) < 0.5 ? near(from) : anyPlain();
    if (plain(to)) {
      tiles[to] = ARROWS.has(tiles[from]) && rand(rng) < 0.3 ? pick(rng, ['^', 'v', '<', '>'] as Tile[]) : tiles[from];
      tiles[from] = '.';
    }
  } else if (r < 0.96 && sparks.length) {
    const to = anyPlain();
    if (to >= 0) { sparks[randInt(rng, sparks.length)] = to; sparks.sort((a, b) => a - b); }
  } else {
    const to = anyPlain();
    if (to >= 0) start = to;
  }
  return { ...d, tiles, sparks, start };
}

/**
 * Takes away every rock and special tile that is not key, one at a time (each
 * removal keeps par), leaving at most `plan.decoys` decoy rocks, and never
 * leaving a kind of special tile that no longer matters.
 */
function prune(rng: Rng, d: Draft, plan: SlideStopPlan): void {
  const guardKinds = kindsMatter(d, plan, d.par);
  const take = (c: number): boolean => {
    const t = d.tiles[c];
    d.tiles[c] = '.';
    if (!guardKinds || kindsMatter(d, plan, d.par)) return true;
    d.tiles[c] = t;
    return false;
  };
  for (let pass = 0; pass < 40; pass++) {
    const early = earlyStops(d, search(fromStart(d)), EARLY);
    const cells = shuffle(rng, d.tiles.map((t, i) => (t === '.' ? -1 : i)).filter((i) => i >= 0));
    let took = false;
    const decoys: number[] = [];
    for (const c of cells) {
      const role = roleOf(d, c, d.par, early);
      if (role === 'key') continue;
      if (role === 'decoy' && d.tiles[c] === '#') { decoys.push(c); continue; }
      // An idle tile leaves the opening stops as they were, so `early` still holds.
      if (take(c)) took = true;
    }
    if (took) continue;
    // Too many decoys: drop one (that changes the opening stops) and look again.
    if (decoys.length <= plan.decoys || !decoys.some((c) => take(c))) return;
  }
}

interface Judged { level: SlideStopState; score: number; ok: boolean }

/**
 * The final check and score of a pruned board. It is ok when par is in range,
 * every kind of tile matters, a naive player does not win, every special tile
 * is key and every rock key or one of the few decoys.
 */
function judge(d: Draft, plan: SlideStopPlan): Judged {
  const level = levelOf({ ...d, tiles: [...d.tiles] });
  const a = analyzeSlideStop(level);
  const roles = tileRoles(level);
  const loose = roles.filter((r) => r.role === 'idle' || (r.role === 'decoy' && r.tile !== '#')).length;
  const decoys = roles.filter((r) => r.role === 'decoy' && r.tile === '#').length;
  const valid = a.par === d.par && a.par >= plan.minPar && a.par <= plan.maxPar && kindsMatter(level, plan, a.par);
  const ok = valid && !a.greedy && !loose && decoys <= plan.decoys;
  const score = 10 * a.par + 3 * a.dirs + 2 * Math.min(a.wrongFirst, 2) + 0.5 * Math.min(a.traps, 6)
    - (a.greedy ? 10 : 0) - 5 * loose - 0.3 * a.tiles - (valid ? 0 : 1000);
  return { level, score, ok };
}

/** Rocks tried as each new decoy. */
const DECOY_TRIES = 12;

/**
 * Sets red herrings on a pruned board: up to the plan's decoy count, the rock
 * that adds the most to explore (states, dead ends, wrong first slides)
 * without touching par, kept only while the whole board still passes `judge`.
 */
function addDecoys(rng: Rng, d: Draft, plan: SlideStopPlan, built: Judged): Judged {
  let base = analyzeSlideStop(d);
  const gain = (a: SlideStopReport) => a.states - base.states + 2 * (a.traps - base.traps) + 3 * (a.wrongFirst - base.wrongFirst);
  for (let have = tileRoles(d).filter((r) => r.role === 'decoy').length; have < plan.decoys; have++) {
    const tries: [number, number][] = [];
    const free = shuffleFree(rng, d.tiles).filter((c) => c !== d.start && c !== d.goal && !d.sparks.includes(c));
    for (const c of free.slice(0, DECOY_TRIES)) {
      d.tiles[c] = '#';
      const a = analyzeSlideStop(d);
      d.tiles[c] = '.';
      if (a.par === d.par && !a.greedy && gain(a) > 0) tries.push([gain(a), c]);
    }
    tries.sort((x, y) => y[0] - x[0]);
    let placed = false;
    for (const [, c] of tries.slice(0, 3)) {
      d.tiles[c] = '#';
      const j = judge(d, plan);
      if (j.ok) { built = j; placed = true; break; }
      d.tiles[c] = '.';
    }
    if (!placed) break;
    base = analyzeSlideStop(d);
  }
  return built;
}

/** Fresh seeds tried per deal at most. */
const ROUNDS = 8;
/** Edits tried in each climb: at least the first, and on up to the second until the board meets every requirement. */
const CLIMB: [number, number] = [40, 160];

/** A fresh ice maze for an element: bigger, longer and richer as z grows. */
export function newSlideStop(z: number, seed: number): SlideStopState {
  const rng = seeded(seed);
  const plan = slideStopPlan(z);
  let best: Judged | null = null;
  for (let round = 0; round < ROUNDS && !best?.ok; round++) {
    let d = seedField(rng, plan);
    let at = placeRing(d, plan);
    for (let k = 0; k < CLIMB[1] && !(k >= CLIMB[0] && at?.good); k++) {
      const m = mutate(rng, d);
      const ms = placeRing(m, plan, at?.score);
      if (ms) { d = m; at = ms; }
    }
    if (!at) continue;
    d = { ...d, tiles: [...d.tiles], goal: at.goal, par: at.par };
    prune(rng, d, plan);
    let built = judge(d, plan);
    if (built.ok) built = addDecoys(rng, d, plan, built);
    if (!best || built.score > best.score) best = built;
  }
  if (best) return best.level;
  // Every field failed, which the tests guard against: a plain corridor.
  const { size } = plan;
  const tiles: Tile[] = Array(size * size).fill('.');
  tiles[1] = '#';
  tiles[size + size - 1] = '#';
  const s: SlideStopState = { size, tiles, sparks: [], got: 0, broken: 0, start: 0, goal: size + size - 2, pos: 0, moves: 0, par: 0 };
  return { ...s, par: solve(s)?.length ?? 3 };
}
