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

/** How the player launches electrons: a held charge, a tapped pulse, or a tuned dial. */
export type LaunchStyle = 'charge' | 'pulse' | 'tune';
const STYLES: LaunchStyle[] = ['charge', 'pulse', 'tune'];

export interface Settings {
  assist: boolean;
  launch: LaunchStyle;
  /** How long a Charge press takes to climb the ladder. */
  climb: 'normal' | 'slow';
  /** Beat speed for Pulse. */
  tempo: 'slow' | 'medium' | 'brisk';
  /** Testing aid: every element buildable from the map, p orbital already discovered. */
  unlockAll: boolean;
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
    settings: { assist: false, launch: 'charge', climb: 'normal', tempo: 'medium', unlockAll: false, reducedMotion: reduced, sound: true, haptics: true, autoCore: true },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as SaveData;
    const base = defaultSave();
    const settings = { ...base.settings, ...data.settings };
    // Earlier prototypes saved launch styles that no longer exist.
    if (!STYLES.includes(settings.launch)) settings.launch = base.settings.launch;
    return { ...base, ...data, settings };
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
