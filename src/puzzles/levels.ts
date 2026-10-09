// Which puzzle an element asks for, and the seed that makes its level the same
// for everyone. Merge builds nuclei up to iron; past iron the nucleus puzzle
// changes to a sliding block (not built yet). Shell Rings settles every element.

import { element } from '../core/elements';
import { newMerge, type MergeState } from './merge';
import { newRings, type RingsState } from './rings';

export const MERGE_UP_TO = 26;

export function mergeLevel(z: number): MergeState {
  const el = element(z);
  return newMerge({ z, a: el.commonA }, 7919 * z + 101);
}

export function ringsLevel(z: number): RingsState {
  return newRings(z, 104729 * z + 7);
}
