// What a player earns besides atoms: new ways of seeing the Atlas, and the nucleus view. Every
// fact and page stays open to everyone; these only add ways to look.
//
//   lens:<shape>       an Atlas shape, opened by building every atom of a period:
//                      Ribbon 2, Spiral 3, Circle 4, Sizes 5, Steps 6, Pyramid 7
//   look:<color>       an Atlas color, opened by the first win of its game anywhere (SHOWN_BY)
//   nucleus-view       the nucleus up close, opened by Aurum, Rutherford's game
//   toy:timelapse      the Atlas's history time-lapse, opened by Glyph
//
// A color, the nucleus view or the time-lapse can also be won on the spot with a short gate
// puzzle of its game (src/puzzles/unlock.ts), which records save.unlocks[id]. Anything a save
// already holds there stays open: shapes and colors used to be opened one by one with Glyph.
// Glyph also opens the three orbital shapes on the Build pages of B, Sc and Ce (save.shapes).

import { atomGame } from './atomGames';
import { atomBuilt, isotopeCollected, isotopeGame, lastingIsotopes, rowOf, rowOpen, rowSpan, stepsOf, stepState } from './progress';
import { loadSave, type SaveData } from './save';
import { winsOf } from './wins';

export type UnlockId = `lens:${string}` | 'nucleus-view' | `look:${string}` | `toy:${string}`;

/** The period whose last atom opens each earned shape. Table and Details are open from the start. */
export const SHAPE_PERIOD: Record<string, number> = { ribbon: 2, spiral: 3, circle: 4, sizes: 5, steps: 6, pyramid: 7 };

/** The game whose first win opens each color, the nucleus view and the time-lapse. Place is open
 *  from the start. */
export const SHOWN_BY: Record<string, string> = {
  'look:block': 'orbitalGrid',
  'look:melt': 'merge',
  'look:density': 'packing',
  'look:state': 'sliding',
  'look:electronegativity': 'lines',
  'look:size': 'rutherford',
  'look:crust': 'slideStop',
  'look:discovery': 'light',
  'look:model': 'colorCharge',
  'nucleus-view': 'rutherford',
  'toy:timelapse': 'codebreaker',
};

/** The puzzle that opens an unlock on the spot: its game, or Glyph for a shape (whose gate
 *  puzzles only replay boards from saves that opened them that way). */
export function unlockPuzzle(id: UnlockId): string {
  return SHOWN_BY[id] ?? 'codebreaker';
}

/** Whether a game has been won anywhere: a Puzzles win, or any atom step or lasting isotope built
 *  with it, or a fleeting isotope built with it. */
export function gameWon(game: string, save: SaveData = loadSave()): boolean {
  if (winsOf(game).some((l) => l.solved > 0)) return true;
  for (let z = 1; z <= 118; z++) {
    if (save.steps[z] || save.built[z]) {
      for (const step of stepsOf(z)) if (atomGame(z, step) === game && stepState(save, z, step).done) return true;
    }
  }
  // A fleeting isotope records the game it was built with; a lasting one has a fixed game.
  for (const [key, r] of Object.entries(save.isotopes)) {
    if (!r.collected) continue;
    if (r.game === game) return true;
    const [z, a] = key.split('-').map(Number);
    if (isotopeGame(z, a) === game) return true;
  }
  return false;
}

/** Every atom of a period built. */
export function periodBuilt(period: number, save: SaveData = loadSave()): boolean {
  const [first, last] = rowSpan(period);
  for (let z = first; z <= last; z++) if (!atomBuilt(z, save)) return false;
  return true;
}

/** How far a period is built: atoms built and atoms in it. */
export function periodCount(period: number, save: SaveData = loadSave()): { built: number; total: number } {
  const [first, last] = rowSpan(period);
  let built = 0;
  for (let z = first; z <= last; z++) if (atomBuilt(z, save)) built++;
  return { built, total: last - first + 1 };
}

/** Whether an unlock is open: earned, solved once, or everything opened in Settings. */
export function isUnlocked(id: UnlockId, save: SaveData = loadSave()): boolean {
  if (save.settings.unlockAll || save.unlocks[id]) return true;
  if (id.startsWith('lens:')) {
    const p = SHAPE_PERIOD[id.slice(5)];
    return p === undefined || periodBuilt(p, save);
  }
  const game = SHOWN_BY[id];
  return game ? gameWon(game, save) : id.startsWith('look:');
}

/** The next atom to build for a period: its first unbuilt atom whose row is open, or else the
 *  first unbuilt atom of an open row below it. Null once it is all built. */
export function nextForPeriod(period: number, save: SaveData = loadSave()): number | null {
  const [, last] = rowSpan(period);
  for (let z = 1; z <= last; z++) if (!atomBuilt(z, save) && rowOpen(rowOf(z), save)) return z;
  return null;
}

/** Where a player next meets a game while building: the first atom in an open row with a step or
 *  a lasting isotope still to build with it. Null when building will not bring it up soon
 *  (Lumen is only ever picked for a fleeting isotope). */
export function nextMeeting(game: string, save: SaveData = loadSave()): number | null {
  for (let z = 1; z <= 118; z++) {
    if (!rowOpen(rowOf(z), save)) continue;
    for (const step of stepsOf(z)) if (atomGame(z, step) === game && !stepState(save, z, step).done) return z;
    for (const i of lastingIsotopes(z)) if (isotopeGame(z, i.a) === game && !isotopeCollected(save, z, i.a)) return z;
  }
  return null;
}

/** The elements Glyph is dealt for, one per display unlock in the order they are opened. The
 *  orbital shapes take three fixed rungs (SHAPE_GLYPH_Z); the gallery unlocks climb the rest. */
const LADDER = [104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 115, 117];
export const SHAPE_GLYPH_Z: Record<'p' | 'd' | 'f', number> = { p: 104, d: 108, f: 112 };
const GLYPH_FROM = LADDER[0];
/** A gentle board for the other games' gate puzzles: the first atom each one builds. */
const GATE_Z: Record<string, number> = { orbitalGrid: 1, merge: 2, lines: 2, packing: 3, colorCharge: 3, slideStop: 4, rutherford: 5, light: 6, sliding: 27 };

/** The element an unlock's puzzle is dealt for: the same board on a replay. Glyph's boards climb
 *  a rung for each Glyph unlock already opened; the other games deal their first atom's board. */
export function unlockZ(id: UnlockId, save: SaveData = loadSave()): number {
  const game = unlockPuzzle(id);
  const prev = save.unlocks[id];
  if (game !== 'codebreaker') return prev?.z ?? GATE_Z[game] ?? 6;
  if (prev) return Math.max(GLYPH_FROM, prev.z);
  const rungs = LADDER.filter((z) => !Object.values(SHAPE_GLYPH_Z).includes(z));
  // Only Glyph's own unlocks climb its ladder.
  const done = Object.keys(save.unlocks).filter((k) => unlockPuzzle(k as UnlockId) === 'codebreaker' || save.unlocks[k].z >= GLYPH_FROM).length;
  return rungs[Math.min(done, rungs.length - 1)];
}
