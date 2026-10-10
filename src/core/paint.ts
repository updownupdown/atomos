// Every atom's color: the player's paint once they choose one, else a color of its own taken
// from its place in the periodic table. The long 32-column table (the f block in its own
// columns) picks the hue, so neighbours in a row shade into each other and each group shares
// a family hue; the row picks the lightness. No two atoms share a column and a row, so no two
// share a color.

import { elementAt } from '../gallery/data';
import type { SaveData } from './save';

/** Silver: the paint that leaves the atom in its own orbital colors. */
export const SILVER = '#e8e2d4';

/** The atom's column in the 32-column table, 1 to 32. */
export function tableColumn(z: number): number {
  const el = elementAt(z);
  if (el.block === 'f') return 3 + z - (el.period === 6 ? 58 : 90);
  const g = el.group ?? 3;
  return g <= 2 ? g : g + 14;
}

/** The atom's own color before the player paints it. */
export function tableColour(z: number): string {
  const el = elementAt(z);
  const hue = (20 + ((tableColumn(z) - 1) / 31) * 310) % 360;
  const light = 0.74 - (el.period - 1) * 0.025;
  return hslToHex(hue, 0.6, light);
}

/** The color the atom shows in: its paint, or its own table color. */
export function atomColour(z: number, save: Pick<SaveData, 'built'>): string {
  return save.built[z]?.colour ?? tableColour(z);
}

export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
