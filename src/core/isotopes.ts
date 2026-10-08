// Isotopes of hydrogen to neon, with half-lives and main decay modes.
// Values transcribed by hand from standard nuclide tables (IAEA LiveChart / NNDC);
// they are close enough for the prototype and will be replaced by a generated
// dataset before release.

export type DecayMode = 'beta-' | 'beta+' | 'ec' | 'alpha' | 'n' | 'p';

export interface Isotope {
  z: number;
  a: number;
  /** Half-life in seconds; undefined means stable. */
  halfLife?: number;
  mode?: DecayMode;
  note?: string;
}

const YEAR = 365.25 * 24 * 3600;
const DAY = 24 * 3600;
const MIN = 60;

export const ISOTOPES: Isotope[] = [
  { z: 1, a: 1 },
  { z: 1, a: 2, note: 'Deuterium: one proton, one neutron.' },
  { z: 1, a: 3, halfLife: 12.32 * YEAR, mode: 'beta-', note: 'Tritium glows in self-lit watch dials.' },
  { z: 1, a: 4, halfLife: 1.39e-22, mode: 'n' },

  { z: 2, a: 3, note: 'Helium-3 is rare on Earth but blown onto the Moon by the solar wind.' },
  { z: 2, a: 4, note: 'The alpha particle itself.' },
  { z: 2, a: 5, halfLife: 7.0e-22, mode: 'n' },
  { z: 2, a: 6, halfLife: 0.807, mode: 'beta-' },
  { z: 2, a: 8, halfLife: 0.119, mode: 'beta-' },

  { z: 3, a: 4, halfLife: 9.1e-23, mode: 'p' },
  { z: 3, a: 5, halfLife: 3.7e-22, mode: 'p' },
  { z: 3, a: 6 },
  { z: 3, a: 7 },
  { z: 3, a: 8, halfLife: 0.8394, mode: 'beta-', note: 'Becomes beryllium-8, which instantly splits in two.' },
  { z: 3, a: 9, halfLife: 0.1783, mode: 'beta-' },

  { z: 4, a: 7, halfLife: 53.22 * DAY, mode: 'ec' },
  { z: 4, a: 8, halfLife: 8.19e-17, mode: 'alpha', note: 'Splits into two alpha particles. Stars must leap past it to make carbon.' },
  { z: 4, a: 9 },
  { z: 4, a: 10, halfLife: 1.387e6 * YEAR, mode: 'beta-' },
  { z: 4, a: 11, halfLife: 13.76, mode: 'beta-' },

  { z: 5, a: 8, halfLife: 0.77, mode: 'beta+' },
  { z: 5, a: 10 },
  { z: 5, a: 11 },
  { z: 5, a: 12, halfLife: 0.0202, mode: 'beta-' },
  { z: 5, a: 13, halfLife: 0.01736, mode: 'beta-' },

  { z: 6, a: 10, halfLife: 19.3, mode: 'beta+' },
  { z: 6, a: 11, halfLife: 20.36 * MIN, mode: 'beta+', note: 'Used in PET scans of the brain.' },
  { z: 6, a: 12, note: 'The standard that defines the atomic mass unit.' },
  { z: 6, a: 13 },
  { z: 6, a: 14, halfLife: 5700 * YEAR, mode: 'beta-', note: 'The clock behind radiocarbon dating.' },
  { z: 6, a: 15, halfLife: 2.449, mode: 'beta-' },

  { z: 7, a: 13, halfLife: 9.965 * MIN, mode: 'beta+' },
  { z: 7, a: 14 },
  { z: 7, a: 15 },
  { z: 7, a: 16, halfLife: 7.13, mode: 'beta-' },
  { z: 7, a: 17, halfLife: 4.17, mode: 'beta-' },

  { z: 8, a: 14, halfLife: 70.6, mode: 'beta+' },
  { z: 8, a: 15, halfLife: 122.2, mode: 'beta+' },
  { z: 8, a: 16 },
  { z: 8, a: 17 },
  { z: 8, a: 18, note: 'Its share in ancient ice records past temperatures.' },
  { z: 8, a: 19, halfLife: 26.9, mode: 'beta-' },

  { z: 9, a: 17, halfLife: 64.5, mode: 'beta+' },
  { z: 9, a: 18, halfLife: 109.77 * MIN, mode: 'beta+', note: 'The most common tracer in PET scans.' },
  { z: 9, a: 19 },
  { z: 9, a: 20, halfLife: 11.07, mode: 'beta-' },

  { z: 10, a: 18, halfLife: 1.67, mode: 'beta+' },
  { z: 10, a: 19, halfLife: 17.22, mode: 'beta+' },
  { z: 10, a: 20 },
  { z: 10, a: 21 },
  { z: 10, a: 22 },
  { z: 10, a: 23, halfLife: 37.24, mode: 'beta-' },
];

