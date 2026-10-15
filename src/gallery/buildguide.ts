// The Build page's guide, behind its microscope: how this atom is built, in the order its page
// runs. One short stretch per part (the nucleus, the electrons, each kind of isotope, then any
// discovery made here), each with a small drawing of what that part is in the real atom and
// a line on what the puzzle for it stands for. No game lore: the puzzles' own rules live in
// their rules sheets.

import { BLOCK_COLOUR, elementAt, formatHalfLife, keyIsotope, shortConfiguration, type Element, type Isotope } from './data';
import { buildOrder } from './visuals';
import { NUCLEON_R, packNucleons, protonMask } from './nucleus';
import { fleetingIsotopes, isotopeCollected, lastingIsotopes, shapeAt, stepState, stepsOf } from '../core/progress';
import type { SaveData } from '../core/save';
import { icon, type IconName } from '../ui/icons';
import { scienceButton } from '../ui/science';
import './buildguide.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const YEAR = 3.156e7;

/** The microscope at the foot of the Build page, as a full-width card. (The science module
 *  relabels it on each screen change; the label here is only until then.) */
export function buildGuideButton(name: string): HTMLButtonElement {
  const b = scienceButton('foot-card bg-open');
  b.innerHTML = `<span class="foot-card-ico">${icon('microscope', { size: 40 })}</span><span class="foot-card-text"><b>Build specs</b></span><span class="foot-card-go">${icon('chevron-right', { size: 22 })}</span>`;
  b.setAttribute('aria-label', `Build specs: how ${esc(name.toLowerCase())} is built`);
  return b;
}

/** The guide's sheet for atom `z`, as far as `save` has built it. */
export function buildGuideHTML(z: number, save: SaveData): string {
  const e = elementAt(z);
  const name = e.name.toLowerCase();
  const lasting = lastingIsotopes(z);
  const stable = lasting.filter((i) => i.stable);
  const longLived = lasting.filter((i) => !i.stable);
  const fleeting = fleetingIsotopes(z);
  const got = (list: Isotope[]) => list.filter((i) => isotopeCollected(save, z, i.a)).length;
  const built = (id: 'nucleus' | 'shells') => (z === 1 && id === 'nucleus') || stepState(save, z, id).done;
  const shape = shapeAt(z);
  let n = 0;
  const step = (ico: IconName, title: string, state: string, done: boolean, figure: string, text: string) => `
    <section class="bg-step${done ? ' is-done' : ''}">
      <div class="bg-head"><span class="bg-num">${++n}</span><span class="bg-ico">${icon(ico, { size: 22 })}</span><h3>${title}</h3><span class="bg-state">${done ? icon('check', { size: 18 }) : ''}${state}</span></div>
      ${figure ? `<figure class="bg-fig">${figure}</figure>` : ''}
      <p>${text}</p>
    </section>`;
  const key = keyIsotope(e);
  const neutrons = key ? key.a - z : Math.round((e.weight ?? z * 2) - z);
  const parts = [
    step('nucleus', 'Nucleus', built('nucleus') ? 'Built' : 'One puzzle', built('nucleus'), nucleusFigure(e, neutrons),
      z === 1
        ? 'A single proton, with nothing to gather round it: hydrogen\'s nucleus is ready from the start.'
        : `${plural(z, 'proton')} and ${plural(neutrons, 'neutron')}, packed into a core a hundred thousand times smaller than the atom. The protons make it ${esc(name)}; the neutrons hold them together. Its puzzle gathers them.`),
    stepsOf(z).includes('shells') ? step('electrons', 'Electrons', built('shells') ? 'Built' : 'One puzzle', built('shells'), electronsFigure(e),
      `${plural(z, 'electron')} fill the orbitals from the lowest energy up, in the order drawn: ${esc(shortConfiguration(e))}. The last ones in, on the outer layer, decide how ${esc(name)} behaves. Its puzzle places them.`) : '',
    stable.length ? step('isotope-stable', 'Stable isotopes', `${got(stable)} of ${stable.length}`, got(stable) === stable.length, isotopeFigure(e, 'stable'),
      `The same ${plural(z, 'proton')} with ${stable.length === 1 ? 'one other' : 'other'} ${stable.length === 1 ? 'number' : 'numbers'} of neutrons that never decay${stable.length === 1 ? `: ${e.symbol}-${stable[0].a}` : `: ${stable.map((i) => `${e.symbol}-${i.a}`).join(', ')}`}. Each is a puzzle of its own, and each counts toward ${esc(name)}'s 100%.`) : '',
    longLived.length ? step('isotope-unstable', 'Long-lived isotopes', `${got(longLived)} of ${longLived.length}`, got(longLived) === longLived.length, isotopeFigure(e, 'long'),
      `${longLived.length === 1 ? 'One decays' : `${longLived.length} decay`}, but so slowly it takes a year or more, often far longer: ${longLived.map((i) => `${e.symbol}-${i.a}`).join(', ')}. ${longLived.length === 1 ? 'It lasts' : 'They last'} long enough to count toward 100%, and to watch on your bench.`) : '',
    fleeting.length ? step('isotope-fleeting', 'Fleeting isotopes', `${got(fleeting)} of ${fleeting.length}`, got(fleeting) === fleeting.length, lifeFigure(e, fleeting),
      `${fleeting.length} more that fall apart within a year${lifeSpan(fleeting)}. Build each with any isotope puzzle: the shorter it lives, the harder its board. Once built it shows as decayed. They fill the rest of ${esc(name)}'s ring but don't count toward its 100%.`) : '',
    shape ? step('unlock', 'Discovery', save.shapes[shape] ? 'Found' : 'One puzzle', Boolean(save.shapes[shape]), '',
      `${esc(e.name)} is the first atom with ${shape} orbitals. Cracking the code here uncovers their shape for the Atlas's 3D views.`) : '',
  ].join('');
  return `<h2 class="bg-title">${icon('microscope', { size: 22 })}<span>Build specs</span></h2>
    <div class="bg">
      <p class="bg-lead">Each part is one puzzle, in the order of its page. The stable parts make up ${esc(name)}'s 100% and set it turning once they are all built; fleeting isotopes fill in the rest of its ring.</p>
      ${parts}
    </div>`;
}

