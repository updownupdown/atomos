// What a locked period needs before its atoms can be built, and when fleeting isotopes show.
// Periods (rows of the table) open by progress: two thirds of the period above built
// (src/core/progress.ts rowNeed). Locked atoms stay viewable everywhere.

import { atomBuilt, rowNeed, rowOf, rowOpen } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';

/** How many more atoms the period above needs before this atom's period opens, or null when
 *  it is open already. */
export function periodNeed(z: number, save: SaveData = loadSave()): { period: number; more: number } | null {
  const row = rowOf(z);
  if (rowOpen(row, save)) return null;
  const { built, need } = rowNeed(row, save);
  return { period: row, more: Math.max(1, need - built) };
}

const atoms = (n: number) => `${n} more atom${n === 1 ? '' : 's'}`;

/** "Opens after 1 more atom in Period 1" for an atom whose period is shut, else null. With
 *  `short`, "Opens after 1 more in Period 1", for a list row. */
export function rowLockNote(z: number, save: SaveData = loadSave(), short = false): string | null {
  const p = periodNeed(z, save);
  if (!p) return null;
  return `Opens after ${short ? `${p.more} more` : atoms(p.more)} in Period ${p.period - 1}`;
}

/** "Period 2 opens after 1 more atom in Period 1.", for the locked-atom sheet. */
export function periodSentence(z: number, save: SaveData = loadSave()): string | null {
  const p = periodNeed(z, save);
  return p && `Period ${p.period} opens after ${atoms(p.more)} in Period ${p.period - 1}.`;
}

/** Fleeting isotopes open once any atom is built; until then their counts stay out of sight. */
export function fleetingOpen(save: SaveData = loadSave()): boolean {
  if (save.settings.unlockAll || Object.keys(save.built).length) return true;
  for (let z = 1; z <= 118; z++) if (atomBuilt(z, save)) return true;
  return false;
}
