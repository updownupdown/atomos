// Slide Until Stop: an ice maze. The droplet slides in the chosen direction
// until a rock or the edge stops it. Stop exactly on the goal ring to win;
// passing over the goal does not count.
//
// Levels are random rock fields, checked by breadth-first search over the
// stopping positions, and kept only when the shortest solution is long enough.

import { rand, randInt, seeded } from './rng';

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

export interface SlideStopState {
  size: number;
  /** Row-major, size*size; true where a rock sits. */
  rocks: boolean[];
  start: number;
  goal: number;
  /** The droplet's cell index. */
  pos: number;
  moves: number;
  /** Shortest number of slides from start to goal. */
  par: number;
}

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function cloneSlideStop(s: SlideStopState): SlideStopState {
  return { ...s, rocks: [...s.rocks] };
}

export const cellX = (s: SlideStopState, i: number): number => i % s.size;
export const cellY = (s: SlideStopState, i: number): number => Math.floor(i / s.size);

/** Where a slide from `from` in `dir` comes to rest. Equals `from` when nothing moves. */
export function slideEnd(s: SlideStopState, from: number, dir: Dir): number {
  const [dx, dy] = DELTA[dir];
  let x = cellX(s, from), y = cellY(s, from);
  for (;;) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= s.size || ny >= s.size) break;
    if (s.rocks[ny * s.size + nx]) break;
    x = nx; y = ny;
  }
  return y * s.size + x;
}

/** Slides the droplet; null when it cannot move that way. */
export function slide(s: SlideStopState, dir: Dir): SlideStopState | null {
  const end = slideEnd(s, s.pos, dir);
  if (end === s.pos) return null;
  return { ...cloneSlideStop(s), pos: end, moves: s.moves + 1 };
}

export function solved(s: SlideStopState): boolean {
  return s.pos === s.goal;
}

/** Shortest slide sequence from `from` to the goal, or null when the goal is out of reach. */
export function solve(s: SlideStopState, from = s.pos): Dir[] | null {
  const n = s.size * s.size;
  const prev = new Int32Array(n).fill(-1);
  const via: Dir[] = new Array(n);
  const seen = new Uint8Array(n);
  const queue = [from];
  seen[from] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === s.goal) {
      const path: Dir[] = [];
      for (let c = cur; c !== from; c = prev[c]) path.push(via[c]);
      return path.reverse();
    }
    for (const d of DIRS) {
      const end = slideEnd(s, cur, d);
      if (end === cur || seen[end]) continue;
      seen[end] = 1;
      prev[end] = cur;
      via[end] = d;
      queue.push(end);
    }
  }
  return null;
}

/** True when the goal can still be reached from the droplet's cell. */
export function reachable(s: SlideStopState): boolean {
  return solve(s) !== null;
}

/** A fresh ice maze for an element: bigger and longer as z grows. */
export function newSlideStop(z: number, seed: number): SlideStopState {
  const rng = seeded(seed);
  const size = z < 30 ? 7 : z < 80 ? 8 : 9;
  const minPar = 3 + Math.floor(z / 40);
  const n = size * size;
  for (let attempt = 0; attempt < 400; attempt++) {
    const density = 0.11 + rand(rng) * 0.08;
    const rocks: boolean[] = Array.from({ length: n }, () => rand(rng) < density);
    const free = rocks.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    if (free.length < 8) continue;
    const start = free[randInt(rng, free.length)];
    const goal = free[randInt(rng, free.length)];
    if (goal === start) continue;
    const s: SlideStopState = { size, rocks, start, goal, pos: start, moves: 0, par: 0 };
    const path = solve(s);
    if (!path || path.length < minPar) continue;
    return { ...s, par: path.length };
  }
  // Every random field failed, which the tests guard against: a plain corridor as a fallback.
  const rocks: boolean[] = Array(n).fill(false);
  rocks[1] = true;
  rocks[size + size - 1] = true;
  const s: SlideStopState = { size, rocks, start: 0, goal: size + size - 2, pos: 0, moves: 0, par: 0 };
  return { ...s, par: solve(s)?.length ?? 3 };
}