/** The nucleus as its nucleons packed together, protons lit, seen from one side. */
function nucleusFigure(e: Element, neutrons: number): string {
  const a = e.z + neutrons;
  const pts = packNucleons(a, e.z);
  const mask = protonMask(a, e.z, e.z);
  const R = Math.max(...pts.map((p) => p.length())) + NUCLEON_R;
  const order = pts.map((p, i) => ({ p, proton: mask[i] })).sort((x, y) => x.p.z - y.p.z);
  const dots = order.map(({ p, proton }) => `<circle class="${proton ? 'bg-p' : 'bg-n'}" cx="${f1(p.x)}" cy="${f1(-p.y)}" r="${f1(NUCLEON_R * 0.96)}"/>`).join('');
  const size = Math.max(4, R);
  return `<svg class="bg-nucleus" viewBox="${f1(-size)} ${f1(-size)} ${f1(size * 2)} ${f1(size * 2)}" role="img" aria-label="${plural(e.z, 'proton')} and ${plural(neutrons, 'neutron')} packed together">${dots}</svg>
    <figcaption><span><i class="bg-p"></i>${plural(e.z, 'proton')}</span><span><i class="bg-n"></i>${plural(neutrons, 'neutron')}</span></figcaption>`;
}

/** The orbitals in the order they fill, each a chip in its block's color with its electrons as
 *  dots, the ones not yet reached left open. */
function electronsFigure(e: Element): string {
  const chips = buildOrder(e).map((s) => {
    const dots = Array.from({ length: s.capacity / 2 }, (_, i) => {
      const k = s.count >= s.capacity / 2 + i + 1 ? 2 : s.count > i ? 1 : 0;
      return `<i class="is-${k}"></i>`;
    }).join('');
    return `<span class="bg-orb" style="--b:${BLOCK_COLOUR[s.l]}"><b>${s.key}</b><span class="bg-orb-dots">${dots}</span></span>`;
  }).join('<span class="bg-arrow" aria-hidden="true">›</span>');
  return `<div class="bg-orbs" role="img" aria-label="The orbitals in the order they fill: ${esc(buildOrder(e).map((s) => `${s.key} with ${s.count}`).join(', '))}">${chips}</div>
    <figcaption><span><i class="bg-dot is-2"></i>a pair</span><span><i class="bg-dot is-1"></i>one electron</span><span><i class="bg-dot is-0"></i>room for two</span></figcaption>`;
}

