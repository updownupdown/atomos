// Color by: the ways to color the Atlas maps and the Details plates. "Place" (the period colors
// after Hyde's ribbon chart) is the default; the others color each atom by what it is like. Every
// one is open to everyone (they used to be opened one by one with Glyph). Each look turns an
// element into a shade from 0 to 1, or a category, or nothing when the value is unknown, and
// lookColor turns that into the fill the maps draw.

import { BLOCK_COLOUR, placeColour, type Element } from './data';

export type LookId = 'place' | 'block' | 'state' | 'discovery' | 'melt' | 'density' | 'electronegativity' | 'size' | 'crust';

/** What a cell shows under a look: a shade (0 to 1), a category, or nothing known. */
export type LookValue = { v: number } | { cat: 'solid' | 'liquid' | 'gas' } | null;

export interface Look {
  id: LookId;
  label: string;
  /** One line under the label in the picker. */
  blurb: string;
  /** The two ends of the shade, for the legend. */
  low?: string;
  high?: string;
  value?: (e: Element) => LookValue;
}

const ROOM = 298.15;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const log = (v: number, lo: number, hi: number) => clamp((Math.log10(v) - lo) / (hi - lo));

export const LOOKS: Look[] = [
  { id: 'place', label: 'Place', blurb: "Where each atom sits: the hue follows its group, deeper in later periods, after Hyde's ribbon chart." },
  { id: 'block', label: 'Block', blurb: 'The orbital each element is filling: s, p, d or f.' },
  {
    id: 'state', label: 'State', blurb: 'Solid, liquid or gas at room temperature.',
    value: (e) => {
      // No melting point listed: helium never freezes at normal pressure, and carbon, phosphorus,
      // sulfur, selenium and tin have several solid forms. The boiling point still settles it, and
      // phosphorus (no boiling point listed either) is a solid in every form.
      if (e.z === 15) return { cat: 'solid' };
      if (e.melt == null) return e.boil == null ? null : { cat: e.boil < ROOM ? 'gas' : 'solid' };
      if (e.melt > ROOM) return { cat: 'solid' };
      if (e.boil != null && e.boil > ROOM) return { cat: 'liquid' };
      return e.boil == null ? null : { cat: 'gas' };
    },
  },
  {
    id: 'discovery', label: 'Discovered', blurb: 'When each element was found, from antiquity to this century.', low: 'Antiquity', high: 'Today',
    value: (e) => ({ v: e.discoveryYear == null ? 0 : clamp((e.discoveryYear - 1600) / (2010 - 1600)) }),
  },
  {
    id: 'melt', label: 'Melting point', blurb: 'How hot each element must get to melt.', low: '−273 °C', high: '3600 °C',
    // Helium never freezes at normal pressure, and nothing past fermium has a measured melting point.
    value: (e) => (e.melt == null || e.z > 100 ? null : { v: clamp(e.melt / 3900) }),
  },
  {
    id: 'electronegativity', label: 'Electronegativity', blurb: 'How strongly an atom pulls on shared electrons (Pauling scale).', low: 'Weak', high: 'Strong',
    value: (e) => (e.electronegativity == null ? null : { v: clamp((e.electronegativity - 0.7) / (3.98 - 0.7)) }),
  },
  {
    id: 'size', label: 'Size', blurb: 'How big each atom is (van der Waals radius).', low: 'Small', high: 'Large',
    value: (e) => ({ v: clamp((e.vdw - 110) / (348 - 110)) }),
  },
  {
    id: 'crust', label: 'Abundance', blurb: "How common each element is in Earth's crust.", low: 'Rare', high: 'Common',
    value: (e) => (e.crust == null || e.crust <= 0 ? null : { v: log(e.crust, -4.2, 5.7) }),
  },
  {
    id: 'density', label: 'Density', blurb: 'How heavy a piece of each element is for its size.', low: 'Light', high: 'Dense',
    // Past rutherfordium the densities are predictions, kept out as the Properties tab does.
    value: (e) => (e.density == null || e.z >= 104 ? null : { v: clamp(Math.sqrt(e.density / 22.59)) }),
  },
];

export const isLookId = (id: string | null): id is LookId => LOOKS.some((l) => l.id === id);
export const lookOf = (id: LookId): Look => LOOKS.find((l) => l.id === id)!;

/** The shade ramp for value looks: deep blue through cyan and pale to warm gold. */
export const RAMP = ['#24407a', '#3d7cc4', '#6fd0e6', '#d9e6d4', '#f2b552'];
const STATE_FILL = { solid: '#8a9296', liquid: '#6fd0e6', gas: '#3d5fa8' } as const;
/** The fill for a value nobody has measured. */
export const UNKNOWN_FILL = '#2a2e32';

const hex = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
function mix(a: string, b: string, t: number): string {
  return '#' + [0, 1, 2].map((i) => Math.round(hex(a, i) * (1 - t) + hex(b, i) * t).toString(16).padStart(2, '0')).join('');
}
/** A shade from 0 to 1 along the ramp. */
export function rampColor(v: number): string {
  const t = clamp(v) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t));
  return mix(RAMP[i], RAMP[i + 1], t - i);
}

/** The fill an element gets under a look. */
export function lookColor(id: LookId, e: Element): string {
  if (id === 'place') return placeColour(e);
  if (id === 'block') return BLOCK_COLOUR[e.block];
  const v = lookOf(id).value!(e);
  if (!v) return UNKNOWN_FILL;
  return 'cat' in v ? STATE_FILL[v.cat] : rampColor(v.v);
}

/** The legend under a look: categories as swatches, shades as a ramp between its two ends. */
export function lookLegend(id: LookId): { swatches?: { label: string; color: string }[]; low?: string; high?: string } | null {
  if (id === 'place') return null;
  if (id === 'block') return { swatches: (['s', 'p', 'd', 'f'] as const).map((b) => ({ label: `${b} block`, color: BLOCK_COLOUR[b] })) };
  if (id === 'state') return { swatches: [{ label: 'Solid', color: STATE_FILL.solid }, { label: 'Liquid', color: STATE_FILL.liquid }, { label: 'Gas', color: STATE_FILL.gas }, { label: 'Not known', color: UNKNOWN_FILL }] };
  const l = lookOf(id);
  return { low: l.low, high: l.high };
}

/** Black or white text, whichever reads better on a fill. */
export function inkOn(fill: string): string {
  const lin = [0, 1, 2].map((i) => hex(fill, i) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.18 ? '#0b0c0d' : '#ffffff';
}