export function isotopeKey(z: number, a: number): string {
  return `${z}-${a}`;
}

export function findIsotope(z: number, a: number): Isotope | undefined {
  return ISOTOPES.find((i) => i.z === z && i.a === a);
}

export function isotopesOf(z: number): Isotope[] {
  return ISOTOPES.filter((i) => i.z === z);
}

export function isStable(i: Isotope): boolean {
  return i.halfLife === undefined;
}

/** Fleeting isotopes live less than a second: they are witnessed, never kept. */
export function isFleeting(i: Isotope): boolean {
  return i.halfLife !== undefined && i.halfLife < 1;
}

export interface DecayResult {
  daughter: { z: number; a: number };
  emitted: ('electron' | 'positron' | 'alpha' | 'neutron' | 'proton' | 'neutrino')[];
}

export function decayProducts(i: Isotope): DecayResult | null {
  switch (i.mode) {
    case 'beta-':
      return { daughter: { z: i.z + 1, a: i.a }, emitted: ['electron', 'neutrino'] };
    case 'beta+':
      return { daughter: { z: i.z - 1, a: i.a }, emitted: ['positron', 'neutrino'] };
    case 'ec':
      return { daughter: { z: i.z - 1, a: i.a }, emitted: ['neutrino'] };
    case 'alpha':
      return { daughter: { z: i.z - 2, a: i.a - 4 }, emitted: ['alpha'] };
    case 'n':
      return { daughter: { z: i.z, a: i.a - 1 }, emitted: ['neutron'] };
    case 'p':
      return { daughter: { z: i.z - 1, a: i.a - 1 }, emitted: ['proton'] };
    default:
      return null;
  }
}

/**
 * Sample when a single atom decays. Radioactive decay is memoryless, so one atom's
 * lifetime follows an exponential distribution whose median is the half-life.
 */
export function sampleLifetime(halfLife: number, random: () => number = Math.random): number {
  const u = random();
  return (-Math.log(1 - u) * halfLife) / Math.LN2;
}

export const MODE_LABEL: Record<DecayMode, string> = {
  'beta-': 'β⁻ decay',
  'beta+': 'β⁺ decay',
  ec: 'electron capture',
  alpha: 'alpha decay',
  n: 'neutron emission',
  p: 'proton emission',
};

/** Human-readable duration across 45 orders of magnitude. */
export function formatDuration(seconds: number): string {
  if (seconds >= YEAR * 1e6) return `${trim(seconds / YEAR / 1e6)} million years`;
  if (seconds >= YEAR) return `${trim(seconds / YEAR)} years`;
  if (seconds >= DAY * 2) return `${trim(seconds / DAY)} days`;
  if (seconds >= 3600 * 2) return `${trim(seconds / 3600)} hours`;
  if (seconds >= MIN * 2) return `${trim(seconds / MIN)} minutes`;
  if (seconds >= 1) return `${trim(seconds)} s`;
  if (seconds >= 1e-3) return `${trim(seconds * 1e3)} ms`;
  const exp = Math.floor(Math.log10(seconds));
  const mant = seconds / 10 ** exp;
  return `${mant.toFixed(1)}×10${superscript(exp)} s`;
}

function trim(x: number): string {
  if (x >= 100) return Math.round(x).toLocaleString('en-GB');
  return Number(x.toPrecision(3)).toString();
}

export function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map((c) => map[c] ?? c).join('');
}
