// Player progress, kept in localStorage for the prototype (cloud save comes later).

export interface Specimen {
  id: string;
  z: number;
  a: number;
  createdAt: number;
  /** When this particular atom will decay, sampled once at creation (ms since epoch). */
  decayAt: number;
}

export interface WitnessRecord {
  at: number;
  seed: number;
  lifetime: number; // seconds this atom actually lived
}

/** How the player launches electrons: pull-back slingshot, drawn wave, or tapped rhythm. */
export type LaunchStyle = 'sling' | 'trace' | 'rhythm';

export interface Settings {
  assist: boolean;
  launch: LaunchStyle;
  reducedMotion: boolean;
  sound: boolean;
  haptics: boolean;
  autoCore: boolean;
}

export interface SaveData {
  version: 1;
  built: Record<number, { perfect: boolean; flawless?: boolean; colour?: string }>;
  discoveredShapes: string[];
  photons: Record<number, number[]>;
  isotopes: Record<string, { collected?: boolean; witnessed?: WitnessRecord[] }>;
  specimens: Specimen[];
  log: { at: number; text: string }[];
  settings: Settings;
}

const KEY = 'atomos.save.v1';

export function defaultSave(): SaveData {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    version: 1,
    built: {},
    discoveredShapes: ['s'],
    photons: {},
    isotopes: {},
    specimens: [],
    log: [],
    settings: { assist: false, launch: 'trace', reducedMotion: reduced, sound: true, haptics: true, autoCore: true },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as SaveData;
    const base = defaultSave();
    return { ...base, ...data, settings: { ...base.settings, ...data.settings } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or storage blocked: progress lasts for this visit only.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The next element the player can build: the lowest one not yet built. */
export function frontier(data: SaveData, maxZ: number): number {
  for (let z = 1; z <= maxZ; z++) if (!data.built[z]) return z;
  return maxZ;
}
