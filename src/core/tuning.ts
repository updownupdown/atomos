// Capture bands. Pull distance sets the electron's energy, and the atom only catches it
// when that energy sits in a band around one of its allowed levels. Higher levels release
// more light on the way down but their bands are narrower, so they are harder to hit.

/** Pull fractions below this launch nothing. */
export const DEAD_ZONE = 0.12;
/** Pull fractions above this knock an electron out. */
export const FREE = 0.88;
/** Within this fraction of a band's half-width a capture counts as dead centre. */
export const CENTRE = 0.35;

export interface Band {
  n: number;
  lo: number;
  hi: number;
  centre: number;
}

export function captureBands(levels: number[]): Band[] {
  const slot = (FREE - DEAD_ZONE) / levels.length;
  return levels.map((n, i) => {
    const centre = DEAD_ZONE + (i + 0.5) * slot;
    const half = slot * Math.max(0.12, 0.24 - 0.04 * i);
    return { n, lo: centre - half, hi: centre + half, centre };
  });
}

export type PullReading =
  | { kind: 'none' }
  | { kind: 'level'; n: number; precision: number }
  | { kind: 'between'; below: number | null; above: number | null }
  | { kind: 'free' };

/** What a release at pull fraction `power` would do. precision is 1 at a band's centre, 0 at its edge. */
export function readPull(power: number, bands: Band[]): PullReading {
  if (power < DEAD_ZONE || bands.length === 0) return { kind: 'none' };
  if (power > FREE) return { kind: 'free' };
  for (const b of bands) {
    if (power >= b.lo && power <= b.hi) {
      return { kind: 'level', n: b.n, precision: 1 - Math.abs(power - b.centre) / (b.hi - b.centre) };
    }
  }
  let below: number | null = null, above: number | null = null;
  for (const b of bands) {
    if (b.hi < power) below = b.n;
    else if (above === null && b.lo > power) above = b.n;
  }
  return { kind: 'between', below, above };
}

/** The pull fraction at the centre of the band for level n, for assisted launches. */
export function bandCentre(n: number, bands: Band[]): number {
  return bands.find((b) => b.n === n)?.centre ?? bands[0].centre;
}
