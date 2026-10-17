// Scores in Nu's park, drawn as tiny atoms rather than numbers: each whole point is an
// electron, filling shells as a real atom's do (2, 8, 8, 18, 18, 32, 32), round a nucleus, so 10
// points (a par run, points.ts) is a neon, 12 a magnesium. The tenths show as the next electron,
// faint in proportion. Only circles and rings, like the logo. The number stays in the label.

import { fmt } from './points';

const SHELLS = [2, 8, 8, 18, 18, 32, 32];

/** The atom for `pts` points, `size` px across. `tone` colors the electrons (the text color by
 *  default); `ring` adds a ring round it (a new best). */
export function atomSvg(pts: number, size = 44, o: { tone?: string; ring?: string; label?: string } = {}): string {
  const whole = Math.max(0, Math.floor(pts + 1e-6)), frac = Math.max(0, pts - whole);
  // Shells in use: enough for the electrons, and at least one so a zero still looks like an atom.
  let left = whole + (frac > 0.05 ? 1 : 0), used = 0;
  const counts: number[] = [];
  while (left > 0 && used < SHELLS.length) { const n = Math.min(SHELLS[used], left); counts.push(n); left -= n; used++; }
  if (!counts.length) counts.push(0);
  const n = counts.length, R = 20, nuc = 3.6, step = (R - nuc - 2.5) / Math.max(1, n);
  const tone = o.tone ?? 'currentColor';
  let body = `<circle cx="22" cy="22" r="${nuc}" fill="${tone}"/>`;
  let k = 0;
  counts.forEach((c, i) => {
    const r = nuc + 2.5 + step * (i + 1) - 0.4;
    body += `<circle cx="22" cy="22" r="${r.toFixed(2)}" fill="none" stroke="${tone}" stroke-opacity="0.28" stroke-width="1.2"/>`;
    const full = SHELLS[i], dot = Math.max(0.9, Math.min(2.1, (Math.PI * r) / full * 0.55));
    for (let j = 0; j < c; j++) {
      const a = -Math.PI / 2 + (j * 2 * Math.PI) / full + i * 0.4;
      const last = k === whole;
      body += `<circle cx="${(22 + Math.cos(a) * r).toFixed(2)}" cy="${(22 + Math.sin(a) * r).toFixed(2)}" r="${dot.toFixed(2)}" fill="${tone}"${last ? ` fill-opacity="${Math.max(0.2, frac).toFixed(2)}"` : ''}/>`;
      k++;
    }
  });
  if (o.ring) body += `<circle cx="22" cy="22" r="21.2" fill="none" stroke="${o.ring}" stroke-width="1.6"/>`;
  const label = o.label ?? `${fmt(pts)} points`;
  return `<svg class="nu-atom" viewBox="0 0 44 44" width="${size}" height="${size}" role="img" aria-label="${label}">${body}</svg>`;
}
