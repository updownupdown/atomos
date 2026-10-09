// Rutherford Probe: find the hidden nucleus from how probes scatter off it.
//
// A 6×6 box hides a nucleus of a few connected cells. Probes fired from the 24
// edge slots travel straight: one that runs into a nucleus cell is absorbed (a
// hit), one that passes a nucleus cell on its diagonal is turned 90° away from
// it (two at once turn it right round), and the rest come out somewhere. Mark
// the cells you believe are the nucleus and submit the guess.
//
// Game rule, not physics: Rutherford's alpha particles scattered off a point
// charge by the Coulomb force, in every direction. The straight tracks and the
// right-angle turns are the Black Box game's rules, not the scattering law.

import { pick, randInt, seeded, type Rng } from './rng';

export const SIZE = 6;
export const SLOTS = SIZE * 4;

export interface Cell {
  r: number;
  c: number;
}

export type Outcome =
  | { kind: 'hit' }
  | { kind: 'reflect' }
  | { kind: 'pass'; exit: number };

export interface Probe {
  slot: number;
  outcome: Outcome;
  /** The cells the probe crossed, in order; empty for one turned back at the edge. */
  track: Cell[];
  /** 1-based number shared by the two ends of a pass; 0 for hits and reflections. */
  label: number;
}

export interface RutherfordState {
  nucleus: Cell[];
  probes: Probe[];
  /** The player's marks, one flag per cell, row-major. */
  marks: boolean[];
  /** Wrong guesses submitted so far. */
  wrong: number;
  moves: number;
  par: number;
  won: boolean;
}

export function cloneRutherford(s: RutherfordState): RutherfordState {
  return { ...s, nucleus: s.nucleus.map((c) => ({ ...c })), probes: s.probes.map((p) => ({ ...p, track: p.track.map((c) => ({ ...c })) })), marks: [...s.marks] };
}

// ---- slots --------------------------------------------------------------------------

/** Where a slot sits: side 0 top, 1 right, 2 bottom, 3 left; `i` runs along that side left-to-right or top-to-bottom. */
export function slotSide(slot: number): { side: number; i: number } {
  return { side: Math.floor(slot / SIZE), i: slot % SIZE };
}

/** The cell just outside the box at a slot, and the direction a probe fired there travels. */
export function slotEntry(slot: number): { pos: Cell; dir: Cell } {
  const { side, i } = slotSide(slot);
  switch (side) {
    case 0: return { pos: { r: -1, c: i }, dir: { r: 1, c: 0 } };
    case 1: return { pos: { r: i, c: SIZE }, dir: { r: 0, c: -1 } };
    case 2: return { pos: { r: SIZE, c: i }, dir: { r: -1, c: 0 } };
    default: return { pos: { r: i, c: -1 }, dir: { r: 0, c: 1 } };
  }
}

/** The slot a probe leaves through when it steps out of the box onto `pos`. */
export function slotOf(pos: Cell): number {
  if (pos.r < 0) return pos.c;
  if (pos.c >= SIZE) return SIZE + pos.r;
  if (pos.r >= SIZE) return 2 * SIZE + pos.c;
  return 3 * SIZE + pos.r;
}

const inside = (p: Cell) => p.r >= 0 && p.r < SIZE && p.c >= 0 && p.c < SIZE;
const same = (a: Cell, b: Cell) => a.r === b.r && a.c === b.c;

/** Fires a probe through a nucleus; the pure Black Box rules. */
export function trace(nucleus: Cell[], slot: number): { outcome: Outcome; track: Cell[] } {
  const has = (p: Cell) => nucleus.some((n) => same(n, p));
  let { pos, dir } = slotEntry(slot);
  const track: Cell[] = [];
  for (let guard = 0; guard < 4 * SIZE * SIZE; guard++) {
    const ahead = { r: pos.r + dir.r, c: pos.c + dir.c };
    if (!inside(ahead)) {
      const exit = slotOf(ahead);
      return { outcome: exit === slot ? { kind: 'reflect' } : { kind: 'pass', exit }, track };
    }
    if (has(ahead)) return { outcome: { kind: 'hit' }, track };
    // The two cells diagonally ahead: one turns the probe away from it, two turn it back.
    const left = { r: ahead.r - dir.c, c: ahead.c + dir.r };
    const right = { r: ahead.r + dir.c, c: ahead.c - dir.r };
    const l = has(left), rr = has(right);
    if (l && rr) {
      dir = { r: -dir.r, c: -dir.c };
    } else if (l) {
      dir = { r: dir.c, c: -dir.r };
    } else if (rr) {
      dir = { r: -dir.c, c: dir.r };
    } else {
      pos = ahead;
      track.push({ ...pos });
    }
    if ((l || rr) && !inside(pos)) {
      // Turned before it ever entered: it comes straight back out.
      return { outcome: { kind: 'reflect' }, track };
    }
  }
  return { outcome: { kind: 'reflect' }, track };
}

/** True when a slot already carries a mark, so nothing new can be learnt from it. */
export function slotUsed(s: RutherfordState, slot: number): boolean {
  return s.probes.some((p) => p.slot === slot || (p.outcome.kind === 'pass' && p.outcome.exit === slot));
}

