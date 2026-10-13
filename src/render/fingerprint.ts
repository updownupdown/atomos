// An atom's fingerprint: the artistic choices that make each atom in the collection look and
// move like itself. None of it is physics (atoms have no color), but it is all seeded by the
// atom, and loosely tied to what it is, so the collection reads as a zoo rather than noise:
//   - palette: a base hue from the atom's place in the table (its group, or its place in
//     the lanthanide or actinide row) with a little jitter; a color scheme picked by the seed;
//     saturation rising with electronegativity;
//   - tempo: lighter atoms (lower periods) beat faster;
//   - rhythm: an eight-step accent pattern; the spotlight dwells a few beats per step;
//   - order: how the spotlight walks the orbitals (outward, inward, a subshell at a time,
//     shuffled, back and forth);
//   - breathing depth, and what a tap does.

import type { Element } from '../gallery/data';
import { mulberry32 } from '../gallery/orbital';
import { hsl, type OrbitalSet } from './orbitalCloud';

export type Scheme = 'Analogous' | 'Complementary' | 'Triadic' | 'Split' | 'Tetradic';
export type Order = 'Outward' | 'Inward' | 'Chords' | 'Shuffle' | 'Pendulum';
export type TapStyle = 'Ripple' | 'Bloom' | 'Skip' | 'Scatter';

type RGB = [number, number, number];

export interface Fingerprint {
  seed: number;
  scheme: Scheme;
  /** Palette hues (0 to 1). */
  hues: number[];
  swatches: RGB[];
  /** Each orbital's colors: positive lobes, negative lobes. */
  colors: [RGB, RGB][];
  bpm: number;
  /** Beats the spotlight stays on each step. */
  dwell: number;
  /** Eight steps: 0 rest, 1 accent, 2 strong accent. */
  pattern: number[];
  order: Order;
  /** The spotlight's steps: groups of orbital indices. */
  steps: number[][];
  tap: TapStyle;
  breath: number;
  /** A color for flashes and ripples. */
  accent: RGB;
}

const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

function schemeHues(base: number, scheme: Scheme): number[] {
  switch (scheme) {
    case 'Analogous': return [base, base + 0.07, base - 0.07, base + 0.14];
    case 'Complementary': return [base, base + 0.5, base + 0.04, base + 0.54];
    case 'Triadic': return [base, base + 1 / 3, base + 2 / 3];
    case 'Split': return [base, base + 0.42, base + 0.58];
    case 'Tetradic': return [base, base + 0.25, base + 0.5, base + 0.75];
  }
}

/** Where the atom sits on the color wheel: its group across the table, or for the f block
 *  its place along the lanthanides or actinides. */
function baseHue(e: Element): number {
  if (e.group) return (0.58 + ((e.group - 1) / 18) * 0.85) % 1;
  const first = e.z >= 89 ? 89 : 57;
  return (0.82 + ((e.z - first) / 15) * 0.16) % 1;
}

const seedOf = (e: Element) => (e.z * 2654435761) >>> 0;

/** The atom's palette: the first draws from its seed, so the fingerprint and subshellColors()
 *  agree. */
function paletteOf(e: Element, r: () => number): { scheme: Scheme; hues: number[]; sat: number; light: number } {
  const scheme = pick<Scheme>(r, ['Analogous', 'Complementary', 'Triadic', 'Split', 'Tetradic']);
  const hue = baseHue(e) + (r() - 0.5) * 0.08;
  const hues = schemeHues(hue, scheme).map((h) => ((h % 1) + 1) % 1);
  const en = e.electronegativity ?? 1.6;
  const sat = Math.max(0.45, Math.min(0.92, 0.5 + ((en - 0.7) / 3.3) * 0.4 + (r() - 0.5) * 0.1));
  const light = 0.55 + r() * 0.08;
  return { scheme, hues, sat, light };
}

/** Each subshell's color in the atom's palette, as its first orbital takes it in the
 *  fingerprint, keyed by subshell ('3d'): for pictures drawn without sampling the orbitals. */
