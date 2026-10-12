// Merge: gather the nucleons for a nucleus.
//
// A 4x4 board of nucleon clusters. Swiping slides every tile; two clusters of
// the same size that meet merge into one twice the size, as in 2048. The
// nucleus wants a fixed set of clusters (its mass number written in powers of
// two: carbon-12 is 8 + 4), largest first. The moment a cluster of the wanted
// size exists it flies off the board into the nucleus. Fill every socket to win.
// A cluster bigger than anything still wanted is spoiled: it cracks and crumbles
// away on the next swipe.
//
// Heavier nuclei take their difficulty from the board, not from fake numbers:
// the clusters keep their true sizes, the climb from the smallest dealt cluster
// to the biggest socket grows with the period, and from period 5 on tungsten
// blocks of the reactor's armor sit on the board, cells that never move and that tiles stop
// against. Every deal is played through by a greedy player before it is dealt:
// the walls go only where that player still wins, its line is the hint's plan,
// and its swipe count sets par. A board with no swipe left is lost.
//
// Capture mode (Puzzles only) builds one cluster of exactly the mass number:
// equal clusters still double, and a lone neutron that meets a cluster of 8 or
// more is captured by it, adding one, as in the slow neutron capture that
// builds the heavy elements in old stars.
//
// Game rule, not physics: real nuclei are not built by pairing up clusters;
// the clusters are only a way to count nucleons.

import { randInt, seeded, weighted, type Rng } from './rng';

export interface Nucleus {
  z: number;
  a: number;
}

