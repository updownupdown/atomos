// Fission: a chain reaction.
//
// A grid of nuclei, each printed with one to three small arrows. Tap one and it splits, sending a
// neutron along each arrow. A neutron flies straight until it hits a nucleus, which splits in
// turn, or a moderator block, which soaks it up, or the edge of the plate, where it is lost.
// Split every nucleus in as few taps as the board allows (its par). Nothing is random once the
// board is dealt, so the puzzle is reading the arrows and finding the nucleus that sets off
// everything.
//
// Game rule, not physics: real fission neutrons fly off in every direction, and a chain reaction
// needs a critical mass, not a well-aimed tap.

import { randInt, seeded, type Rng } from './rng';

export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export interface Nucleus {
  cell: number;
  /** The ways its neutrons fly, as a bit per direction (1 up, 2 right, 4 down, 8 left). */
  arrows: number;
}

export interface FissionState {
  size: number;
  nuclei: Nucleus[];
  /** Moderator blocks. */
  blocks: number[];
  /** Which nuclei have split, a bit per index into `nuclei`. */
  split: number;
  moves: number;
  par: number;
  /** The last tap's chain, nucleus indices in the order they split, with the flights between
   *  them, for the view's animation. */
  last: Chain | null;
}

/** One neutron's flight: from a cell, in a direction, to the cell it ended on, and what it hit. */
export interface Flight {
  from: number;
  dir: Dir;
  to: number;
  hit: 'nucleus' | 'block' | 'edge';
  /** The nucleus index it split, when it hit one not yet split. */
  splits?: number;
  /** Steps after the tap this flight starts, so the view can pace the chain. */
  step: number;
}

export interface Chain {
  /** The nucleus tapped. */
  start: number;
  flights: Flight[];
  /** Nuclei split by this chain, in order, with the step each split at. */
  splits: { index: number; step: number }[];
}

/** The nucleus index at a cell, or -1. */
export function nucleusAt(s: FissionState, cell: number): number {
  return s.nuclei.findIndex((n) => n.cell === cell);
}

/** Runs the chain a tap on nucleus `index` sets off, on the board's current state. */
export function chainFrom(s: FissionState, index: number): Chain {
  const n = s.size;
  const at = new Map<number, number>();
  s.nuclei.forEach((nu, i) => at.set(nu.cell, i));
  const blocked = new Set(s.blocks);
  let split = s.split | (1 << index);
  const flights: Flight[] = [];
  const splits = [{ index, step: 0 }];
  let wave = [{ index, step: 0 }];
  while (wave.length) {
    const next: { index: number; step: number }[] = [];
    for (const w of wave) {
      const nu = s.nuclei[w.index];
      for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
        if (!(nu.arrows & (1 << d))) continue;
        let x = nu.cell % n, y = Math.floor(nu.cell / n);
        let to = nu.cell;
        let hit: Flight['hit'] = 'edge';
        let target: number | undefined;
        for (;;) {
          x += DX[d]; y += DY[d];
          if (x < 0 || y < 0 || x >= n || y >= n) break;
          const c = y * n + x;
          to = c;
          if (blocked.has(c)) { hit = 'block'; break; }
          const k = at.get(c);
          if (k !== undefined) {
            hit = 'nucleus';
            if (!(split & (1 << k))) { target = k; }
            break;
          }
        }
        const f: Flight = { from: nu.cell, dir: d, to, hit, step: w.step };
        if (target !== undefined) {
          f.splits = target;
          split |= 1 << target;
          next.push({ index: target, step: w.step + 1 });
          splits.push({ index: target, step: w.step + 1 });
        }
        flights.push(f);
      }
    }
    wave = next;
  }
  return { start: index, flights, splits };
}

/** The set of nuclei split after tapping `index` on this board, as a bit mask. */
function closure(s: FissionState, index: number): number {
  let mask = s.split;
  for (const sp of chainFrom(s, index).splits) mask |= 1 << sp.index;
  return mask;
}

export function allSplit(s: FissionState): number {
  return (1 << s.nuclei.length) - 1;
}

export function solved(s: FissionState): boolean {
  return s.split === allSplit(s);
}

/** Taps nucleus `index`; null when it has already split. */
export function tap(s: FissionState, index: number): FissionState | null {
  if (s.split & (1 << index)) return null;
  const chain = chainFrom(s, index);
  let split = s.split;
  for (const sp of chain.splits) split |= 1 << sp.index;
  return { ...s, split, moves: s.moves + 1, last: chain };
}

/**
 * The fewest taps that split every nucleus from here, and one such set of taps: every single
 * tap, then every pair, then every triple, on the closures of the unsplit nuclei. Boards hold at
 * most about 16 nuclei, so this is at most a few thousand closures.
 */
