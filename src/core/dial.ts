// Tune: a dial that sets the electron's energy, with the atom's allowed levels as marks on it.
//
// The dial reads energy as a fraction of the ionisation energy of the orbital being filled,
// so the marks sit at their true spacing: 1 - 1/n² for a hydrogen-like level, crowding
// together toward the ionisation limit at 1.0. That crowding is real and is the challenge.
// A real atom absorbs only at these energies; off a line, nothing happens.

import type { Level } from './physics';
import type { PullReading } from './tuning';

/** Top of the dial, as a fraction of the ionisation energy. Past 1.0 the electron is free. */
export const DIAL_MAX = 1.08;
/** How much of a turn the dial covers, in radians. */
export const SWEEP = (Math.PI * 3) / 2;
/**
 * The dial's zero, in screen radians (0 is right, positive is clockwise). The scale runs
 * clockwise from the right, under the atom and up its left side, so the crowded top of the
 * scale and the ionisation limit sit at the top left, clear of the energy ladder on the right.
 */
export const DIAL_START = 0;
/** Resonance (glow and hum) is felt this many half-widths out from a line. */
export const FEEL = 4;

export interface DialLine {
  n: number;
  /** Position on the dial, a fraction of the ionisation energy. */
  v: number;
  /** Half-width of the band in which the line is hit. */
  half: number;
}

/** Marks on the dial for an energy ladder. Bands shrink for higher levels and never touch. */
export function dialLines(groundEnergy: number, levels: Level[]): DialLine[] {
  const ie = -groundEnergy;
  const vs = levels.map((l) => (l.energy - groundEnergy) / ie);
  return levels.map((l, i) => {
    const prev = i > 0 ? vs[i - 1] : 0;
    const next = i + 1 < vs.length ? vs[i + 1] : 1;
    const gap = Math.min(vs[i] - prev, next - vs[i]);
    const half = Math.min(0.024 - 0.003 * i, 0.38 * gap);
    return { n: l.n, v: vs[i], half };
  });
}

/** What firing at dial value v would do. */
export function readDial(v: number, lines: DialLine[]): PullReading {
  if (lines.length === 0 || v < 0.02) return { kind: 'none' };
  if (v >= 1) return { kind: 'free' };
  for (const l of lines) {
    if (Math.abs(v - l.v) <= l.half) return { kind: 'level', n: l.n, precision: 1 - Math.abs(v - l.v) / l.half };
  }
  let below: number | null = null, above: number | null = null;
  for (const l of lines) {
    if (l.v < v) below = l.n;
    else if (above === null) above = l.n;
  }
  return { kind: 'between', below, above };
}

/** How strongly the atom responds at v: 1 on a line, fading to 0 a few half-widths away. */
export function resonance(v: number, lines: DialLine[]): number {
  let best = 0;
  for (const l of lines) {
    const d = Math.abs(v - l.v) / (l.half * FEEL);
    if (d < 1) best = Math.max(best, 1 - d * d);
  }
  return best;
}

/** Screen angle of the needle for dial value v. */
export function dialAngle(v: number): number {
  return DIAL_START + (Math.max(0, Math.min(DIAL_MAX, v)) / DIAL_MAX) * SWEEP;
}

/**
 * Move the dial by a finger turning round the centre. A finger further out turns it more
 * finely, like holding the rim of a big wheel: at the dial's own radius one full sweep
 * covers the whole range, at twice that radius it covers half.
 */
export function turnDial(v: number, dAngle: number, r: number, dialRadius: number): number {
  const gain = dialRadius / Math.max(r, dialRadius * 0.5);
  return Math.max(0, Math.min(DIAL_MAX, v + (dAngle / SWEEP) * DIAL_MAX * gain));
}
