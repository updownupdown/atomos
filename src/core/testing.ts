// Testing aid: fill the save to a share of the whole game, to see how screens look at 0%, 25%,
// 50% and 100%. Settings offers it in place of the old "Unlock every element" switch.

import { MAX_Z } from './elements';
import { isotopeKey } from './isotopes';
import { fleetingIsotopes, lastingIsotopes, SHAPE_AT, stepsOf } from './progress';
import { elementAt } from '../gallery/data';
import type { OrbitalShape, SaveData } from './save';
import type { UnlockId } from './unlocks';

export const PROGRESS_PRESETS = [0, 25, 50, 100] as const;
export type ProgressPreset = (typeof PROGRESS_PRESETS)[number];

/** Every display unlock a gate puzzle opens, in the order a player would roughly come to them.
 *  The Atlas's views and colors are open to everyone; the orbital shapes are counted apart. */
export function allUnlocks(): UnlockId[] {
  return ['nucleus-view'];
}

/**
 * Rewrites the progress in a save to `pct` percent of the game, keeping settings: the first
 * share of the elements built with their lasting isotopes (every other one flawless) and the
 * same share of each one's fleeting isotopes, the next atom half built so "in progress" shows
 * too, the orbital shapes those atoms reach, and the same share of the gallery unlocks. Rows
 * open by themselves from what is built. 0 clears progress; 100 opens everything.
 */
export function applyProgressPreset(save: SaveData, pct: ProgressPreset): SaveData {
  const now = Date.now();
  const n = Math.round((pct / 100) * MAX_Z);
  const out: SaveData = { ...save, built: {}, steps: {}, isotopes: {}, shapes: {}, rows: {}, unlocks: {}, specimens: [], log: [] };
  out.settings = { ...save.settings, unlockAll: false };
  for (let z = 1; z <= n; z++) {
    const flawless = z % 2 === 1;
    out.built[z] = { flawless };
    out.steps[z] = Object.fromEntries(stepsOf(z).map((id) => [id, { flawless, best: 10 }]));
    for (const a of [elementAt(z).commonA, ...lastingIsotopes(z).map((i) => i.a)]) out.isotopes[isotopeKey(z, a)] = { collected: true };
    const fleeting = fleetingIsotopes(z);
    for (const i of fleeting.slice(0, Math.round((pct / 100) * fleeting.length))) out.isotopes[isotopeKey(z, i.a)] = { collected: true, game: 'packing' };
  }
  if (n > 0 && n < MAX_Z) out.steps[n + 1] = { nucleus: { flawless: true, best: 10 } };
  for (const l of Object.keys(SHAPE_AT) as OrbitalShape[]) if (n > 0 && SHAPE_AT[l] <= n) out.shapes[l] = { at: now };
  const unlocks = allUnlocks();
  unlocks.slice(0, Math.round((pct / 100) * unlocks.length)).forEach((id) => (out.unlocks[id] = { at: now, z: 1 }));
  return out;
}

/** The preset a save matches, judged by how many elements are built, or null. */
export function currentPreset(save: SaveData): ProgressPreset | null {
  const built = Object.keys(save.built).length;
  return PROGRESS_PRESETS.find((p) => Math.round((p / 100) * MAX_Z) === built) ?? null;
}