export interface Tile {
  id: number;
  /** Nucleons in the cluster: 1, 2, 4, 8, ... (any count in capture mode). */
  v: number;
  spoiled: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Sockets: the mass number in powers of two. Capture: one cluster of exactly the mass number. */
export type MergeMode = 'sockets' | 'capture';

/** Where a tile went in the last move, for animation. */
export interface Journey {
  id: number;
  from: number;
  to: number;
  /** The id of the tile it merged into, when it did. */
  into?: number;
}

/** A line of play the greedy player won the deal with: each swipe, and a fingerprint of the board
 *  it was made on, so the hint follows it only while the player is still on that very board. */
export interface Plan {
  dirs: Dir[];
  sigs: number[];
}

export interface MergeState {
  size: number;
  mode: MergeMode;
  cells: (Tile | null)[];
  /** Cells taken by a tungsten block of the reactor's armor: nothing moves into them, tiles stop against them. */
  walls: number[];
  target: Nucleus;
  /** Cluster sizes the nucleus wants, largest first (capture: just the mass number). */
  sockets: number[];
  /** How many sockets are filled, in order. */
  filled: number;
  moves: number;
  spoils: number;
  par: number;
  /** What the board deals after each swipe. */
  mix: Mix;
  /** The smallest cluster dealt (capture: the seed cluster's size). */
  unit: number;
  nextId: number;
  rng: Rng;
  plan: Plan | null;
  last: Journey[];
  /** Ids of tiles spawned by the last move. */
  spawned: number[];
  /** Tiles that flew into the nucleus on the last move, with the cell they left. */
  flown: { tile: Tile; from: number }[];
}

export interface Mix {
  kinds: number[];
  weights: number[];
}

/** How a nucleus's board is shaped: `climb` caps the mass number over the smallest dealt cluster
 *  (so the biggest socket is at most that many of them), `walls` is how many tungsten blocks it has,
 *  and `budget` says par is measured from the greedy player (else the old nucleon formula). */
export interface MergeShape {
  climb: number;
  walls: number;
  /** How many of the blocks sit in the middle four cells (the rest sit mid-edge). */
  inner: number;
  budget: boolean;
}

/** The board for an element, by period: periods 1 to 3 as they always were; periods 4 and 5 climb
 *  to 64 and period 5 adds a tungsten block; periods 6 and 7 climb to 128 with one block; the last row
 *  from radium on has two blocks on a climb of 64 (two blocks on 128 are too much for anyone). */
export function mergeShape(z: number): MergeShape {
  if (z <= 18) return { climb: 32, walls: 0, inner: 0, budget: false };
  if (z <= 36) return { climb: 64, walls: 0, inner: 0, budget: true };
  if (z <= 54) return { climb: 64, walls: 1, inner: 1, budget: true };
  if (z <= 86) return { climb: 128, walls: 1, inner: 1, budget: true };
  return { climb: 128, walls: 2, inner: 0, budget: true };
}

/** The mass number as powers of two, largest first. */
export function socketsFor(a: number): number[] {
  const out: number[] = [];
  for (let b = 1 << 30; b >= 1; b >>= 1) if (a & b) out.push(b);
  return out;
}

/** The cluster size the nucleus wants next, or null when it is complete. */
export function wanted(s: MergeState): number | null {
  return s.filled < s.sockets.length ? s.sockets[s.filled] : null;
}

/** The smallest cluster the board deals for a nucleus of mass number a: single nucleons while a is
 *  at most `climb`, and past it the power of two that keeps a / unit within it. Every cluster
 *  still shows its real nucleon count. */
export function clusterUnit(a: number, climb = 32): number {
  const top = socketsFor(a)[0] ?? 1;
  let u = 1;
  while (top / u > climb) u *= 2;
  return u;
}

/** What the board deals out: mostly single nucleons, some pairs, a few fours for big nuclei.
 *  Past the climb the same mix is dealt in bigger clusters (see clusterUnit). */
export function spawnMix(target: Nucleus, climb = 32): Mix {
  const u = clusterUnit(target.a, climb);
  if (u > 1) return { kinds: [u, 2 * u, 4 * u], weights: [6, 3, 2] };
  const kinds = [1, 2];
  const weights = [6, 3];
  if (target.a >= 16) {
    kinds.push(4);
    weights.push(target.a >= 40 ? 2 : 1);
  }
  return { kinds, weights };
}

/** The first-guess par of the light nuclei (periods 1 to 3): 0.7 swipes per nucleon. */
export function mergePar(a: number): number {
  return Math.ceil(a * 0.7) + 1;
}

/** Par as a budget: the greedy player's swipes, plus room for a player who can't see the deals
 *  coming as it can. */
export function budgetPar(greedy: number): number {
  return Math.ceil(greedy * PAR_SLACK) + PAR_PAD;
}
const PAR_SLACK = 1.3;
const PAR_PAD = 4;

/** Wall layouts tried per deal before the board gives up a block. */
const WALL_TRIES = 10;
/** The greedy player's swipe limit when vetting a deal (capture boards are short or lost). */
const VET_LIMIT = 700;
const CAPTURE_LIMIT = 200;

/** Cells a tungsten block may take: one of the middle four, which cuts a row and a column at once, or
 *  the middle of an edge row or column, which cuts only one. Never a corner, which changes little. */
const INNER_CELLS = [5, 6, 9, 10];
const EDGE_CELLS = [1, 2, 4, 7, 8, 11, 13, 14];

/** Wall layouts for a deal, from their own generator so the tiles dealt stay those of the seed:
 *  `walls` blocks, the first `inner` of them in the middle four. Two blocks never share a row or
 *  a column, so no line is cut twice. */
export function wallLayouts(seed: number, walls: number, inner = 0): number[][] {
  const rng = seeded((seed * 2654435761 + walls * 97 + inner * 7 + 13) >>> 0);
  const out: number[][] = [];
  const seen = new Set<string>();
  for (let guard = 0; out.length < WALL_TRIES && guard < 400; guard++) {
    const pick: number[] = [];
    for (let k = 0; k < walls; k++) {
      const cells = k < inner ? INNER_CELLS : EDGE_CELLS;
      const free = cells.filter((c) => pick.every((p) => p % 4 !== c % 4 && Math.floor(p / 4) !== Math.floor(c / 4)));
      if (!free.length) break;
      pick.push(free[randInt(rng, free.length)]);
    }
    if (pick.length < walls) continue;
    pick.sort((a, b) => a - b);
    const key = pick.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

/** A fresh board with no plan yet: the walls in place, then three clusters dealt. */
export function dealMerge(target: Nucleus, seed: number, opts: { mode?: MergeMode; walls?: number[]; mix: Mix; unit: number; par?: number }): MergeState {
  const size = 4;
  const mode = opts.mode ?? 'sockets';
  const s: MergeState = {
    size, mode, cells: Array(size * size).fill(null), walls: opts.walls ?? [], target,
    sockets: mode === 'capture' ? [target.a] : socketsFor(target.a), filled: 0,
    moves: 0, spoils: 0, par: opts.par ?? 0, mix: opts.mix, unit: opts.unit, nextId: 1, rng: seeded(seed), plan: null,
    last: [], spawned: [], flown: [],
  };
  for (let i = 0; i < 3; i++) spawn(s);
  s.spawned = [];
  return s;
}

/** Plays the greedy player on a fresh board; when it wins, the board keeps its line as the plan and
 *  par becomes a budget on it (when the shape asks for one). */
function vet(s: MergeState, budget: boolean): boolean {
  const run = greedyRun(s, 2, s.mode === 'capture' ? CAPTURE_LIMIT : VET_LIMIT);
  if (!run.won) return false;
  s.plan = run.plan;
  if (budget) s.par = budgetPar(run.plan.dirs.length);
  return true;
}

export function newMerge(target: Nucleus, seed: number, shape: MergeShape = mergeShape(target.z)): MergeState {
  const mix = spawnMix(target, shape.climb);
  const unit = clusterUnit(target.a, shape.climb);
  const par = mergePar(target.a);
  for (let walls = shape.walls; walls > 0; walls--) {
    for (const layout of wallLayouts(seed, walls, Math.min(walls, shape.inner))) {
      const s = dealMerge(target, seed, { walls: layout, mix, unit, par });
      if (vet(s, shape.budget)) return s;
    }
  }
  const s = dealMerge(target, seed, { mix, unit, par });
  if (!vet(s, shape.budget) && shape.budget) s.par = budgetPar(Math.ceil((0.8 * target.a) / unit));
  return s;
}

// ---- capture mode ----------------------------------------------------------------

/** A capture board's numbers: the seed cluster it deals, how many doublings take it toward the
 *  mass number, and the neutrons still to capture at the end. */
export interface CaptureShape {
  seed: number;
  levels: number;
  neutrons: number;
}

/** The seed is the mass number halved `levels` times, rounded down, and the rest is captured one
 *  neutron at a time. Four doublings from tin's 120 on when that leaves at most four neutrons to
 *  capture, else three when that leaves at most six; seven neutrons proved too many to steer, so
 *  those nuclei take two doublings and three neutrons. */
export function captureShape(a: number): CaptureShape {
  const levels = a >= 120 && a % 16 <= 4 ? 4 : a % 8 <= 6 ? 3 : 2;
  const seed = Math.floor(a / 2 ** levels);
  return { seed, levels, neutrons: a - seed * 2 ** levels };
}

/** Capture deals: seed clusters, some double seeds, and lone neutrons. */
export function captureMix(a: number): Mix {
  const c = captureShape(a);
  return { kinds: [1, c.seed, 2 * c.seed], weights: [2, 6, 2] };
}

/** A capture board: the first of a few deals from the seed that the greedy player wins. */
export function newCapture(target: Nucleus, seed: number): MergeState {
  const c = captureShape(target.a);
  const deal = (k: number) => dealMerge(target, (seed + k * 1000003) >>> 0, { mode: 'capture', mix: captureMix(target.a), unit: c.seed });
  for (let k = 0; k < CAPTURE_TRIES; k++) {
    const s = deal(k);
    if (vet(s, true)) return s;
  }
  const s = deal(0);
  s.par = budgetPar(Math.ceil(target.a / c.seed) * 2);
  return s;
}
const CAPTURE_TRIES = 12;

/** Two clusters that meet: what they make, or 0 when they don't join. Equal clusters double (two
 *  lone neutrons never bind, in capture mode); in capture mode a lone neutron and a cluster of 8 or
 *  more join into one bigger by one. */
export function joined(mode: MergeMode, a: number, b: number): number {
  if (a === b) return mode === 'capture' && a === 1 ? 0 : 2 * a;
  if (mode === 'capture' && Math.min(a, b) === 1 && Math.max(a, b) >= CAPTURE_MIN) return a + b;
  return 0;
}
/** The smallest cluster that captures a neutron. */
export const CAPTURE_MIN = 8;

export function cloneMerge(s: MergeState): MergeState {
  return { ...s, cells: s.cells.map((t) => (t ? { ...t } : null)), rng: { ...s.rng }, last: [], spawned: [], flown: [] };
}

function spawn(s: MergeState): void {
  const wall = s.walls;
  const empty: number[] = [];
  for (let i = 0; i < s.cells.length; i++) if (!s.cells[i] && !wall.includes(i)) empty.push(i);
  if (!empty.length) return;
  const at = empty[randInt(s.rng, empty.length)];
  const mix = s.mix;
  let v = mix.kinds[weighted(s.rng, mix.weights)];
  // Never deal a cluster already too big to be wanted. Light nuclei fall back to a single
  // nucleon; past the climb, to the biggest cluster that still fits, down to the singles and pairs
  // a heavy nucleus's low bits ask for.
  const want = wanted(s);
  if (s.mode === 'sockets' && want !== null && v > want) {
    const fits = mix.kinds.filter((k) => k <= want);
    v = s.unit === 1 ? 1 : fits.length ? fits[fits.length - 1] : want >= 2 && weighted(s.rng, [6, 3]) === 1 ? 2 : 1;
  }
  const tile: Tile = { id: s.nextId++, v, spoiled: false };
  s.cells[at] = tile;
  s.spawned.push(tile.id);
}

/** The cell indices of each line, listed from the edge the tiles slide toward. */
function lines(size: number, dir: Dir): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < size; k++) {
    const line: number[] = [];
    for (let i = 0; i < size; i++) {
      switch (dir) {
        case 'left': line.push(k * size + i); break;
        case 'right': line.push(k * size + (size - 1 - i)); break;
        case 'up': line.push(i * size + k); break;
        case 'down': line.push((size - 1 - i) * size + k); break;
      }
    }
    out.push(line);
  }
  return out;
}

const runCache = new Map<string, number[][]>();

/** The stretches tiles slide along: each line, cut at the tungsten blocks on it. */
function runs(size: number, dir: Dir, walls: number[]): number[][] {
  const key = `${size}|${dir}|${walls.join(',')}`;
  let out = runCache.get(key);
  if (out) return out;
  out = [];
  for (const line of lines(size, dir)) {
    let run: number[] = [];
    for (const i of line) {
      if (walls.includes(i)) { if (run.length) out.push(run); run = []; } else run.push(i);
    }
    if (run.length) out.push(run);
  }
  runCache.set(key, out);
  return out;
}

/** Any tile of the wanted size leaves the board for the nucleus; repeats while sockets keep matching. */
function collect(s: MergeState): void {
  for (;;) {
    const want = wanted(s);
    if (want === null) return;
    const i = s.cells.findIndex((t) => t && !t.spoiled && t.v === want);
    if (i < 0) return;
    s.flown.push({ tile: s.cells[i]!, from: i });
    s.cells[i] = null;
    s.filled++;
  }
}

/**
 * Slides every tile in one direction. Returns the new state, or null when nothing
 * would move (a swipe into a wall is not a move). Spoiled tiles crumble first.
 */
export function slide(s: MergeState, dir: Dir): MergeState | null {
  const next = cloneMerge(s);
  const before = s.cells.map((t) => (t ? `${t.id}` : '.')).join(',');
  for (let i = 0; i < next.cells.length; i++) if (next.cells[i]?.spoiled) next.cells[i] = null;
  const journeys: Journey[] = [];
  const want = wanted(s);
  for (const line of runs(s.size, dir, s.walls)) {
    const out: { tile: Tile; merged: boolean; at: number }[] = [];
    for (const idx of line) {
      const tile = next.cells[idx];
      if (!tile) continue;
      const prev = out[out.length - 1];
      const v = prev && !prev.merged ? joined(s.mode, prev.tile.v, tile.v) : 0;
      if (v) {
        const made: Tile = { id: next.nextId++, v, spoiled: want !== null && v > want };
        if (made.spoiled) next.spoils++;
        journeys.push({ id: tile.id, from: idx, to: line[out.length - 1], into: made.id });
        journeys.push({ id: prev.tile.id, from: prev.at, to: line[out.length - 1], into: made.id });
        out[out.length - 1] = { tile: made, merged: true, at: line[out.length - 1] };
      } else {
        journeys.push({ id: tile.id, from: idx, to: line[out.length] });
        out.push({ tile, merged: false, at: idx });
      }
    }
    for (let i = 0; i < line.length; i++) next.cells[line[i]] = i < out.length ? out[i].tile : null;
  }
  const after = next.cells.map((t) => (t ? `${t.id}` : '.')).join(',');
  if (before === after) return null;
  next.moves = s.moves + 1;
  next.last = journeys;
  collect(next);
  if (!won(next)) {
    spawn(next);
    collect(next);
  }
  return next;
}

export function won(s: MergeState): boolean {
  return s.filled >= s.sockets.length;
}

/** No swipe would change the board: the nucleus is lost (undo still steps back). */
export function jammed(s: MergeState): boolean {
  return !won(s) && (['up', 'down', 'left', 'right'] as Dir[]).every((d) => slide(s, d) === null);
}

/** The biggest cluster still able to become the capture target, or 0. */
export function biggest(s: MergeState): number {
  let b = 0;
  for (const t of s.cells) if (t && !t.spoiled && t.v > b) b = t.v;
  return b;
}

// ---- the hint's look-ahead ------------------------------------------------------
//
// The board deals from its own seeded generator, so every swipe's outcome, new
// nucleon and all, is known in advance. The hint follows the plan the deal was
// vetted with while the player is on it; off it, it tries every line of play a
// few swipes deep and scores where each ends up; a line that jams is worth nothing.

const DIRS: Dir[] = ['left', 'up', 'right', 'down'];
/** Swipes the hint looks ahead when choosing one: 4^4 boards at most, a few milliseconds. */
const LOOK = 4;
/** Swipes some line of play must last for the nucleus to count as still in reach. */
const SURVIVE = 6;
const WIN = 1e9;

/** A fingerprint of a board and of what it will deal next. */
export function boardSig(s: MergeState): number {
  let h = (s.rng.s ^ Math.imul(s.filled + 1, 0x9e3779b1)) >>> 0;
  for (const t of s.cells) h = Math.imul(h ^ (t ? t.v * 2 + (t.spoiled ? 1 : 0) : 0x7fff), 16777619) >>> 0;
  return h;
}

/**
 * How promising a board is: each filled socket outweighs everything else; then clusters
 * that still fit the wanted size, bigger ones worth more (two halves are worth half a
 * whole); then empty cells. Clusters too big to be wanted again only take up room, and
 * every crack costs, since cracks spoil a flawless build.
 */
function worth(s: MergeState): number {
  const want = wanted(s);
  if (want === null) return WIN;
  if (s.mode === 'capture') return captureWorth(s, want);
  let v = s.filled * 1e6 - s.spoils * 2000;
  for (const t of s.cells) {
    if (!t || t.spoiled) v += 40;
    else if (t.v > want) v -= 600;
    else v += (t.v / want) ** 2 * 1000;
  }
  return v;
}

/** Neutrons a cluster of v still needs on its way to the target a if it only doubles from here:
 *  doubling as far as fits, the rest captured. A cluster that took a stray neutron early needs
 *  far more, which is how the look-ahead learns to keep twins equal. */
export function captureNeed(v: number, a: number): number {
  let top = v;
  while (top * 2 <= a) top *= 2;
  return a - top;
}

function captureWorth(s: MergeState, a: number): number {
  let v = -s.spoils * 2000;
  // A cluster over half the target can never double again: only one of those can become the
  // target by capturing, and any other is clutter.
  let top = -Infinity;
  let tops = 0;
  for (const t of s.cells) {
    if (!t || t.spoiled) { v += 40; continue; }
    if (t.v === 1) { v -= 10; continue; }
    const q = (t.v / a) ** 2 * 1000 - (captureNeed(t.v, a) / a) * 1500;
    if (t.v * 2 <= a) v += q;
    else { top = Math.max(top, q); tops++; }
  }
  if (tops) v += top - (tops - 1) * 300;
  return v;
}

/** The best score any line of play reaches in `depth` more swipes; -Infinity when every line jams. */
function lookAhead(s: MergeState, depth: number): number {
  if (won(s)) return WIN + depth; // sooner is better
  if (depth === 0) return worth(s);
  let best = -Infinity;
  for (const d of DIRS) {
    const n = slide(s, d);
    if (n) best = Math.max(best, lookAhead(n, depth - 1));
  }
  return best;
}

/** Some line of play lasts `depth` swipes without jamming, or wins on the way. */
function survives(s: MergeState, depth: number): boolean {
  if (won(s) || depth === 0) return true;
  for (const d of DIRS) {
    const n = slide(s, d);
    if (n && survives(n, depth - 1)) return true;
  }
  return false;
}

/** The plan's next swipe, when the board is exactly the one the plan played it on. */
function planned(s: MergeState): Dir | null {
  const p = s.plan;
  if (!p || s.moves >= p.dirs.length || p.sigs[s.moves] !== boardSig(s)) return null;
  return p.dirs[s.moves];
}

/** The nucleus can still be finished: not won yet, and the plan still holds or some line of play
 *  outlasts the look-ahead. False means every line jams within a few swipes: a dead end. */
export function inReach(s: MergeState): boolean {
  return !won(s) && (planned(s) !== null || survives(s, SURVIVE));
}

/** Two clusters that join, by the cells they sit in, and the size they make. */
export interface MergePair {
  cells: [number, number];
  makes: number;
  /** A neutron captured, rather than two equal clusters doubled. */
  capture?: boolean;
}

/** The biggest join a swipe makes that still fits the wanted size (no crack), or null. */
export function mergeOf(s: MergeState, dir: Dir): MergePair | null {
  const n = slide(s, dir);
  const want = wanted(s);
  if (!n || want === null) return null;
  let best: MergePair | null = null;
  const into = new Map<number, number>();
  const made = new Map<number, number>();
  for (const t of n.cells) if (t) made.set(t.id, t.v);
  for (const f of n.flown) made.set(f.tile.id, f.tile.v);
  for (const j of n.last) {
    if (j.into === undefined) continue;
    const other = into.get(j.into);
    if (other === undefined) { into.set(j.into, j.from); continue; }
    const makes = made.get(j.into) ?? s.cells[j.from]!.v * 2;
    const capture = s.cells[j.from]!.v !== s.cells[other]!.v;
    if (makes <= want && (!best || makes > best.makes)) best = { cells: [other, j.from], makes, ...(capture ? { capture } : {}) };
  }
  return best;
}

/** The swipe that does the most for the nucleus over the next few swipes, or null on a won board
 *  or when every line of play jams within the look-ahead. */
export function bestSwipe(s: MergeState): Dir | null {
  if (won(s)) return null;
  const p = planned(s);
  if (p) return p;
  return greedyStep(s, LOOK);
}

/** The swipe whose best line `look` swipes deep scores highest (null when every swipe jams). */
function greedyStep(s: MergeState, look: number): Dir | null {
  let best: Dir | null = null;
  let score = -Infinity;
  for (const d of DIRS) {
    const n = slide(s, d);
    if (!n) continue;
    const v = lookAhead(n, look - 1);
    if (v > score) { score = v; best = d; }
  }
  return best;
}

/** Plays a board out with the look-ahead player, `look` swipes deep, up to `limit` swipes. */
export function greedyRun(s0: MergeState, look = 2, limit = VET_LIMIT): { won: boolean; plan: Plan } {
  let s = s0;
  const plan: Plan = { dirs: [], sigs: [] };
  while (!won(s) && plan.dirs.length < limit) {
    const d = greedyStep(s, look);
    if (!d) break;
    plan.sigs.push(boardSig(s));
    plan.dirs.push(d);
    s = slide(s, d)!;
  }
  return { won: won(s), plan };
}

/** Two equal clusters that could merge toward the wanted size, the biggest first: a pair that
 *  meets on some swipe (nothing between them on a row or column) before any other pair. In
 *  capture mode a neutron and a cluster that can capture it count too. */
export function closestPair(s: MergeState): { cells: [number, number]; makes: number; lined: boolean; capture?: boolean } | null {
  const want = wanted(s);
  if (want === null) return null;
  let best: { cells: [number, number]; makes: number; lined: boolean; capture?: boolean } | null = null;
  const n = s.size;
  for (let a = 0; a < s.cells.length; a++) {
    for (let b = a + 1; b < s.cells.length; b++) {
      const ta = s.cells[a], tb = s.cells[b];
      if (!ta || !tb || ta.spoiled || tb.spoiled) continue;
      const makes = joined(s.mode, ta.v, tb.v);
      if (!makes || makes > want) continue;
      // A capture only helps when the cluster's twin plan survives it.
      const capture = ta.v !== tb.v;
      if (capture && captureNeed(makes, want) > captureNeed(Math.max(ta.v, tb.v), want)) continue;
      const row = Math.floor(a / n) === Math.floor(b / n), col = a % n === b % n;
      const step = row ? 1 : n;
      let lined = row || col;
      for (let i = a + step; lined && i < b; i += step) if (s.cells[i] || s.walls.includes(i)) lined = false;
      const better = !best || (lined && !best.lined) || (lined === best.lined && makes > best.makes);
      if (better) best = { cells: [a, b], makes, lined, ...(capture ? { capture } : {}) };
    }
  }
  return best;
}
