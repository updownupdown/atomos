// Testing aid: fill the save to a share of the whole game, to see how screens look at 0%, 25%,
// 50% and 100%. Settings offers it in place of the old "Unlock every element" switch.

import { LOOKS, lensUnlock } from '../gallery/looks';
import { MAX_Z } from './elements';
import { isotopeKey } from './isotopes';
import { ROW_START, SHAPE_AT, stepsOf, vaultIsotopes } from './progress';
import { elementAt } from '../gallery/data';
import type { OrbitalShape, SaveData } from './save';
import type { UnlockId } from './unlocks';

export const PROGRESS_PRESETS = [0, 25, 50, 100] as const;
export type ProgressPreset = (typeof PROGRESS_PRESETS)[number];

/** Every gallery unlock, in the order a player would roughly come to them. */
export function allUnlocks(): UnlockId[] {
  const lenses = (['spiral', 'table', 'ribbon', 'circle'] as const).map(lensUnlock).filter((id): id is UnlockId => id !== null);
  const looks = LOOKS.map((l) => (l.id === 'block' ? null : (`look:${l.id}` as UnlockId))).filter((id): id is UnlockId => id !== null);
  const order: (UnlockId | undefined)[] = [lenses[0], 'nucleus-view', looks[0], lenses[1], ...looks.slice(1)];
  return order.filter((id): id is UnlockId => Boolean(id));
}

/**
 * Rewrites the progress in a save to `pct` percent of the game, keeping settings: the first
 * share of the elements built with their isotope vaults (every other one flawless), the next
 * atom half built so "in progress" shows too, the rows and orbital shapes those atoms reach,
 * and the same share of the gallery unlocks. 0 clears progress; 100 opens everything.
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
    for (const a of [elementAt(z).commonA, ...vaultIsotopes(z).map((i) => i.a)]) out.isotopes[isotopeKey(z, a)] = { collected: true };
  }
  if (n > 0 && n < MAX_Z) out.steps[n + 1] = { nucleus: { flawless: true, best: 10 } };
  const reach = Math.min(MAX_Z, n + 1);
  ROW_START.forEach((first, i) => { if (i > 0 && n > 0 && first <= reach) out.rows[i + 1] = { at: now }; });
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
