// Light Routing: a beam enters the grid from one edge and is steered by the
// pieces it meets. Tapping a turnable piece flips it between / and \.
//
//   / \      turnable mirrors: reflect the beam;
//   F/ F\    fixed mirrors: reflect, but cannot be turned;
//   H/ H\    splitters (half-silvered): the beam both passes and reflects;
//            turnable;
//   Cs..Cf   color filters: white light leaves tinted; light of the
//            filter's own color passes; any other color is absorbed;
//   #        blockers: stop the beam.
//
// Sensors sit on empty cells: target rings must be lit (a colored ring by
// light of its color), dark sensors must stay unlit.
//
// A level is built from a solved layout: trace the beams, pick sensors from
// what they light (and dark sensors from what a wrong turn would light), then
// flip some turnable pieces the beams use. Par is the number flipped, and the
// generator rejects a scramble that a smaller set of taps could undo.

import { rand, randInt, seeded, type Rng } from './rng';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Kind = 's' | 'p' | 'd' | 'f';
/** The beam's color: white, or one of the four tints. */
export type Hue = 'w' | Kind;
export type Cell = '.' | '#' | '/' | '\\' | 'F/' | 'F\\' | 'H/' | 'H\\' | 'Cs' | 'Cp' | 'Cd' | 'Cf';

export interface Target {
  cell: number;
  /** 'w' accepts any light; a tint needs light of that color. */
  hue: Hue;
}

export type Feature = 'fixed' | 'darks' | 'splitters' | 'filters';

export interface LightState {
  size: number;
  cells: Cell[];
  /** The cell the beam enters first (on an edge) and the way it travels. */
  entry: number;
  entryDir: Dir;
  targets: Target[];
  /** Sensors that must stay dark. */
  darks: number[];
  /** The layout the level was built from. */
  solution: Cell[];
  /** The extra piece kinds this level uses. */
  features: Feature[];
  moves: number;
  /** Fewest taps that solve it: the turnable pieces that differ from the solution. */
  par: number;
}

export const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const SLASH: Record<Dir, Dir> = { right: 'up', left: 'down', up: 'right', down: 'left' };
const BACKSLASH: Record<Dir, Dir> = { right: 'down', left: 'up', up: 'left', down: 'right' };

/** The slant of a mirror or splitter cell, or null for anything else. */
export function slant(c: Cell): '/' | '\\' | null {
  if (c === '/' || c === 'F/' || c === 'H/') return '/';
  if (c === '\\' || c === 'F\\' || c === 'H\\') return '\\';
  return null;
}

export const turnable = (c: Cell): boolean => c === '/' || c === '\\' || c === 'H/' || c === 'H\\';
export const isMirror = (c: Cell): boolean => c === '/' || c === '\\' || c === 'F/' || c === 'F\\';
export const isSplitter = (c: Cell): boolean => c === 'H/' || c === 'H\\';
export const filterHue = (c: Cell): Kind | null => (c[0] === 'C' ? (c[1] as Kind) : null);

export function reflect(cell: Cell, dir: Dir): Dir {
  const sl = slant(cell);
  return sl === '/' ? SLASH[dir] : sl === '\\' ? BACKSLASH[dir] : dir;
}

export function turned(c: Cell): Cell {
  switch (c) {
    case '/': return '\\';
    case '\\': return '/';
    case 'H/': return 'H\\';
    case 'H\\': return 'H/';
    default: return c;
  }
}

export function cloneLight(s: LightState): LightState {
  return { ...s, cells: [...s.cells], targets: s.targets.map((t) => ({ ...t })), darks: [...s.darks], solution: [...s.solution], features: [...s.features] };
}

/** One pass of light through one cell. */
export interface Visit {
  cell: number;
  /** The way the light travels as it enters. */
  dir: Dir;
  hue: Hue;
  /** Directions it leaves in (none when stopped). */
  outs: Dir[];
  /** Color it leaves with. */
  outHue: Hue;
  /** Where it stopped: at the cell's edge (a blocker), its center (absorbed by a filter), or not at all. */
  stop: 'edge' | 'center' | null;
  /** Of `outs`, those that leave the grid. */
  exits: Dir[];
  /** Steps from the lamp, for drawing the beam as it grows. */
  depth: number;
}

export interface Beam {
  visits: Visit[];
  /** Colors of light reaching each cell's center. */
  lit: Map<number, Set<Hue>>;
}

/**
 * Follows the light from the lamp through every split. Each (cell, direction,
 * color) is walked at most once, so loops through splitters and mirrors end.
 */
