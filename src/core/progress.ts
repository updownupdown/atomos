// How far each atom's Build has got, for the Build page, the mode row and the gallery.
//
// An atom is built from two puzzles, in either order: its nucleus (Tokamak) and its electrons
// (Quanta). Once it is built, its isotopes open, in two groups. Lasting isotopes (stable, or
// with a half-life over a year) each have a fixed puzzle and count toward the atom's 100%.
// Fleeting isotopes (everything shorter) have their own count: the player picks any isotope
// puzzle for each, and once built they stay in the collection, shown as decayed.

import { elementAt, type Isotope } from '../gallery/data';
import ISOTOPE_GAMES from '../data/isotope-games.json';
import { isotopeKey } from './isotopes';
import { loadSave, type OrbitalShape, type SaveData, type StepId } from './save';

export interface StepState {
  done: boolean;
  flawless: boolean;
  best?: number;
}

const YEAR = 3.156e7;

/** Where one Build step of an atom stands. Hydrogen's nucleus is a lone proton, so it is done
 *  from the start; an atom built before steps were saved counts both steps as done. */
export function stepState(save: SaveData, z: number, id: StepId): StepState {
  if (id === 'nucleus' && z === 1) return { done: true, flawless: true };
  const r = save.steps[z]?.[id];
  if (r) return { done: true, ...r };
  const b = save.built[z];
  return b ? { done: true, flawless: b.flawless } : { done: false, flawless: false };
}

/** The Build steps that need a puzzle on this atom: hydrogen has only its electrons. */
export function stepsOf(z: number): StepId[] {
  return z === 1 ? ['shells'] : ['nucleus', 'shells'];
}

/** An isotope that counts toward its atom's 100%: stable, or with a half-life over a year. */
export function isLasting(i: Isotope): boolean {
  return i.stable || (i.halfLife !== null && i.halfLife > YEAR);
}

/** An atom's lasting isotopes, lightest first, besides the common one that comes with the atom.
 *  Each has a fixed puzzle (isotopeGame). 33 atoms have none; tin has the most, ten. */
export function lastingIsotopes(z: number): Isotope[] {
  const el = elementAt(z);
  return el.isotopes.filter((i) => i.a !== el.commonA && isLasting(i)).sort((x, y) => x.a - y.a);
}

/** An atom's fleeting isotopes, lightest first: every other known isotope. They have their own
 *  count, never hold back the 100%, and the player picks the puzzle for each. */
export function fleetingIsotopes(z: number): Isotope[] {
  const el = elementAt(z);
  return el.isotopes.filter((i) => i.a !== el.commonA && !isLasting(i)).sort((x, y) => x.a - y.a);
}

/** Kept for screens written before lasting and fleeting isotopes: the lasting ones. */
export const vaultIsotopes = lastingIsotopes;

/** The puzzles that build isotopes. A lasting isotope has one of the first six, fixed in
 *  src/data/isotope-games.json so retuning never reshuffles a board; a fleeting one can be
 *  built with any of them, Lumen and Tokamak included. */
export const ISOTOPE_GAMES_LIST = ['packing', 'colorCharge', 'lines', 'sliding', 'slideStop', 'rutherford', 'light', 'merge'] as const;
export type IsotopeGame = (typeof ISOTOPE_GAMES_LIST)[number];

const GAME_OF = ISOTOPE_GAMES as Record<string, IsotopeGame>;

/** The puzzle a lasting isotope is built with, or null for one that is not lasting. */
export function isotopeGame(z: number, a: number): IsotopeGame | null {
  return GAME_OF[`${z}-${a}`] ?? null;
}

/** The element a fleeting isotope's board is dealt for: the shorter its half-life, the harder
 *  the board. Unmeasured half-lives deal hardest. To be tuned in playtesting. */
export function fleetingDealZ(z: number, i: Isotope): number {
  const t = i.halfLife;
  const bump = t === null ? 40 : t > 86400 ? 0 : t > 3600 ? 8 : t > 1 ? 16 : t > 1e-3 ? 24 : 32;
  return Math.min(118, z + bump);
}

/** An atom's fleeting isotopes built so far, out of how many there are. */
export function fleetingCount(z: number, save: SaveData = loadSave()): { built: number; total: number } {
  const all = fleetingIsotopes(z);
  return { built: all.filter((i) => isotopeCollected(save, z, i.a)).length, total: all.length };
}

/** Fleeting isotopes built across the whole table, out of how many there are. */
export function fleetingTotal(save: SaveData = loadSave()): { built: number; total: number } {
  let built = 0;
  let total = 0;
  for (let z = 1; z <= 118; z++) {
    const c = fleetingCount(z, save);
    built += c.built;
    total += c.total;
  }
  return { built, total };
}

