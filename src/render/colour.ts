// Colours of light. Visible wavelengths use the usual piecewise approximation of
// spectral colour; light outside the visible band gets a stand-in so it can still
// be drawn, and the interface labels it as invisible.

import { band } from '../core/physics';

export function wavelengthToRgb(nm: number): [number, number, number] {
  const b = band(nm);
  if (b === 'x-ray') return [0.85, 0.9, 1];
  if (b === 'uv') return [0.62, 0.45, 1];
  if (b === 'ir') return [0.75, 0.12, 0.08];
  let r = 0, g = 0, bl = 0;
  if (nm < 440) { r = -(nm - 440) / 60; bl = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; bl = 1; }
  else if (nm < 510) { g = 1; bl = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else { r = 1; }
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (750 - nm)) / 50;
  const gamma = (c: number) => (c <= 0 ? 0 : Math.pow(c * f, 0.8));
  return [gamma(r), gamma(g), gamma(bl)];
}

export function wavelengthToHex(nm: number): string {
  const [r, g, b] = wavelengthToRgb(nm);
  const h = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function bandLabel(nm: number): string {
  switch (band(nm)) {
    case 'x-ray': return 'X-ray';
    case 'uv': return 'ultraviolet';
    case 'ir': return 'infrared';
    default: return 'visible';
  }
}
