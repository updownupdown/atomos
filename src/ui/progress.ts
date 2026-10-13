// Progress marks shared by the Build page and the component library: the rings at the foot of
// an atom (nucleus, electrons, isotopes), a ring around an icon and five difficulty pips.

import { icon, type IconName } from './icons';

/** Nucleus disc, electron ring and, when the atom has isotopes, an outer ring of two arcs (lasting
 *  then fleeting, clockwise from the top) sized by their counts, with a gap between them. A small
 *  group keeps a fifth of the ring so it stays visible beside a large one. Arcs have round ends;
 *  a part that is complete is green, one under way white. The outer ring is the fleeting ring's
 *  size (fleetingRing), and the disc and rings sit with equal gaps between them. */
export function progressRings(o: { nucleus: boolean; shells: boolean; lasting: { built: number; total: number }; fleeting: { built: number; total: number } }, size = 40): string {
  // In a 40-unit box: outer ring at 17 (as fleetingRing), electron ring at 9.5, disc of 4.5,
  // rings 5 thick, so every gap is 2.5.
  const c = 20, gap = 0.09, w = 5, R = 17;
  const arc = (r: number, from: number, to: number, cls: string): string => {
    if (to - from <= 0.0001) return '';
    if (to - from >= 0.9999) return `<circle class="${cls}" cx="${c}" cy="${c}" r="${r}" stroke-width="${w}" />`;
    const pt = (t: number) => `${(c + r * Math.sin(t * 2 * Math.PI)).toFixed(2)} ${(c - r * Math.cos(t * 2 * Math.PI)).toFixed(2)}`;
    return `<path class="${cls}" d="M ${pt(from)} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${pt(to)}" stroke-width="${w}" />`;
  };
  const groups = [o.lasting, o.fleeting].filter((g) => g.total > 0);
  const sum = groups.reduce((a, g) => a + g.total, 0);
  let shares = groups.map((g) => g.total / sum);
  if (shares.length === 2) shares = shares.map((x) => Math.min(0.8, Math.max(0.2, x)));
  let outer = '';
  let at = 0;
  const free = 1 - (groups.length > 1 ? gap * groups.length : 0);
  groups.forEach((g, i) => {
    const span = shares[i] * free;
    const from = at + (groups.length > 1 ? gap / 2 : 0);
    outer += arc(R, from, from + span, 'rg-track') + arc(R, from, from + span * (g.built / g.total), g.built >= g.total ? 'rg-on is-done' : 'rg-on');
    at = from + span + (groups.length > 1 ? gap / 2 : 0);
  });
  return `<svg class="bh-rings-svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">
    ${outer}
    <circle class="${o.shells ? 'rg-on is-done' : 'rg-track'}" cx="${c}" cy="${c}" r="9.5" stroke-width="${w}" />
    <circle class="${o.nucleus ? 'rg-fill-on' : 'rg-fill'}" cx="${c}" cy="${c}" r="4.5" />
  </svg>`;
}

/** A difficulty dial (1 to 100, twenty per pip) as five pips, as HTML. */
export function pipsHtml(dial: number, cls = 'bh-pips'): string {
  const on = Math.min(5, Math.max(1, Math.ceil(dial / 20)));
  return `<span class="${cls}" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** The fleeting isotopes' own ring, the size of the electron ring in progressRings: a track and
 *  an arc for the share built, green once all are. */
export function fleetingRing(built: number, total: number, size = 40): string {
  const p = total ? Math.max(0, Math.min(1, built / total)) : 0;
  const done = total > 0 && built >= total;
  return `<svg class="bh-rings-svg bh-fleet-ring" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">
    <circle class="rg-track" cx="20" cy="20" r="17" stroke-width="5" />
    ${p > 0 ? `<circle class="rg-on${done ? ' is-done' : ''}" cx="20" cy="20" r="17" stroke-width="5" pathLength="100" stroke-dasharray="${(p * 100).toFixed(2)} 100" transform="rotate(-90 20 20)" />` : ''}
  </svg>`;
}

/** A ring around an icon for one share of progress (the Build page's Stable and Fleeting): a
 *  gray track, an arc for the share from the top, white while under way and green once whole. */
export function iconRing(share: number, glyph: IconName, size = 44): string {
  const p = Math.max(0, Math.min(1, share));
  const done = p >= 1;
  return `<span class="icon-ring${done ? ' is-done' : ''}" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 44 44" width="${size}" height="${size}">
      <circle class="ir-track" cx="22" cy="22" r="20" stroke-width="3" />
      ${p > 0 ? `<circle class="ir-on" cx="22" cy="22" r="20" stroke-width="3" pathLength="100" stroke-dasharray="${(p * 100).toFixed(2)} 100" transform="rotate(-90 22 22)" />` : ''}
    </svg>${icon(glyph, { size: Math.round(size * 0.64) })}</span>`;
}
