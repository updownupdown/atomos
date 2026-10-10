// Looks: ways to color the gallery's tiles by what the elements are like. "Block" (the orbital
// strip) is always there; the other six are opened one by one with Glyph (src/core/unlocks.ts).
// Each look turns an element into a shade from 0 to 1, or a category, or nothing when the value
// is unknown. Lenses (the arrangements) are gated the same way, with Glyph.

import type { Element } from './data';
import type { LayoutId } from './layouts';
import type { UnlockId } from '../core/unlocks';

export type LookId = 'block' | 'state' | 'discovery' | 'electronegativity' | 'size' | 'crust' | 'density';

/** What a tile shows under a look: a shade (0 to 1), a category, or nothing known. */
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
    id: 'discovery', label: 'Discovery', blurb: 'When each element was found, from antiquity to this century.', low: 'Antiquity', high: 'Today',
    value: (e) => ({ v: e.discoveryYear == null ? 0 : clamp((e.discoveryYear - 1600) / (2010 - 1600)) }),
  },
  {
    id: 'electronegativity', label: 'Electron pull', blurb: 'How strongly an atom pulls on shared electrons (Pauling scale).', low: 'Weak', high: 'Strong',
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

/** The unlock that opens a look, or null when it is open from the start. */
export const lookUnlock = (id: LookId): UnlockId | null => (id === 'block' ? null : `look:${id}`);

/** The arrangements open from the start; the others are opened with Glyph. */
const OPEN_LENSES: LayoutId[] = ['spiral', 'table'];
export const lensUnlock = (id: LayoutId): UnlockId | null => (OPEN_LENSES.includes(id) ? null : `lens:${id}`);
