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
  /** Nu, the guide, flies and speaks; off leaves only its still icon on Next. */
  nu: boolean;
}

export interface Built {
  /** Both puzzles solved cleanly: no spoiled fusion, shells settled at or under par. */
  flawless: boolean;
  colour?: string;
}

/** One Build step of one atom: its nucleus puzzle or its electrons puzzle. */
export interface StepRecord {
  /** Solved without a spoiled move: no fusion past the target, or at or under par. */
  flawless: boolean;
  /** Fewest moves it has been solved in. */
  best?: number;
}

export type StepId = 'nucleus' | 'shells';

/** The orbital shapes Glyph discovers; s is known from the start. */
export type OrbitalShape = 'p' | 'd' | 'f';

export interface ShapeRecord {
  /** When it was discovered (ms). */
  at: number;
  /** Fewest moves it has been solved in. */
  best?: number;
}

export interface UnlockRecord extends ShapeRecord {
  /** The element the puzzle was dealt for, so a replay is the same board. */
  z: number;
}

export interface SaveData {
  version: 1;
  built: Record<number, Built>;
  /** Build steps solved so far, per atom. An atom in `built` has both, even if not listed here. */
  steps: Record<number, Partial<Record<StepId, StepRecord>>>;
  /** Isotopes by "z-A": built (collected), witnessed decays, and for a fleeting isotope the
   *  puzzle it was last built with (catalog id), for display only. */
  isotopes: Record<string, { collected?: boolean; witnessed?: WitnessRecord[]; game?: string }>;
  /** Orbital shapes discovered with Glyph; the 3D Shapes view draws only these (and s). */
  shapes: Partial<Record<OrbitalShape, ShapeRecord>>;
  /** Rows of the table opened with Inertia, by row number (2 to 7); row 1 is open from the start. */
  rows: Partial<Record<number, ShapeRecord>>;
  /** Parts of the gallery opened with a gate puzzle (Lumen, Aurum, Glyph), by unlock id. */
  unlocks: Record<string, UnlockRecord>;
  specimens: Specimen[];
  log: { at: number; text: string }[];
  settings: Settings;
  /** First-time lines already shown and acted on, by id, with when (src/ui/nu.ts). */
  seenLines: Record<string, number>;
}

const KEY = 'atomos.save.v1';

export function defaultSave(): SaveData {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    version: 1,
    built: {},
    steps: {},
    isotopes: {},
    shapes: {},
    rows: {},
    unlocks: {},
    specimens: [],
    log: [],
    seenLines: {},
    settings: { unlockAll: false, reducedMotion: reduced, sound: true, haptics: true, nu: true },
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
    const steps: SaveData['steps'] = {};
    for (const [z, rec] of Object.entries(data.steps ?? {})) {
      const out: Partial<Record<StepId, StepRecord>> = {};
      for (const id of ['nucleus', 'shells'] as StepId[]) {
        const r = rec?.[id];
        if (!r) continue;
        out[id] = { flawless: Boolean(r.flawless), ...(Number.isFinite(r.best) ? { best: r.best } : {}) };
      }
      if (Object.keys(out).length) steps[Number(z)] = out;
    }
    const shapes: SaveData['shapes'] = {};
    for (const l of ['p', 'd', 'f'] as OrbitalShape[]) {
      const r = data.shapes?.[l];
      if (r && Number.isFinite(r.at)) shapes[l] = { at: r.at, ...(Number.isFinite(r.best) ? { best: r.best } : {}) };
    }
    const rows: SaveData['rows'] = {};
    for (let n = 2; n <= 7; n++) {
      const r = data.rows?.[n];
      if (r && Number.isFinite(r.at)) rows[n] = { at: r.at, ...(Number.isFinite(r.best) ? { best: r.best } : {}) };
    }
    const unlocks: SaveData['unlocks'] = {};
    for (const [id, r] of Object.entries(data.unlocks ?? {})) {
      if (r && Number.isFinite(r.at) && Number.isFinite(r.z)) unlocks[id] = { at: r.at, z: r.z, ...(Number.isFinite(r.best) ? { best: r.best } : {}) };
    }
    return { ...base, built, steps, shapes, rows, unlocks, isotopes: data.isotopes ?? {}, specimens: data.specimens ?? [], log: data.log ?? [], settings, seenLines: seenLinesOf(data.seenLines) };
  } catch {
    return defaultSave();
  }
}

/** Keeps only well-formed entries: id → timestamp. */
function seenLinesOf(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (Number.isFinite(v)) out[k] = v as number;
  return out;
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
