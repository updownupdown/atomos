// How far each atom's Build has got, for the Build page and the gallery's progress bars.

import { loadSave, type SaveData, type StepId } from './save';

export interface StepState {
  done: boolean;
  flawless: boolean;
  best?: number;
}

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

/** The share of an atom's unlock puzzles solved, from 0 to 1. A built atom is 1. */
export function atomProgress(z: number, save: SaveData = loadSave()): number {
  if (save.built[z]) return 1;
  const steps = stepsOf(z);
  return steps.filter((id) => stepState(save, z, id).done).length / steps.length;
}
