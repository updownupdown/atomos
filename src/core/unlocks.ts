// The parts of the gallery that gate puzzles open. The gallery decides which of its lenses and
// looks start locked and shows them with an Unlock button that calls playUnlock (src/puzzles/
// unlock.ts); this file says which puzzle opens what, and whether it is open yet.
//
//   lens:<layout id>   a gallery arrangement, opened with Lumen
//   nucleus-view       the nucleus up close, opened once with Aurum
//   look:<name>        a way to draw the atoms, opened with Glyph (six in all)

import { loadSave, type SaveData } from './save';

export type UnlockId = `lens:${string}` | 'nucleus-view' | `look:${string}`;

type GateGame = 'light' | 'rutherford' | 'codebreaker';

/** The puzzle that opens an unlock. */
export function unlockPuzzle(id: UnlockId): GateGame {
  if (id.startsWith('lens:')) return 'light';
  if (id.startsWith('look:')) return 'codebreaker';
  return 'rutherford';
}

/** Whether an unlock is open: solved once, or every element unlocked in Settings. */
export function isUnlocked(id: UnlockId, save: SaveData = loadSave()): boolean {
  return save.settings.unlockAll || Boolean(save.unlocks[id]);
}

/** The element each successive solve of a game is dealt for, so each new unlock is a little harder. */
const LADDER: Record<GateGame, number[]> = {
  light: [8, 30, 60, 90, 115],
  rutherford: [40],
  codebreaker: [104, 107, 110, 113, 116, 118],
};

/** The element an unlock's puzzle is dealt for: the same board on a replay, otherwise the next
 *  step up from the unlocks this game has already opened. */
export function unlockZ(id: UnlockId, save: SaveData = loadSave()): number {
  const prev = save.unlocks[id];
  if (prev) return prev.z;
  const game = unlockPuzzle(id);
  const done = Object.keys(save.unlocks).filter((k) => unlockPuzzle(k as UnlockId) === game).length;
  const ladder = LADDER[game];
  return ladder[Math.min(done, ladder.length - 1)];
}