/** Fires a probe from a slot; null when the slot is used up or the puzzle is over. */
export function fire(s: RutherfordState, slot: number): RutherfordState | null {
  if (s.won || slot < 0 || slot >= SLOTS || slotUsed(s, slot)) return null;
  const next = cloneRutherford(s);
  const { outcome, track } = trace(s.nucleus, slot);
  const label = outcome.kind === 'pass' ? s.probes.filter((p) => p.outcome.kind === 'pass').length + 1 : 0;
  next.probes.push({ slot, outcome, track, label });
  next.moves += 1;
  return next;
}

/** Flips the player's mark on a cell; null when the puzzle is over. */
export function toggle(s: RutherfordState, cell: Cell): RutherfordState | null {
  if (s.won || !inside(cell)) return null;
  const next = cloneRutherford(s);
  const i = cell.r * SIZE + cell.c;
  next.marks[i] = !next.marks[i];
  return next;
}

export function markedCount(s: RutherfordState): number {
  return s.marks.filter(Boolean).length;
}

export function canSubmit(s: RutherfordState): boolean {
  return !s.won && markedCount(s) === s.nucleus.length;
}

/** Submits the marked cells as the guess; null unless exactly the nucleus's size is marked. */
export function submit(s: RutherfordState): RutherfordState | null {
  if (!canSubmit(s)) return null;
  const next = cloneRutherford(s);
  next.moves += 1;
  if (s.nucleus.every((n) => s.marks[n.r * SIZE + n.c])) next.won = true;
  else next.wrong += 1;
  return next;
}

export const solved = (s: RutherfordState): boolean => s.won;

// ---- generation ---------------------------------------------------------------------

/** Cells in the nucleus for an element: two for the lightest, five from the heaviest. */
export function nucleusSize(z: number): number {
  return 2 + Math.min(3, Math.floor(z / 30));
}

function growNucleus(rng: Rng, size: number): Cell[] {
  const cells: Cell[] = [{ r: randInt(rng, SIZE), c: randInt(rng, SIZE) }];
  while (cells.length < size) {
    const base = pick(rng, cells);
    const dirs = [{ r: 1, c: 0 }, { r: -1, c: 0 }, { r: 0, c: 1 }, { r: 0, c: -1 }];
    const d = pick(rng, dirs);
    const next = { r: base.r + d.r, c: base.c + d.c };
    if (!inside(next) || cells.some((x) => same(x, next))) continue;
    cells.push(next);
  }
  return cells.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** What every slot reports, as one string: two nuclei with the same signature cannot be told apart. */
export function signature(nucleus: Cell[]): string {
  const parts: string[] = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    const o = trace(nucleus, slot).outcome;
    parts.push(o.kind === 'pass' ? String(o.exit) : o.kind[0]);
  }
  return parts.join(',');
}

/** Every connected set of `size` cells in the box, as sorted cell lists. */
export function connectedSets(size: number): Cell[][] {
  const key = (cells: Cell[]) => cells.map((c) => c.r * SIZE + c.c).sort((a, b) => a - b).join('.');
  let layer = new Map<string, Cell[]>();
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) layer.set(key([{ r, c }]), [{ r, c }]);
  for (let k = 1; k < size; k++) {
    const next = new Map<string, Cell[]>();
    for (const cells of layer.values()) {
      for (const base of cells) {
        for (const d of [{ r: 1, c: 0 }, { r: -1, c: 0 }, { r: 0, c: 1 }, { r: 0, c: -1 }]) {
          const n = { r: base.r + d.r, c: base.c + d.c };
          if (!inside(n) || cells.some((x) => same(x, n))) continue;
          const grown = [...cells, n];
          const kk = key(grown);
          if (!next.has(kk)) next.set(kk, grown);
        }
      }
    }
    layer = next;
  }
  return [...layer.values()].map((cells) => cells.sort((a, b) => a.r - b.r || a.c - b.c));
}

const signatureCache = new Map<number, Map<string, number>>();

/** How many connected nuclei of that size share a nucleus's signature. */
export function lookalikes(nucleus: Cell[]): number {
  const size = nucleus.length;
  let counts = signatureCache.get(size);
  if (!counts) {
    counts = new Map();
    for (const set of connectedSets(size)) {
      const sig = signature(set);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    signatureCache.set(size, counts);
  }
  return counts.get(signature(nucleus)) ?? 1;
}

/**
 * A level for element z: a connected nucleus that the full set of probes pins
 * down uniquely, so a careful player can always deduce it.
 */
export function newRutherford(z: number, seed: number): RutherfordState {
  const rng: Rng = seeded(seed);
  const size = nucleusSize(z);
  let nucleus = growNucleus(rng, size);
  for (let tries = 0; tries < 200 && lookalikes(nucleus) > 1; tries++) nucleus = growNucleus(rng, size);
  return { nucleus, probes: [], marks: Array(SIZE * SIZE).fill(false), wrong: 0, moves: 0, par: size + 3, won: false };
}
