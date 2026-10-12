// Where the player was when they left: the screen, the atom and its mode. The shell saves it
// on every move; the next visit opens on Collect, on that atom's period. Anything it cannot use
// means Collect.

export type Screen = 'gallery' | 'collect' | 'atom' | 'puzzles' | 'settings' | 'icons' | 'components';
export type PlaceMode = 'view' | 'build' | 'info';

export interface Place { screen: Screen; mode: PlaceMode; z: number }

const SCREENS: Screen[] = ['gallery', 'collect', 'atom', 'puzzles', 'settings', 'icons', 'components'];
const HOME: Place = { screen: 'collect', mode: 'view', z: 1 };

/** Read a saved place, falling back to Collect when it is missing or no longer valid. */
export function readPlace(raw: string | null): Place {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || !SCREENS.includes(v.screen)) return { ...HOME };
    const z = Number.isInteger(v.z) && v.z >= 1 && v.z <= 118 ? (v.z as number) : null;
    if (v.screen === 'atom' && z === null) return { ...HOME };
    return { screen: v.screen, mode: v.mode === 'build' || v.mode === 'info' ? v.mode : 'view', z: z ?? 1 };
  } catch {
    return { ...HOME };
  }
}
