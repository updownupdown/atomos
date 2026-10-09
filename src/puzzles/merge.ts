// Merge: build the nucleus by fusing light nuclei.
//
// A 4x4 board of nuclei. Swiping slides every tile; when a light nucleus (mass
// number 4 or less: a proton, a neutron, deuterium, tritium, helium-3 or an alpha)
// runs into another tile and the two add up to a real nuclide, they fuse. Make the
// element's most common nucleus to win. Fusing past it spoils the tile, which
// cracks and crumbles away on the next swipe.
//
// Game rule, not physics: real fusion needs enormous energy and nuclei do not
// slide about; but every fusion here does add up, and beryllium-8 really does
// fall back apart (it is spoiled for every target but beryllium itself).

import { findIsotope } from '../core/isotopes';
import { rand, randInt, seeded, weighted, type Rng } from './rng';

export interface Nucleus {
  z: number;
  a: number;
}

export interface Tile extends Nucleus {
  id: number;
  spoiled: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Where a tile went in the last move, for animation. */
export interface Journey {
  id: number;
  from: number;
  to: number;
  /** The id of the tile it fused into, when it did. */
  into?: number;
}

export interface MergeState {
  size: number;
  cells: (Tile | null)[];
  target: Nucleus;
  moves: number;
  spoils: number;
  nextId: number;
  rng: Rng;
  last: Journey[];
  /** Ids of tiles spawned by the last move. */
  spawned: number[];
}

export const PROTON: Nucleus = { z: 1, a: 1 };
export const NEUTRON: Nucleus = { z: 0, a: 1 };
export const ALPHA: Nucleus = { z: 2, a: 4 };

/** A nucleus light enough to be slammed into another. */
export function isLight(n: Nucleus): boolean {
  return n.a <= 4;
}

export function sameNucleus(a: Nucleus, b: Nucleus): boolean {
  return a.z === b.z && a.a === b.a;
}

/** Whether the sum of two nuclei is a real nuclide, and what it is. */
export function fuse(a: Nucleus, b: Nucleus): Nucleus | null {
  if (!isLight(a) && !isLight(b)) return null;
  const z = a.z + b.z, mass = a.a + b.a;
  if (z === 0) return null;
  return findIsotope(z, mass) ? { z, a: mass } : null;
}

/** A nucleus that has gone past the target can never become it. */
export function overshoots(n: Nucleus, target: Nucleus): boolean {
  return n.z > target.z || (n.z === target.z && n.a > target.a);
}

/** What the board deals out: protons and neutrons, with alphas once the target is big enough to want them. */
export function spawnMix(target: Nucleus): { kinds: Nucleus[]; weights: number[] } {
  const kinds = [PROTON, NEUTRON];
  const weights = [4, 3];
  if (target.z >= 4) {
    kinds.push(ALPHA);
    weights.push(target.z >= 6 ? 3 : 2);
  }
  return { kinds, weights };
}

export function newMerge(target: Nucleus, seed: number, size = 4): MergeState {
  const s: MergeState = {
    size, cells: Array(size * size).fill(null), target, moves: 0, spoils: 0, nextId: 1, rng: seeded(seed), last: [], spawned: [],
  };
  for (let i = 0; i < 3; i++) spawn(s);
  s.spawned = [];
  return s;
}

export function cloneMerge(s: MergeState): MergeState {
  return { ...s, cells: s.cells.map((t) => (t ? { ...t } : null)), rng: { ...s.rng }, last: [], spawned: [] };
}

function spawn(s: MergeState): void {
  const empty = s.cells.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return;
  const at = empty[randInt(s.rng, empty.length)];
  const mix = spawnMix(s.target);
  const kind = mix.kinds[weighted(s.rng, mix.weights)];
  const tile: Tile = { ...kind, id: s.nextId++, spoiled: false };
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

/**
 * Slides every tile in one direction. Returns the new state, or null when nothing
 * would move (a swipe into a wall is not a move). Spoiled tiles crumble first.
 */
export function slide(s: MergeState, dir: Dir): MergeState | null {
  const next = cloneMerge(s);
  const before = s.cells.map((t) => (t ? `${t.id}` : '.')).join(',');
  for (let i = 0; i < next.cells.length; i++) if (next.cells[i]?.spoiled) next.cells[i] = null;
  const journeys: Journey[] = [];
  for (const line of lines(s.size, dir)) {
    const out: { tile: Tile; fused: boolean; at: number }[] = [];
    for (const idx of line) {
      const tile = next.cells[idx];
      if (!tile) continue;
      const prev = out[out.length - 1];
      const product = prev && !prev.fused ? fuse(prev.tile, tile) : null;
      if (prev && product) {
        const made: Tile = { ...product, id: next.nextId++, spoiled: overshoots(product, s.target) };
        if (made.spoiled) next.spoils++;
        journeys.push({ id: tile.id, from: idx, to: line[out.length - 1], into: made.id });
        journeys.push({ id: prev.tile.id, from: prev.at, to: line[out.length - 1], into: made.id });
        out[out.length - 1] = { tile: made, fused: true, at: line[out.length - 1] };
      } else {
        journeys.push({ id: tile.id, from: idx, to: line[out.length] });
        out.push({ tile, fused: false, at: idx });
      }
    }
    for (let i = 0; i < line.length; i++) next.cells[line[i]] = i < out.length ? out[i].tile : null;
  }
  const after = next.cells.map((t) => (t ? `${t.id}` : '.')).join(',');
  if (before === after) return null;
  next.moves = s.moves + 1;
  next.last = journeys;
  spawn(next);
  return next;
}

export function won(s: MergeState): boolean {
  return s.cells.some((t) => t && !t.spoiled && sameNucleus(t, s.target));
}

/** No swipe would change the board: the only way on is a restart. */
export function jammed(s: MergeState): boolean {
  return (['up', 'down', 'left', 'right'] as Dir[]).every((d) => slide(s, d) === null);
}

/** The short name a tile wears: p, n, or the mass number with the element's symbol. */
export function tileLabel(n: Nucleus, symbol: (z: number) => string): { mass: string; name: string } {
  if (sameNucleus(n, PROTON)) return { mass: '', name: 'p' };
  if (sameNucleus(n, NEUTRON)) return { mass: '', name: 'n' };
  if (n.z === 1 && n.a === 2) return { mass: '2', name: 'D' };
  if (n.z === 1 && n.a === 3) return { mass: '3', name: 'T' };
  return { mass: String(n.a), name: symbol(n.z) };
}

/** A deterministic shuffle helper used by tests and level checks. */
export function sampleDeal(target: Nucleus, seed: number, n: number): Nucleus[] {
  const rng = seeded(seed);
  const mix = spawnMix(target);
  return Array.from({ length: n }, () => mix.kinds[weighted(rng, mix.weights)]);
}

export { rand };
