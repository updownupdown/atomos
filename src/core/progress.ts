// How far each atom's Build has got, for the Build page, the mode row and the gallery.
//
// An atom is built from two puzzles, in either order: its nucleus and its electrons. Once it is
// built, its isotope vault opens: one Packing board for each isotope worth keeping. Completion
// counts all of them, so 100% means everything there is to build for that atom.

import { elementAt, type Isotope } from '../gallery/data';
import { isotopeKey } from './isotopes';
import { loadSave, type SaveData, type StepId } from './save';

export interface StepState {
  done: boolean;
  flawless: boolean;
  best?: number;
}

/** Most isotopes a vault holds, so heavy atoms stay a sensible size. */
const VAULT_MAX = 6;
const DAY = 86400;

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

/** The isotopes in an atom's vault, lightest first: the stable ones and any that last more than
 *  a day, besides the common isotope that comes with the atom. An atom with none of those (the
 *  heaviest ones) gets its two longest-lived. */
export function vaultIsotopes(z: number): Isotope[] {
  const el = elementAt(z);
  const others = el.isotopes.filter((i) => i.a !== el.commonA);
  let pick = others.filter((i) => i.stable || (i.halfLife !== null && i.halfLife > DAY));
  pick.sort((x, y) => (x.stable !== y.stable ? (x.stable ? -1 : 1) : x.stable ? (y.abundance ?? 0) - (x.abundance ?? 0) : (y.halfLife ?? 0) - (x.halfLife ?? 0)));
  if (!pick.length) pick = others.filter((i) => i.halfLife !== null).sort((x, y) => (y.halfLife ?? 0) - (x.halfLife ?? 0)).slice(0, 2);
  return pick.slice(0, VAULT_MAX).sort((x, y) => x.a - y.a);
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
    ...vaultIsotopes(z).map((i): Segment => ({ kind: 'isotope', id: String(i.a), label: `${el.symbol}-${i.a}`, done: isotopeCollected(save, z, i.a) })),
  ];
}

/** The share of everything there is to build for this atom that is done, from 0 to 1. */
export function atomProgress(z: number, save: SaveData = loadSave()): number {
  const segs = segmentsOf(z, save);
  return segs.length ? segs.filter((s) => s.done).length / segs.length : 0;
}
