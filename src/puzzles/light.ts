// Light Routing: a beam enters the grid from one edge and bounces off mirrors.
// Tapping a mirror flips it between / and \. Every target ring must be lit.
//
// The level is built from a solved layout: trace the beam, pick targets on its
// path, then flip some of the mirrors it uses so the start state is unsolved.

import { rand, randInt, seeded } from './rng';

export type Dir = 'up' | 'down' | 'left' | 'right';
/** '.' empty, '/' or '\\' a mirror, '#' a blocker. */
export type Cell = '.' | '/' | '\\' | '#';

export interface LightState {
  size: number;
  cells: Cell[];
  /** The cell the beam enters first (on an edge) and the way it travels. */
  entry: number;
  entryDir: Dir;
  targets: number[];
  /** The mirror orientations the level was built from. */
  solution: Cell[];
  moves: number;
  /** Mirrors that differ from the generating solution at the start. */
  par: number;
}

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const SLASH: Record<Dir, Dir> = { right: 'up', left: 'down', up: 'right', down: 'left' };
const BACKSLASH: Record<Dir, Dir> = { right: 'down', left: 'up', up: 'left', down: 'right' };

export function reflect(cell: Cell, dir: Dir): Dir {
  return cell === '/' ? SLASH[dir] : cell === '\\' ? BACKSLASH[dir] : dir;
}

export function cloneLight(s: LightState): LightState {
  return { ...s, cells: [...s.cells], targets: [...s.targets], solution: [...s.solution] };
}

export interface Beam {
  /** Cells the beam crosses, in order (a mirror cell counts once as it turns). */
  cells: number[];
  /** The direction the beam travels when it leaves each cell in `cells`. */
  dirs: Dir[];
  /** True when the beam leaves the grid; false when a blocker stops it. */
  exits: boolean;
}

export function trace(s: LightState, cells: Cell[] = s.cells): Beam {
  const out: Beam = { cells: [], dirs: [], exits: true };
  let x = s.entry % s.size, y = Math.floor(s.entry / s.size);
  let dir = s.entryDir;
  for (let guard = 0; guard < s.size * s.size * 4; guard++) {
    if (x < 0 || y < 0 || x >= s.size || y >= s.size) return out;
    const i = y * s.size + x;
    const c = cells[i];
    if (c === '#') { out.exits = false; return out; }
    dir = reflect(c, dir);
    out.cells.push(i);
    out.dirs.push(dir);
    x += DELTA[dir][0];
    y += DELTA[dir][1];
  }
  out.exits = false;
  return out;
}

export function lit(s: LightState): Set<number> {
  return new Set(trace(s).cells);
}

export function solved(s: LightState): boolean {
  const on = lit(s);
  return s.targets.every((t) => on.has(t));
}

/** Flips the mirror at a cell; null when the cell holds no mirror. */
export function flip(s: LightState, i: number): LightState | null {
  const c = s.cells[i];
  if (c !== '/' && c !== '\\') return null;
  const next = cloneLight(s);
  next.cells[i] = c === '/' ? '\\' : '/';
  next.moves += 1;
  return next;
}

/** Mirrors whose orientation differs from the generating solution. */
export function differing(s: LightState): number[] {
  return s.cells.map((c, i) => ((c === '/' || c === '\\') && c !== s.solution[i] ? i : -1)).filter((i) => i >= 0);
}

export function newLight(z: number, seed: number): LightState {
  const rng = seeded(seed);
  const size = z < 30 ? 5 : z < 80 ? 6 : 7;
  const n = size * size;
  const targetCount = z < 50 ? 2 : 3;
  const wantFlips = 1 + Math.floor(z / 30);
  for (let attempt = 0; attempt < 600; attempt++) {
    const cells: Cell[] = Array(n).fill('.');
    const mirrors = size + 1 + randInt(rng, 3);
    const blockers = 1 + randInt(rng, 3);
    for (let k = 0; k < mirrors; k++) cells[randInt(rng, n)] = rand(rng) < 0.5 ? '/' : '\\';
    for (let k = 0; k < blockers; k++) {
      const i = randInt(rng, n);
      if (cells[i] === '.') cells[i] = '#';
    }
    // The entry: a random edge cell, the beam heading inward.
    const side = randInt(rng, 4);
    const k = randInt(rng, size);
    const entry = side === 0 ? k : side === 1 ? (size - 1) * size + k : side === 2 ? k * size : k * size + size - 1;
    const entryDir: Dir = side === 0 ? 'down' : side === 1 ? 'up' : side === 2 ? 'right' : 'left';
    if (cells[entry] === '#') continue;
    const base: LightState = { size, cells, entry, entryDir, targets: [], solution: [...cells], moves: 0, par: 0 };
    const beam = trace(base);
    const hit = [...new Set(beam.cells.filter((i) => cells[i] === '/' || cells[i] === '\\'))];
    if (hit.length < Math.max(2, wantFlips)) continue;
    // Targets: empty cells the beam crosses after its first bounce, so a flip matters.
    const firstMirror = beam.cells.indexOf(hit[0]);
    const after = beam.cells.slice(firstMirror + 1).filter((i) => cells[i] === '.');
    if (after.length < targetCount) continue;
    const targets: number[] = [];
    const pool = [...after];
    while (targets.length < targetCount) targets.push(pool.splice(randInt(rng, pool.length), 1)[0]);
    targets.sort((a, b) => beam.cells.indexOf(a) - beam.cells.indexOf(b));
    // Scramble: flip mirrors the beam uses, so the puzzle needs the player's hand.
    const flips = Math.min(wantFlips, hit.length);
    const choices = [...hit];
    const scrambled = [...cells];
    for (let f = 0; f < flips; f++) {
      const i = choices.splice(randInt(rng, choices.length), 1)[0];
      scrambled[i] = scrambled[i] === '/' ? '\\' : '/';
    }
    const s: LightState = { ...base, cells: scrambled, targets, par: flips };
    if (solved(s)) continue;
    return s;
  }
  // The tests guard against ever getting here; a tiny hand-built level as a fallback.
  const cells: Cell[] = Array(size * size).fill('.');
  cells[0] = '/';
  const s: LightState = { size, cells, entry: 0, entryDir: 'down', targets: [1], solution: ['\\', ...cells.slice(1)], moves: 0, par: 1 };
  return s;
}
