// Where the player was when they left: the screen, the atom and its mode. The shell saves it
// on every move and reopens it on the next visit; anything it cannot use means the gallery.

export type Screen = 'gallery' | 'atom' | 'puzzles' | 'settings' | 'icons';
export type PlaceMode = 'view' | 'build';

export interface Place { screen: Screen; mode: PlaceMode; z: number }

const SCREENS: Screen[] = ['gallery', 'atom', 'puzzles', 'settings', 'icons'];
const HOME: Place = { screen: 'gallery', mode: 'view', z: 1 };

/** Read a saved place, falling back to the gallery when it is missing or no longer valid. */
export function readPlace(raw: string | null): Place {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || !SCREENS.includes(v.screen)) return { ...HOME };
    const z = Number.isInteger(v.z) && v.z >= 1 && v.z <= 118 ? (v.z as number) : null;
    if (v.screen === 'atom' && z === null) return { ...HOME };
    return { screen: v.screen, mode: v.mode === 'build' ? 'build' : 'view', z: z ?? 1 };
  } catch {
    return { ...HOME };
  }
}
