// The puzzle that builds each atom's nucleus and electrons, from the committed table that
// src/core/assign.ts writes (src/data/atom-games.json).

import TABLE from '../data/atom-games.json';
import type { AtomStep } from './assign';

const ROWS = TABLE as Record<string, { nucleus?: string; shells: string }>;

/** The catalog id of the puzzle for one step of an atom: Tokamak and Quanta when the table has
 *  no entry (it covers every element, so only out-of-range elements fall back). */
export function atomGame(z: number, step: AtomStep): string {
  return ROWS[z]?.[step] ?? (step === 'nucleus' ? 'merge' : 'orbitalGrid');
}