/** The known isotopes along the neutron count, the lasting ones lit (stable large, long-lived
 *  smaller), the fleeting ones faint; the section's own kind strongest. */
function isotopeFigure(e: Element, which: 'stable' | 'long'): string {
  const isos = e.isotopes;
  if (!isos.length) return '';
  const n0 = isos[0].a - e.z, n1 = isos[isos.length - 1].a - e.z;
  const W = 320, H = 44, pad = 12, cy = 18;
  const x = (nn: number) => pad + ((nn - n0) / Math.max(1, n1 - n0)) * (W - 2 * pad);
  const dots = isos.map((i) => {
    const kind = i.stable ? 'stable' : i.halfLife !== null && i.halfLife > YEAR ? 'long' : 'fleeting';
    const r = kind === 'stable' ? 6 : kind === 'long' ? 4.5 : 2;
    return `<circle class="bg-iso is-${kind}${kind === which ? ' is-mine' : ''}" cx="${f1(x(i.a - e.z))}" cy="${cy}" r="${r}"><title>${e.symbol}-${i.a}</title></circle>`;
  }).join('');
  const labels = `<text x="${pad}" y="${H - 4}">${n0} neutrons</text><text x="${W - pad}" y="${H - 4}" text-anchor="end">${n1}</text>`;
  return `<svg class="bg-strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Known isotopes from ${n0} to ${n1} neutrons"><path class="bg-base" d="M ${pad} ${cy} H ${W - pad}"/>${dots}${labels}</svg>
    <figcaption><span><i class="bg-dot is-stable"></i>stable</span><span><i class="bg-dot is-long"></i>a year or more</span><span><i class="bg-dot is-fleeting"></i>fleeting</span></figcaption>`;
}

/** The fleeting isotopes on a half-life ruler from a nanosecond to a year, by powers of ten. */
function lifeFigure(e: Element, list: Isotope[]): string {
  const lives = list.filter((i) => i.halfLife !== null && i.halfLife > 0).map((i) => i.halfLife!);
  if (!lives.length) return '';
  const lo = Math.log10(1e-9), hi = Math.log10(YEAR);
  const W = 320, H = 56, pad = 14, y = 20;
  const X = (s: number) => pad + ((Math.max(lo, Math.min(hi, Math.log10(s))) - lo) / (hi - lo)) * (W - 2 * pad);
  const ticks: [number, string][] = [[1e-9, 'ns'], [1e-6, 'µs'], [1e-3, 'ms'], [1, 's'], [60, 'min'], [3600, 'hour'], [86400, 'day'], [YEAR, 'year']];
  const marks = lives.map((s) => `<path class="bg-life" d="M ${f1(X(s))} ${y - 9} V ${y + 9}"/>`).join('');
  return `<svg class="bg-ruler" viewBox="0 0 ${W} ${H}" role="img" aria-label="Half-lives of the fleeting isotopes, from a nanosecond to a year"><rect class="bg-ruler-bar" x="${pad}" y="${y - 3}" width="${W - 2 * pad}" height="6" rx="3"/>${marks}${ticks.map(([t, l]) => `<path class="bg-tick" d="M ${f1(X(t))} ${y + 8} V ${y + 14}"/><text x="${f1(X(t))}" y="${H - 8}">${l}</text>`).join('')}</svg>`;
}

/** ", from 1.2 seconds to 11 days" for the fleeting isotopes with known half-lives. */
function lifeSpan(list: Isotope[]): string {
  const lives = list.filter((i) => i.halfLife !== null && i.halfLife > 0).map((i) => i.halfLife!);
  if (!lives.length) return '';
  const a = formatHalfLife(Math.min(...lives)), b = formatHalfLife(Math.max(...lives));
  return a === b ? `, in ${a}` : `, from ${a} to ${b}`;
}
