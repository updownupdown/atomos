// Lumen: place the optics. A beam enters the grid from one edge; the player takes
// mirrors (and, on heavier atoms, a splitter) from a tray and sets them on empty
// cells to steer it.
//
//   / \      mirrors from the tray: reflect the beam; a tap turns one, another
//            tap takes it back;
//   H/ H\    splitters from the tray (half-silvered): the beam both passes and
//            reflects;
//   F/ F\    fixed mirrors, part of the board;
//   Cs..Cf   color filters, part of the board: white light leaves tinted;
//            light of the filter's own color passes; any other is absorbed;
//   #        blockers: stop the beam.
//
// Sensors sit on empty cells: target rings must be lit (a colored ring by
// light of its color), dark sensors must stay unlit.
//
// Levels come from lightSolver.ts: each has exactly one answer, and it uses
// every piece in the tray, so par is the tray's size. Only placing a piece
// counts as a move; turning or taking one back is free.

import { rand, randInt, seeded, type Rng } from './rng';
import { generate, M_BS, M_SL, S_SL, type Cfg, type NBoard } from './lightSolver';

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
  /** The board, with the pieces the player has placed on it. */
  cells: Cell[];
  /** The cell the beam enters first (on an edge) and the way it travels. */
  entry: number;
  entryDir: Dir;
  targets: Target[];
  /** Sensors that must stay dark. */
  darks: number[];
  /** The one answer: the board with every tray piece in place. */
  solution: Cell[];
  /** The pieces the level hands the player. */
  tray: { mirrors: number; splitters: number };
  /** The extra piece kinds this level uses. */
  features: Feature[];
  /** Pieces placed. */
  moves: number;
  /** Fewest placements that solve it: the tray's size, proven by search. */
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

/** A piece the player placed (board pieces are fixed mirrors, filters and blockers). */
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
  return { ...s, cells: [...s.cells], targets: s.targets.map((t) => ({ ...t })), darks: [...s.darks], solution: [...s.solution], tray: { ...s.tray }, features: [...s.features] };
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

export type PieceKind = 'mirror' | 'splitter';

/** Tray pieces not yet on the board. */
export function left(s: LightState): Record<PieceKind, number> {
  let m = 0, sp = 0;
  for (const c of s.cells) { if (c === '/' || c === '\\') m++; else if (c === 'H/' || c === 'H\\') sp++; }
  return { mirror: s.tray.mirrors - m, splitter: s.tray.splitters - sp };
}

/** Whether a tray piece may go on cell i: empty, and not the lamp's cell or a sensor. */
export function open(s: LightState, i: number): boolean {
  return s.cells[i] === '.' && i !== s.entry && !s.targets.some((t) => t.cell === i) && !s.darks.includes(i);
}

/** Sets a tray piece on an open cell, slanted /; one move. Null when it cannot go there. */
export function place(s: LightState, i: number, kind: PieceKind): LightState | null {
  if (!open(s, i) || left(s)[kind] <= 0) return null;
  const next = cloneLight(s);
  next.cells[i] = kind === 'mirror' ? '/' : 'H/';
  next.moves += 1;
  return next;
}

/** Turns a placed piece between / and \; free. Null for anything else. */
export function turn(s: LightState, i: number): LightState | null {
  if (!turnable(s.cells[i])) return null;
  const next = cloneLight(s);
  next.cells[i] = turned(s.cells[i]);
  return next;
}

/** Takes a placed piece back to the tray; free. Null for anything else. */
export function lift(s: LightState, i: number): LightState | null {
  if (!turnable(s.cells[i])) return null;
  const next = cloneLight(s);
  next.cells[i] = '.';
  return next;
}

/**
 * One tap on cell i: an open cell takes a piece of `kind` (or of the other kind when that one is
 * used up), a placed piece slanted / turns to \, and one slanted \ goes back to the tray.
 */
export function tap(s: LightState, i: number, kind: PieceKind): LightState | null {
  const c = s.cells[i];
  if (c === '/' || c === 'H/') return turn(s, i);
  if (c === '\\' || c === 'H\\') return lift(s, i);
  const l = left(s);
  const k = l[kind] > 0 ? kind : kind === 'mirror' ? 'splitter' : 'mirror';
  return place(s, i, k);
}

// ---- generation ------------------------------------------------------------------

const clampZ = (z: number) => Math.min(118, Math.max(1, Math.round(z)));

/** The element at which each piece kind first appears. */
export const INTRO: Record<Feature, number> = { fixed: 6, darks: 26, splitters: 41, filters: 61 };

