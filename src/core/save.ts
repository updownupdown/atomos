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

export interface Settings {
  /** Testing aid: every element buildable from the map. */
  unlockAll: boolean;
  reducedMotion: boolean;
  sound: boolean;
  haptics: boolean;
}

export interface Built {
  /** Both puzzles solved cleanly: no spoiled fusion, shells settled at or under par. */
  flawless: boolean;
  colour?: string;
}

export interface SaveData {
  version: 1;
  built: Record<number, Built>;
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
    isotopes: {},
    specimens: [],
    log: [],
    settings: { unlockAll: false, reducedMotion: reduced, sound: true, haptics: true },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<SaveData> & { settings?: Partial<Settings> };
    const base = defaultSave();
    const settings = base.settings;
    for (const k of Object.keys(settings) as (keyof Settings)[]) {
      if (typeof data.settings?.[k] === 'boolean') settings[k] = data.settings[k] as boolean;
    }
    const built: Record<number, Built> = {};
    for (const [z, b] of Object.entries(data.built ?? {})) built[Number(z)] = { flawless: Boolean(b?.flawless), colour: b?.colour };
    return { ...base, built, isotopes: data.isotopes ?? {}, specimens: data.specimens ?? [], log: data.log ?? [], settings };
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
