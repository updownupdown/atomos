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
// Game rule, not physics: real nuclei are not built by pairing up clusters;
// the clusters are only a way to count nucleons.

import { randInt, seeded, weighted, type Rng } from './rng';

export interface Nucleus {
  z: number;
  a: number;
}

export interface Tile {
  id: number;
  /** Nucleons in the cluster: 1, 2, 4, 8, ... */
  v: number;
  spoiled: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Where a tile went in the last move, for animation. */
export interface Journey {
  id: number;
  from: number;
  to: number;
  /** The id of the tile it merged into, when it did. */
  into?: number;
}

export interface MergeState {
  size: number;
  cells: (Tile | null)[];
  target: Nucleus;
  /** Cluster sizes the nucleus wants, largest first. */
  sockets: number[];
  /** How many sockets are filled, in order. */
  filled: number;
  moves: number;
  spoils: number;
  par: number;
  nextId: number;
  rng: Rng;
  last: Journey[];
  /** Ids of tiles spawned by the last move. */
  spawned: number[];
  /** Tiles that flew into the nucleus on the last move, with the cell they left. */
  flown: { tile: Tile; from: number }[];
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

/** The smallest cluster the board deals for a nucleus of mass number a: single nucleons up to
 *  iron, and past it the power of two that keeps a run about as long as iron's (a / unit at most
 *  56). Every cluster still shows its real nucleon count. */
export function clusterUnit(a: number): number {
  let u = 1;
  while (a / u > 56) u *= 2;
  return u;
}

/** What the board deals out: mostly single nucleons, some pairs, a few fours for big nuclei.
 *  Past iron the same mix is dealt in bigger clusters (see clusterUnit). */
export function spawnMix(target: Nucleus): { kinds: number[]; weights: number[] } {
  const u = clusterUnit(target.a);
  if (u > 1) return { kinds: [u, 2 * u, 4 * u], weights: [6, 3, 2] };
  const kinds = [1, 2];
  const weights = [6, 3];
  if (target.a >= 16) {
    kinds.push(4);
    weights.push(target.a >= 40 ? 2 : 1);
  }
  return { kinds, weights };
}

/** About how many swipes a steady player needs. Up to iron, 0.7 per nucleon. Past it, fitted to
 *  a greedy player's runs on every heavy nucleus (about 0.6 per dealt cluster, plus the small
 *  clusters the low bits ask for), with iron's margin over that player, capped at 45. */
export function mergePar(a: number): number {
  const u = clusterUnit(a);
  if (u === 1) return Math.ceil(a * 0.7) + 1;
  const low = a % u;
  const bits = low.toString(2).split('1').length - 1;
  return Math.min(45, Math.ceil(1.14 * (0.6 * ((a - low) / u) + 1.6 * bits + 6.1)));
}

export function newMerge(target: Nucleus, seed: number, size = 4): MergeState {
  const s: MergeState = {
    size, cells: Array(size * size).fill(null), target, sockets: socketsFor(target.a), filled: 0,
    moves: 0, spoils: 0, par: mergePar(target.a), nextId: 1, rng: seeded(seed), last: [], spawned: [], flown: [],
  };
  for (let i = 0; i < 3; i++) spawn(s);
  s.spawned = [];
  return s;
}

export function cloneMerge(s: MergeState): MergeState {
  return { ...s, cells: s.cells.map((t) => (t ? { ...t } : null)), rng: { ...s.rng }, last: [], spawned: [], flown: [] };
}

function spawn(s: MergeState): void {
  const empty = s.cells.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return;
  const at = empty[randInt(s.rng, empty.length)];
  const mix = spawnMix(s.target);
  let v = mix.kinds[weighted(s.rng, mix.weights)];
  // Never deal a cluster already too big to be wanted. Light nuclei fall back to a single
  // nucleon; past iron, to the biggest cluster that still fits, down to the singles and pairs a
  // heavy nucleus's low bits ask for.
  const want = wanted(s);
  if (want !== null && v > want) {
    const fits = mix.kinds.filter((k) => k <= want);
    v = clusterUnit(s.target.a) === 1 ? 1 : fits.length ? fits[fits.length - 1] : want >= 2 && weighted(s.rng, [6, 3]) === 1 ? 2 : 1;
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
  for (const line of lines(s.size, dir)) {
    const out: { tile: Tile; merged: boolean; at: number }[] = [];
    for (const idx of line) {
      const tile = next.cells[idx];
      if (!tile) continue;
      const prev = out[out.length - 1];
      if (prev && !prev.merged && prev.tile.v === tile.v) {
        const v = tile.v * 2;
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

/** No swipe would change the board: the only way on is a restart. */
export function jammed(s: MergeState): boolean {
  return !won(s) && (['up', 'down', 'left', 'right'] as Dir[]).every((d) => slide(s, d) === null);
}