export function subshellColors(e: Element): Record<string, RGB> {
  const { hues, sat, light } = paletteOf(e, mulberry32(seedOf(e)));
  const subs = [...e.subshells].sort((a, b) => a.meanRadius - b.meanRadius);
  const outer = Math.max(...subs.map((s) => s.meanRadius));
  return Object.fromEntries(subs.map((s, si) => [s.key, hsl(hues[si % hues.length], sat, Math.min(0.72, light + (1 - s.meanRadius / outer) * 0.08))]));
}

export function atomFingerprint(e: Element, set: OrbitalSet): Fingerprint {
  const seed = seedOf(e);
  const r = mulberry32(seed);
  const { scheme, hues, sat, light } = paletteOf(e, r);
  const swatches = hues.map((h) => hsl(h, sat, light));

  // Each orbital takes a pair of palette hues for its two signs, shifted along the palette by
  // subshell and by m, so neighbours differ; inner shells run a touch lighter.
  const colors = set.orbitals.map((o): [RGB, RGB] => {
    const a = (o.sub + o.mIndex) % hues.length;
    // Close palettes take the far end of the palette for the other sign, and the other sign
    // always runs darker, so the lobes' phase still reads.
    const step = scheme === 'Analogous' ? 2 : 1 + (o.sub % Math.max(1, hues.length - 1));
    const b = (a + step) % hues.length;
    const jitter = (r() - 0.5) * 0.03;
    const l = Math.min(0.72, light + (1 - o.r90 / set.r90) * 0.08);
    return [hsl(hues[a] + jitter, sat, l), hsl(hues[b === a ? (a + 1) % hues.length : b] - jitter, sat * 0.95, l * 0.78)];
  });

  const bpm = Math.round(46 + (8 - e.period) * 7 + (r() - 0.5) * 10);
  const dwell = 2 + Math.floor(r() * 3);
  const pattern = Array.from({ length: 8 }, (_, i) => (i === 0 ? 2 : r() < 0.08 ? 2 : r() < 0.35 ? 1 : 0));
  // The spotlight walks the orbitals big enough to show their shape at the atom's scale; the
  // small inner ones beat together once a cycle, as the atom's heart.
  const big = set.orbitals.filter((o) => o.r90 >= set.r90 * 0.3);
  const core = set.orbitals.filter((o) => o.r90 < set.r90 * 0.3).map((o) => o.index);
  const many = big.length > 12;
  const order = pick<Order>(r, many ? ['Chords', 'Chords', 'Outward', 'Inward', 'Shuffle', 'Pendulum'] : ['Outward', 'Inward', 'Chords', 'Shuffle', 'Pendulum']);
  const idx = big.map((o) => o.index);
  let steps: number[][];
  if (order === 'Chords') {
    const subs = [...new Set(big.map((o) => o.sub))];
    steps = subs.map((s) => big.filter((o) => o.sub === s).map((o) => o.index));
  } else if (order === 'Inward') steps = [...idx].reverse().map((i) => [i]);
  else if (order === 'Shuffle') {
    const sh = [...idx];
    for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    steps = sh.map((i) => [i]);
  } else if (order === 'Pendulum') steps = [...idx, ...[...idx].reverse().slice(1, -1)].map((i) => [i]);
  else steps = idx.map((i) => [i]);
  if (core.length) steps.unshift(core);
  if (!steps.length) steps = [[0]];

  const tap = pick<TapStyle>(r, ['Ripple', 'Bloom', 'Skip', 'Scatter']);
  // Three draws once spent on glints (now gone), kept so every atom's breath stays its own.
  r(); r(); r();
  return {
    seed, scheme, hues, swatches, colors, bpm, dwell, pattern, order, steps, tap,
    breath: 0.01 + r() * 0.035,
    accent: hsl(hues[hues.length - 1], Math.min(1, sat + 0.1), 0.7),
  };
}

/** A palette swatch as CSS. */
export function css(c: RGB): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}
