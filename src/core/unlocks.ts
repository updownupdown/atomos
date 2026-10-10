// The parts of the gallery that a puzzle opens. The gallery decides which of its lenses and
// looks start locked and shows them with an Unlock button that calls playUnlock (src/puzzles/
// unlock.ts); this file says which puzzle opens what, and whether it is open yet. Glyph opens
// every display unlock (the three orbital shapes on the Build pages of B, Sc and Ce too):
//
//   lens:<layout id>   a gallery arrangement
//   nucleus-view       the nucleus up close
//   look:<name>        a way to draw the atoms (six in all)

import { loadSave, type SaveData } from './save';

export type UnlockId = `lens:${string}` | 'nucleus-view' | `look:${string}`;

type GateGame = 'codebreaker';

/** The puzzle that opens an unlock: Glyph, for every one. */
export function unlockPuzzle(_id: UnlockId): GateGame {
  return 'codebreaker';
}

/** Whether an unlock is open: solved once, or every element unlocked in Settings. */
export function isUnlocked(id: UnlockId, save: SaveData = loadSave()): boolean {
  return save.settings.unlockAll || Boolean(save.unlocks[id]);
}

/** The elements Glyph is dealt for, one per display unlock in the order they are opened. The
 *  orbital shapes take three fixed rungs (SHAPE_GLYPH_Z); the gallery unlocks climb the rest. */
const LADDER = [104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 117];
export const SHAPE_GLYPH_Z: Record<'p' | 'd' | 'f', number> = { p: 104, d: 108, f: 112 };
const GLYPH_FROM = LADDER[0];

/** The element an unlock's puzzle is dealt for: the same board on a replay, otherwise the next
 *  rung up from the unlocks already opened. Unlocks opened with Lumen or Aurum before Glyph took
 *  them over were dealt lighter elements; their replays move up to Glyph's range. */
export function unlockZ(id: UnlockId, save: SaveData = loadSave()): number {
  const prev = save.unlocks[id];
  if (prev) return Math.max(GLYPH_FROM, prev.z);
  const rungs = LADDER.filter((z) => !Object.values(SHAPE_GLYPH_Z).includes(z));
  const done = Object.keys(save.unlocks).length;
  return rungs[Math.min(done, rungs.length - 1)];
}