export function trace(s: LightState, cells: Cell[] = s.cells): Beam {
  const n = s.size;
  const visits: Visit[] = [];
  const lit = new Map<number, Set<Hue>>();
  const seen = new Set<string>();
  const queue: { x: number; y: number; dir: Dir; hue: Hue; depth: number }[] = [{ x: s.entry % n, y: Math.floor(s.entry / n), dir: s.entryDir, hue: 'w', depth: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const { x, y, dir, hue, depth } = queue[head];
    const i = y * n + x;
    const key = `${i}:${dir}:${hue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = cells[i];
    const v: Visit = { cell: i, dir, hue, outs: [], outHue: hue, stop: null, exits: [], depth };
    visits.push(v);
    if (c === '#') { v.stop = 'edge'; continue; }
    (lit.get(i) ?? lit.set(i, new Set()).get(i)!).add(hue);
    const f = filterHue(c);
    if (f) {
      if (hue !== 'w' && hue !== f) { v.stop = 'center'; continue; }
      v.outHue = f;
      v.outs = [dir];
    } else if (isSplitter(c)) v.outs = [dir, reflect(c, dir)];
    else v.outs = [reflect(c, dir)];
    for (const o of v.outs) {
      const nx = x + DELTA[o][0], ny = y + DELTA[o][1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) { v.exits.push(o); continue; }
      queue.push({ x: nx, y: ny, dir: o, hue: v.outHue, depth: depth + 1 });
    }
  }
  return { visits, lit };
}

export function targetLit(t: Target, lit: Map<number, Set<Hue>>): boolean {
  const hues = lit.get(t.cell);
  return !!hues && (t.hue === 'w' ? hues.size > 0 : hues.has(t.hue));
}

export interface Status {
  /** Targets lit with the light they need. */
  lit: number;
  total: number;
  /** Dark sensors the light reaches. */
  darkLit: number[];
  /** Targets reached only by light of the wrong color. */
  wrongHue: number[];
  won: boolean;
}

export function status(s: LightState, cells: Cell[] = s.cells): Status {
  const beam = trace(s, cells);
  const lit = s.targets.filter((t) => targetLit(t, beam.lit)).length;
  const darkLit = s.darks.filter((d) => beam.lit.has(d));
  const wrongHue = s.targets.filter((t) => beam.lit.has(t.cell) && !targetLit(t, beam.lit)).map((t) => t.cell);
  return { lit, total: s.targets.length, darkLit, wrongHue, won: lit === s.targets.length && !darkLit.length };
}

export function solved(s: LightState): boolean {
  return status(s).won;
}

/** Turns the piece at a cell; null when the cell holds nothing turnable. */
export function flip(s: LightState, i: number): LightState | null {
  if (!turnable(s.cells[i])) return null;
  const next = cloneLight(s);
  next.cells[i] = turned(s.cells[i]);
  next.moves += 1;
  return next;
}

/** Turnable pieces whose orientation differs from the generating solution. */
export function differing(s: LightState): number[] {
  return s.cells.map((c, i) => (turnable(c) && c !== s.solution[i] ? i : -1)).filter((i) => i >= 0);
}

/** The fewest taps that solve the layout, searching up to `limit` taps; null if none within it. */
export function fewestTaps(s: LightState, limit: number): number | null {
  const pieces = s.cells.map((c, i) => (turnable(c) ? i : -1)).filter((i) => i >= 0);
  const cells = [...s.cells];
  const search = (k: number, from: number): boolean => {
    if (k === 0) return status(s, cells).won;
    for (let a = from; a < pieces.length; a++) {
      const i = pieces[a];
      cells[i] = turned(cells[i]);
      const hit = search(k - 1, a + 1);
      cells[i] = turned(cells[i]);
      if (hit) return true;
    }
    return false;
  };
  for (let k = 0; k <= limit; k++) if (search(k, 0)) return k;
  return null;
}

// ---- generation ------------------------------------------------------------------

const clampZ = (z: number) => Math.min(118, Math.max(1, Math.round(z)));

/** The element at which each piece kind first appears. */
export const INTRO: Record<Feature, number> = { fixed: 11, darks: 26, splitters: 41, filters: 61 };

/** Which extra piece kinds a level uses: the newest for its band, plus older ones some of the time. */
export function featuresFor(z: number, rng: Rng): Feature[] {
  const t = clampZ(z);
  const order: Feature[] = ['fixed', 'darks', 'splitters', 'filters'];
  const unlocked = order.filter((f) => t >= INTRO[f]);
  if (!unlocked.length) return [];
  if (t >= 81) {
    // The full mix: two or three kinds.
    const pool = [...unlocked];
    const out: Feature[] = [];
    const want = rand(rng) < 0.5 ? 2 : 3;
    while (out.length < want) out.push(pool.splice(randInt(rng, pool.length), 1)[0]);
    return order.filter((f) => out.includes(f));
  }
  const newest = unlocked[unlocked.length - 1];
  return order.filter((f) => f === newest || (unlocked.includes(f) && rand(rng) < 0.45));
}

export function sizeFor(z: number): number {
  const t = clampZ(z);
  return t < 30 ? 5 : t < 80 ? 6 : 7;
}

function mixed<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newLight(z: number, seed: number): LightState {
  const rng = seeded(seed);
  const t = clampZ(z);
  const size = sizeFor(t);
  const n = size * size;
  const features = featuresFor(t, rng);
  const has = (f: Feature) => features.includes(f);
  const targetCount = t < 50 ? 2 : 3;
  const darkCount = has('darks') ? (t < 70 ? 1 : 2) : 0;
  const wantFlips = Math.min(4, 1 + Math.floor(t / 30));
  let fallback: LightState | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const cells: Cell[] = Array(n).fill('.');
    const slantOf = (): '/' | '\\' => (rand(rng) < 0.5 ? '/' : '\\');
    // The entry: a random edge cell, the beam heading inward.
    const side = randInt(rng, 4);
    const e = randInt(rng, size);
    const entry = side === 0 ? e : side === 1 ? (size - 1) * size + e : side === 2 ? e * size : e * size + size - 1;
    const entryDir: Dir = side === 0 ? 'down' : side === 1 ? 'up' : side === 2 ? 'right' : 'left';
    // The solution's main beam, walked out piece by piece: straight runs, then a turn.
    const roles: ('turn' | 'fixed' | 'split')[] = [];
    for (let k = wantFlips + randInt(rng, 2); k > 0; k--) roles.push('turn');
    if (has('fixed')) roles.push('fixed');
    if (has('splitters')) roles.push('split');
    const order = [roles[0], ...mixed(rng, roles.slice(1))];
    const onPath = new Set<number>([entry]);
    const runs: number[] = [entry];
    let x = entry % size, y = Math.floor(entry / size), dir = entryDir;
    for (const role of order) {
      const steps = 1 + randInt(rng, size - 1);
      let moved = 0;
      for (; moved < steps; moved++) {
        const nx = x + DELTA[dir][0], ny = y + DELTA[dir][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || onPath.has(ny * size + nx)) break;
        x = nx; y = ny;
        onPath.add(y * size + x);
        if (moved < steps - 1) runs.push(y * size + x);
      }
      if (!moved) break;
      const options = mixed(rng, [slantOf(), slantOf() === '/' ? '\\' : '/'] as ('/' | '\\')[]).filter((sl, k, all) => all.indexOf(sl) === k);
      const sl = options.find((o) => { const d = reflect(o, dir); const nx = x + DELTA[d][0], ny = y + DELTA[d][1]; return nx >= 0 && ny >= 0 && nx < size && ny < size && !onPath.has(ny * size + nx); });
      if (!sl) { runs.push(y * size + x); break; }
      cells[y * size + x] = role === 'turn' ? sl : role === 'fixed' ? (`F${sl}` as Cell) : (`H${sl}` as Cell);
      dir = reflect(sl, dir);
    }
    const hues = mixed(rng, ['s', 'p', 'd', 'f'] as Kind[]);
    if (has('filters')) {
      // One filter on the beam's own run, another (sometimes) elsewhere.
      const spots = runs.filter((i) => i !== entry && cells[i] === '.');
      if (!spots.length) continue;
      cells[spots[randInt(rng, spots.length)]] = `C${hues[0]}` as Cell;
    }
    // Scenery off the main run: decoy mirrors, more fixed pieces, blockers.
    const put = (c: Cell) => { for (let k = 0; k < 8; k++) { const i = randInt(rng, n); if (cells[i] === '.' && !onPath.has(i)) { cells[i] = c; return; } } };
    for (let k = Math.max(1, size - 3) + randInt(rng, 3); k > 0; k--) put(slantOf());
    if (has('fixed') && rand(rng) < 0.6) put(`F${slantOf()}` as Cell);
    if (has('splitters') && t >= 70 && rand(rng) < 0.4) put(`H${slantOf()}` as Cell);
    if (has('filters') && rand(rng) < 0.5) put(`C${hues[1]}` as Cell);
    for (let k = 1 + randInt(rng, 3); k > 0; k--) put('#');
    const base: LightState = { size, cells, entry, entryDir, targets: [], darks: [], solution: [...cells], features, moves: 0, par: 0 };
    const beam = trace(base);
    // Every planned piece kind should be in the beam's way, or it is only scenery.
    const touched = new Set(beam.visits.map((v) => v.cell));
    const used = [...touched].filter((i) => turnable(cells[i]));
    if (used.length < Math.max(2, wantFlips)) continue;
    if (has('fixed') && ![...touched].some((i) => cells[i][0] === 'F')) continue;
    if (has('splitters') && ![...touched].some((i) => isSplitter(cells[i]))) continue;
    if (has('filters') && ![...touched].some((i) => filterHue(cells[i]) && beam.visits.some((v) => v.cell === i && v.outs.length))) continue;

    // Targets: empty cells the light reaches after it has met a turnable piece, so a turn matters.
    const firstTurn = Math.min(...beam.visits.filter((v) => turnable(cells[v.cell])).map((v) => v.depth));
    const reached = new Map<number, Set<Hue>>();
    for (const v of beam.visits) if (v.depth > firstTurn && cells[v.cell] === '.' && !v.stop) (reached.get(v.cell) ?? reached.set(v.cell, new Set()).get(v.cell)!).add(v.hue);
    const pool = mixed(rng, [...reached.keys()]);
    if (pool.length < targetCount) continue;
    const tinted = pool.filter((i) => [...reached.get(i)!].some((h) => h !== 'w'));
    const targets: Target[] = [];
    if (has('filters')) {
      if (!tinted.length) continue;
      const want = Math.min(tinted.length, 1 + (t >= 90 ? randInt(rng, 2) : 0));
      for (const i of tinted.slice(0, want)) {
        const h = [...reached.get(i)!].filter((x) => x !== 'w');
        targets.push({ cell: i, hue: h[randInt(rng, h.length)] });
      }
    }
    for (const i of pool) {
      if (targets.length >= targetCount) break;
      if (!targets.some((x) => x.cell === i)) targets.push({ cell: i, hue: 'w' });
    }
    targets.sort((a, b) => a.cell - b.cell);

    // Scramble: turn pieces the light uses, so the puzzle needs the player's hand.
    const flips = Math.min(wantFlips, used.length);
    const scrambled = [...cells];
    for (const i of mixed(rng, used).slice(0, flips)) scrambled[i] = turned(scrambled[i]);

    // Dark sensors: empty cells the solution leaves dark but a wrong turn would light.
    const darks: number[] = [];
    if (darkCount) {
      const solLit = beam.lit;
      const tempting = new Set<number>();
      for (const i of trace(base, scrambled).lit.keys()) tempting.add(i);
      for (const p of used) {
        const alt = [...cells];
        alt[p] = turned(alt[p]);
        for (const i of trace(base, alt).lit.keys()) tempting.add(i);
      }
      const cands = mixed(rng, [...tempting].filter((i) => cells[i] === '.' && !solLit.has(i) && i !== entry));
      if (cands.length < darkCount) continue;
      darks.push(...cands.slice(0, darkCount).sort((a, b) => a - b));
    }

    const level: LightState = { ...base, cells: scrambled, targets, darks };
    level.par = differing(level).length;
    if (level.par < 1 || !status(level, cells).won) continue;
    // Par must be the true minimum: no smaller set of taps may solve it.
    const best = fewestTaps(level, level.par - 1);
    if (best === 0) continue;
    if (best !== null) {
      if (!fallback) fallback = { ...level, solution: level.solution };
      continue;
    }
    return level;
  }
  if (fallback) {
    // A shortcut exists: keep the level but make par honest by taking it as the solution.
    const best = fewestTaps(fallback, fallback.par)!;
    const solution = shortcut(fallback, best) ?? fallback.solution;
    return { ...fallback, solution, par: best };
  }
  // The tests guard against ever getting here; a tiny hand-built level.
  const cells: Cell[] = Array(n).fill('.');
  cells[0] = '/';
  return { size, cells, entry: 0, entryDir: 'down', targets: [{ cell: 1, hue: 'w' }, { cell: 2, hue: 'w' }], darks: [], solution: ['\\', ...cells.slice(1)], features: [], moves: 0, par: 1 };
}

/** A layout reachable in exactly k taps that solves the level, if any. */
function shortcut(s: LightState, k: number): Cell[] | null {
  const pieces = s.cells.map((c, i) => (turnable(c) ? i : -1)).filter((i) => i >= 0);
  const cells = [...s.cells];
  const search = (left: number, from: number): boolean => {
    if (left === 0) return status(s, cells).won;
    for (let a = from; a < pieces.length; a++) {
      const i = pieces[a];
      cells[i] = turned(cells[i]);
      if (search(left - 1, a + 1)) return true;
      cells[i] = turned(cells[i]);
    }
    return false;
  };
  return search(k, 0) ? cells : null;
}
