// What a locked row needs before its atoms can be built. Rows open by progress: two thirds of
// the row above built (src/core/progress.ts rowNeed). Locked atoms stay viewable everywhere.

import { rowNeed, rowOf, rowOpen } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';

/** "Build 3 more atoms in row 2 to open it." for an atom whose row is shut, else null. */
export function rowLockNote(z: number, save: SaveData = loadSave(), short = false): string | null {
  const row = rowOf(z);
  if (rowOpen(row, save)) return null;
  const { built, need } = rowNeed(row, save);
  const more = Math.max(1, need - built);
  return short
    ? `Build ${more} more in row ${row - 1}`
    : `Build ${more} more atom${more === 1 ? '' : 's'} in row ${row - 1} to open it.`;
}