const BASE: Cfg = { size: 6, mirrors: 3, splitters: 0, fixed: 0, decoys: 0, filters: 0, targets: 2, colored: 0, darksInit: 0, darksMax: 0, blockers: [1, 3], blockersMax: 8 };
const DARKS = { darksInit: 1, darksMax: 2 };

/**
 * The ladder from the redesign study: the tray grows from one mirror to four pieces on 6x6, dark
 * sensors arrive at Fe, one splitter at Nb, color filters fixed on the board at Pm, and 7x7 boards
 * from Md. Each step's measured win rates are in puzzle-distribution/lumen-study.md.
 */
export function cfgFor(z: number, rng: Rng): Cfg {
  const t = clampZ(z);
  if (t <= 5) return { ...BASE, mirrors: 1 };
  if (t <= 25) return rand(rng) < 1 / 3 ? { ...BASE, mirrors: 2, fixed: 2, decoys: 1 } : { ...BASE, mirrors: 2 };
  if (t <= 40) return { ...BASE, ...DARKS };
  if (t <= 60) return { ...BASE, mirrors: 2, splitters: 1, targets: 3 };
  if (t <= 70) return { ...BASE, filters: 1, targets: 3, colored: 1, ...DARKS };
  if (t <= 80) return { ...BASE, mirrors: 2, splitters: 1, filters: 2, targets: 3, colored: 2, ...DARKS };
  if (t <= 100) {
    const k = randInt(rng, 3);
    return k === 0 ? { ...BASE, mirrors: 4, targets: 3, ...DARKS }
      : k === 1 ? { ...BASE, splitters: 1, targets: 4, ...DARKS }
      : { ...BASE, splitters: 1, filters: 2, targets: 4, colored: 2, ...DARKS };
  }
  const big = { ...BASE, size: 7, blockers: [2, 4] as [number, number], blockersMax: 10 };
  return rand(rng) < 0.5 ? { ...big, splitters: 1, filters: 2, targets: 4, colored: 2, ...DARKS } : { ...big, mirrors: 5, targets: 3 };
}

const HUES: Hue[] = ['w', 's', 'p', 'd', 'f'];
const CODE_CELL: Cell[] = ['.', '#', 'F/', 'F\\', 'H/', 'H\\', 'Cs', 'Cp', 'Cd', 'Cf'];
const DIRS: Dir[] = ['up', 'right', 'down', 'left'];

/** The study's numeric level as the game's state: board pieces fixed, tray pieces off the board. */
function fromBoard(b: NBoard): LightState {
  const cells = Array.from(b.cells, (c) => CODE_CELL[c]);
  const solution = [...cells];
  for (const p of b.intended) {
    const c = p & 15;
    solution[p >> 4] = c === M_SL ? '/' : c === M_BS ? '\\' : c === S_SL ? 'H/' : 'H\\';
  }
  const features: Feature[] = [];
  if (cells.some((c) => c[0] === 'F')) features.push('fixed');
  if (b.darks.length) features.push('darks');
  if (b.tray.splitters) features.push('splitters');
  if (cells.some((c) => c[0] === 'C')) features.push('filters');
  return {
    size: b.size, cells, entry: b.entry, entryDir: DIRS[b.entryDir],
    targets: b.targets.map((t) => ({ cell: t.cell, hue: HUES[t.hue] })), darks: [...b.darks],
    solution, tray: { ...b.tray }, features, moves: 0, par: b.tray.mirrors + b.tray.splitters,
  };
}

/** A level for element z: exactly one answer, which uses every piece in the tray. */
export function newLight(z: number, seed: number): LightState {
  const rng = seeded(seed);
  const cfg = cfgFor(z, rng);
  const sub = randInt(rng, 0x7fffffff);
  const level = generate(cfg, sub)
    // A rare seed finds no unique board; the same band without its newest piece kind always does.
    ?? generate({ ...cfg, splitters: 0, filters: 0, colored: 0, mirrors: Math.min(4, cfg.mirrors + cfg.splitters), ...DARKS }, sub + 1)
    ?? generate({ ...BASE, mirrors: 2 }, sub + 2);
  if (level) return fromBoard(level);
  // The tests guard against ever getting here; a tiny hand-built level.
  const size = 6;
  const cells: Cell[] = Array(size * size).fill('.');
  const solution = [...cells];
  solution[3] = '\\';
  return { size, cells, entry: 0, entryDir: 'right', targets: [{ cell: 9, hue: 'w' }, { cell: 15, hue: 'w' }], darks: [], solution, tray: { mirrors: 1, splitters: 0 }, features: [], moves: 0, par: 1 };
}