/** Lasting isotopes built across the whole table, out of how many there are (294). */
export function lastingTotal(save: SaveData = loadSave()): { built: number; total: number } {
  let built = 0;
  let total = 0;
  for (let z = 1; z <= 118; z++) {
    for (const i of lastingIsotopes(z)) {
      total++;
      if (isotopeCollected(save, z, i.a)) built++;
    }
  }
  return { built, total };
}

/** A built fleeting isotope stays in the collection but shows as decayed. Derived, not stored. */
export function isDecayed(z: number, i: Isotope, save: SaveData = loadSave()): boolean {
  return !isLasting(i) && isotopeCollected(save, z, i.a);
}

export function isotopeCollected(save: SaveData, z: number, a: number): boolean {
  return Boolean(save.isotopes[isotopeKey(z, a)]?.collected);
}

export interface Segment {
  kind: 'step' | 'isotope';
  id: string;
  label: string;
  done: boolean;
}

/** Everything there is to build for an atom, in the suggested order, with what is done. */
export function segmentsOf(z: number, save: SaveData = loadSave()): Segment[] {
  const el = elementAt(z);
  return [
    ...stepsOf(z).map((id): Segment => ({ kind: 'step', id, label: id === 'nucleus' ? 'Nucleus' : 'Electrons', done: stepState(save, z, id).done })),
    ...lastingIsotopes(z).map((i): Segment => ({ kind: 'isotope', id: String(i.a), label: `${el.symbol}-${i.a}`, done: isotopeCollected(save, z, i.a) })),
  ];
}

/** The share of everything there is to build for this atom that is done, from 0 to 1. */
export function atomProgress(z: number, save: SaveData = loadSave()): number {
  const segs = segmentsOf(z, save);
  return segs.length ? segs.filter((s) => s.done).length / segs.length : 0;
}

/** Where each orbital shape is discovered: the first atom with an electron in it. Glyph runs there. */
export const SHAPE_AT: Record<OrbitalShape, number> = { p: 5, d: 21, f: 58 };

/** The orbital shape discovered on this atom's Build page, if any. */
export function shapeAt(z: number): OrbitalShape | undefined {
  return (Object.keys(SHAPE_AT) as OrbitalShape[]).find((l) => SHAPE_AT[l] === z);
}

/** Whether the 3D Shapes view may draw this kind of orbital: s always; p, d and f once Glyph has
 *  discovered them (or with "Unlock every element" on). Changes fire 'atomos:progress'. */
export function orbitalShapeUnlocked(l: 's' | OrbitalShape, save: SaveData = loadSave()): boolean {
  return l === 's' || save.settings.unlockAll || Boolean(save.shapes[l]);
}

/** The first atom of each row of the table, row 1 first. Each later row opens by progress. */
export const ROW_START = [1, 3, 11, 19, 37, 55, 87];

/** The row (period) of the table an atom sits in, 1 to 7. */
export function rowOf(z: number): number {
  let row = 1;
  ROW_START.forEach((start, i) => { if (z >= start) row = i + 1; });
  return row;
}

/** The first and last atom of a row. */
export function rowSpan(row: number): [number, number] {
  return [ROW_START[row - 1], row < ROW_START.length ? ROW_START[row] - 1 : 118];
}

/** An atom whose nucleus and electrons are both done. */
export function atomBuilt(z: number, save: SaveData = loadSave()): boolean {
  return stepsOf(z).every((id) => stepState(save, z, id).done);
}

/** How many atoms of the row above are built, and how many a row needs to open: two thirds of
 *  the row above, rounded down (row 2: 1 of 2; rows 3 and 4: 5 of 8; rows 5 and 6: 12 of 18;
 *  row 7: 21 of 32). Row 1 needs nothing. */
export function rowNeed(row: number, save: SaveData = loadSave()): { built: number; need: number } {
  if (row <= 1) return { built: 0, need: 0 };
  const [first, last] = rowSpan(row - 1);
  let built = 0;
  for (let z = first; z <= last; z++) if (atomBuilt(z, save)) built++;
  return { built, need: Math.floor((2 / 3) * (last - first + 1)) };
}

/** Whether a row's atoms can be built. Row 1 always can; a later row once two thirds of the row
 *  above is built. A row opened with the old Inertia gate, or where something was built before
 *  rows were gated, stays open, so no save loses an atom it could build. */
export function rowOpen(row: number, save: SaveData = loadSave()): boolean {
  if (row <= 1 || save.settings.unlockAll || save.rows[row]) return true;
  const [first, last] = rowSpan(row);
  for (let z = first; z <= last; z++) if (save.built[z] || save.steps[z]) return true;
  const { built, need } = rowNeed(row, save);
  return built >= need;
}