export function plan(s: FissionState, maxTaps = 4): number[] | null {
  if (solved(s)) return [];
  const all = allSplit(s);
  const open: number[] = [];
  for (let i = 0; i < s.nuclei.length; i++) if (!(s.split & (1 << i))) open.push(i);
  // Closures from the present board, each taken alone.
  const reach = open.map((i) => closure(s, i));
  // Chains never undo splits, so taps commute: the closure of a set is the union of the
  // closures of its members, on the board as it is now.
  const search = (k: number): number[] | null => {
    const pick: number[] = [];
    const rec = (start: number, mask: number): boolean => {
      if (mask === all) return true;
      if (pick.length === k) return false;
      for (let j = start; j < open.length; j++) {
        if ((mask | reach[j]) === mask) continue;
        pick.push(open[j]);
        if (rec(j + 1, mask | reach[j])) return true;
        pick.pop();
      }
      return false;
    };
    return rec(0, s.split) ? pick : null;
  };
  for (let k = 1; k <= maxTaps; k++) {
    const p = search(k);
    if (p) return p;
  }
  return null;
}

/** The number of taps the plan takes, for the board as dealt. */
function parOf(s: FissionState): number {
  return plan(s)?.length ?? 99;
}

/** Board size, nucleus count, moderator count, par wanted and the most arrows a nucleus gets. */
export function fissionShape(z: number): { size: number; nuclei: number; blocks: number; par: number; arrows: [number, number]; solos: number } {
  if (z <= 4) return { size: 4, nuclei: 5, blocks: 0, par: 1, arrows: [1, 3], solos: 2 };
  if (z <= 10) return { size: 5, nuclei: 7, blocks: 0, par: 1, arrows: [1, 3], solos: 1 };
  if (z <= 20) return { size: 5, nuclei: 8, blocks: 1, par: 1, arrows: [1, 3], solos: 1 };
  if (z <= 36) return { size: 5, nuclei: 9, blocks: 1, par: 2, arrows: [2, 3], solos: 0 };
  if (z <= 56) return { size: 6, nuclei: 10, blocks: 1, par: 2, arrows: [2, 3], solos: 0 };
  if (z <= 86) return { size: 6, nuclei: 12, blocks: 2, par: 3, arrows: [2, 3], solos: 0 };
  if (z <= 104) return { size: 7, nuclei: 15, blocks: 3, par: 3, arrows: [2, 3], solos: 0 };
  return { size: 7, nuclei: 16, blocks: 4, par: 4, arrows: [2, 3], solos: 0 };
}

/** Deals a board for element z: random nuclei and blocks, redealt until par comes out as the
 *  element asks and only a few starts finish it in one. */
export function newFission(z: number, seed: number): FissionState {
  const rng = seeded(seed);
  const shape = fissionShape(z);
  let best: FissionState | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const s = dealOnce(shape, rng);
    const p = parOf(s);
    if (p !== shape.par) continue;
    // How many single taps finish the board: on a par-1 board, only a few should.
    if (shape.par === 1) {
      const all = allSplit(s);
      let solos = 0;
      for (let i = 0; i < s.nuclei.length; i++) if (closure(s, i) === all) solos++;
      if (solos > Math.max(1, shape.solos)) continue;
    }
    best = { ...s, par: p };
    break;
  }
  // Never expected: any deal with a par the planner can find.
  for (let attempt = 0; !best && attempt < 200; attempt++) {
    const s = dealOnce(shape, rng);
    const p = plan(s, 6);
    if (p) best = { ...s, par: p.length };
  }
  return best!;
}

function dealOnce(shape: ReturnType<typeof fissionShape>, rng: Rng): FissionState {
  const n = shape.size;
  const cells = Array.from({ length: n * n }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const nuclei: Nucleus[] = [];
  for (let k = 0; k < shape.nuclei; k++) {
    const count = shape.arrows[0] + randInt(rng, shape.arrows[1] - shape.arrows[0] + 1);
    let arrows = 0;
    while (popcount(arrows) < Math.min(count, 3)) arrows |= 1 << randInt(rng, 4);
    nuclei.push({ cell: cells[k], arrows });
  }
  const blocks = cells.slice(shape.nuclei, shape.nuclei + shape.blocks);
  return { size: n, nuclei, blocks, split: 0, moves: 0, par: 0, last: null };
}

function popcount(v: number): number {
  let c = 0;
  for (; v; v &= v - 1) c++;
  return c;
}

export function cloneFission(s: FissionState): FissionState {
  return { ...s, nuclei: s.nuclei.map((n) => ({ ...n })), blocks: s.blocks.slice(), last: null };
}
