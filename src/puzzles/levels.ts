// The seeds that make each atom's build boards the same for everyone, for the atoms whose
// nucleus is Tokamak's (merge) or whose electrons are Quanta's (orbital grid).

import { element } from '../core/elements';
import { newMerge, type MergeState } from './merge';
import { newOrbitalGrid, type OrbitalGridState } from './orbitalGrid';

export function mergeLevel(z: number): MergeState {
  const el = element(z);
  return newMerge({ z, a: el.commonA }, 7919 * z + 101);
}

export function orbitalGridLevel(z: number): OrbitalGridState {
  return newOrbitalGrid(z, 104729 * z + 7);
}
