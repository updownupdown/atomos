// The picture at the top of each science tab: the orbitals assembled layer by layer for the
// structure, an album of isotope tiles, axes that place each property among
// all elements, and a timeline of discoveries. Plain SVG and HTML strings,
// coloured through the design tokens in style.css.

import { BLOCK_COLOUR, ELEMENTS, L_OF, formatHalfLife, keyIsotope, sup, type Element, type Isotope, type Subshell } from './data';
import { harmonic, M_ORDER, ORBITAL_NAMES, radial, radialTable } from './orbital';
import { isLasting } from '../core/progress';
import type { LookId } from './looks';
import { modelColor } from './modelColors';
import { LOOKS } from './looks';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (v: number) => Math.round(v * 10) / 10;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---------- Structure: the atom assembled, layer by layer ----------

/** Layers in the order they are usually filled (Madelung: n + l, then n). */
export function buildOrder(e: Element): Subshell[] {
  return [...e.subshells].sort((a, b) => (a.n + L_OF[a.l]) - (b.n + L_OF[b.l]) || a.n - b.n);
}

/** Where each electron sits among a layer's orbitals: one in each first, then pairs (Hund's rule). */
export function orbitalFill(count: number, capacity: number): number[] {
  const k = capacity / 2;
  return Array.from({ length: k }, (_, i) => (count >= k + i + 1 ? 2 : count > i ? 1 : 0));
}

const CORE_NAME: Record<string, string> = { He: 'Helium', Ne: 'Neon', Ar: 'Argon', Kr: 'Krypton', Xe: 'Xenon', Rn: 'Radon' };

// ---------- Structure: the shells as they are, and the orbitals assembled ----------

const SHELL_NAMES = ['K', 'L', 'M', 'N', 'O', 'P', 'Q'];

/** The radial distribution of every layer: how likely an electron is at each distance from the
 *  nucleus, from hydrogen-like orbitals with Slater's effective charges, scaled as in the 3D view
 *  so the outer layer's edge sits at the van der Waals radius. The distance axis is a square root
 *  so the tight inner shells and the wide outer ones both show. Peaks are the shells. */
export function shellPlot(e: Element): string {
  const W = 340, H = 180, left = 8, right = W - 8, base = H - 30, top = 26;
  const samples = 360;
  // Each layer's density over r in pm, normalised so its area is its electron count.
  const layers = e.subshells.map((s) => {
    const l = L_OF[s.l];
    const xmax = 3 * s.n * s.n + 6 * s.n;
    const pts: { r: number; d: number }[] = [];
    let total = 0;
    for (let i = 1; i <= 1200; i++) {
      const x = (i / 1200) * xmax;
      const R = radial(s.n, l, x);
      const d = x * x * R * R;
      total += d;
      pts.push({ r: (x * 52.9) / s.zeff, d });
    }
    return { s, pts, total, edge: (radialTable(s.n, l).edge * 52.9) / s.zeff };
  });
  // One factor for every layer, as the 3D view uses: the outermost edge lands on the vdW radius.
  const k = e.vdw / Math.max(...layers.map((x) => x.edge));
  for (const x of layers) for (const p of x.pts) p.r *= k;
  const rMax = Math.max(e.vdw * 1.15, ...layers.map(({ pts, total }) => {
    let acc = 0;
    for (const p of pts) { acc += p.d; if (acc > total * 0.995) return p.r; }
    return pts[pts.length - 1].r;
  }));
  const u = (r: number) => Math.sqrt(r / rMax);
  const X = (r: number) => left + u(r) * (right - left);
  // Density per unit of u = sqrt(r / rMax): P(r) dr/du, with dr/du = 2 u rMax.
  const grid = Array.from({ length: samples + 1 }, (_, i) => (i / samples));
  const curves = layers.map(({ s, pts, total }) => {
    const dx = pts[1].r - pts[0].r;
    const at = (r: number) => {
      const i = Math.min(pts.length - 1, Math.max(0, Math.round(r / dx) - 1));
      return (pts[i].d / (total * dx)) * s.count;
    };
    return { s, ys: grid.map((g) => { const r = g * g * rMax; return at(r) * 2 * g * rMax; }) };
  });
  const sum = grid.map((_, i) => curves.reduce((a, c) => a + c.ys[i], 0));
  const peak = Math.max(...sum);
  const Y = (v: number) => base - (v / peak) * (base - top);
  const path = (ys: number[]) => `M ${left} ${base} ` + ys.map((y, i) => `L ${f1(left + grid[i] * (right - left))} ${f1(Y(y))}`).join(' ') + ` L ${right} ${base} Z`;
  const fills = curves.map(({ s, ys }) => `<path class="sp-layer${s.core ? ' is-core' : ''}" d="${path(ys)}" style="--b:${BLOCK_COLOUR[s.l]}"><title>${s.key}: ${s.count} electron${s.count === 1 ? '' : 's'}</title></path>`).join('');
  const outline = `<path class="sp-sum" d="${path(sum).replace(/ L [\d.]+ [\d.]+ Z$/, '')}"/>`;
  // Shell letters over each shell's peak.
  // Shell letters over each shell's peak; shells packed too close to name apart share one label ("K–M").
  const peaks = [...new Set(e.subshells.map((s) => s.n))].sort((a, b) => a - b).map((n) => {
    const ys = grid.map((_, i) => curves.filter((c) => c.s.n === n).reduce((a, c) => a + c.ys[i], 0));
    const i = ys.indexOf(Math.max(...ys));
    return { n, x: left + grid[i] * (right - left), y: Y(sum[i]) };
  });
  const runs: (typeof peaks)[] = [];
  for (const pk of peaks) {
    const run = runs[runs.length - 1];
    if (run && pk.x - run[run.length - 1].x < 16) run.push(pk); else runs.push([pk]);
  }
  const shells = runs.map((run) => {
    const last = run[run.length - 1];
    const text = run.length === 1 ? SHELL_NAMES[last.n - 1] : `${SHELL_NAMES[run[0].n - 1]}–${SHELL_NAMES[last.n - 1]}`;
    const y = Math.max(12, Math.min(...run.map((r) => r.y)) - 6);
    return `<text class="sp-shell" x="${f1(last.x)}" y="${f1(y)}">${text}</text>`;
  }).join('');
  const ticks = [1, 10, 50, 100, 200, 300, 400, 500].filter((r) => r <= rMax).map((r) => `<path class="sp-tick" d="M ${f1(X(r))} ${base} v 4"/><text class="sp-tl" x="${f1(X(r))}" y="${base + 15}">${r}</text>`).join('');
  const vdw = `<path class="sp-vdw" d="M ${f1(X(e.vdw))} 4 V ${base}"/><text class="sp-vdw-l" x="${f1(X(e.vdw)) - 4}" y="12">edge ${e.vdw} pm</text>`;
  return `<figure class="sp">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How likely an electron is at each distance from the nucleus; each peak is a shell.">
      ${vdw}${fills}${outline}${shells}<path class="sp-base" d="M ${left} ${base} H ${right}"/>${ticks}<text class="sp-unit" x="${right}" y="${H - 2}">pm from the nucleus</text>
    </svg>
    <figcaption>Where the electrons are likely to be, by distance from the nucleus. Each colored hill is a layer, sized by its electrons; the peaks are the shells.</figcaption>
  </figure>`;
}

/** The orbital box diagram: a row per shell, a box per orbital, an arrow per electron, filled
 *  one per box before any pair (Hund's rule). Lone electrons are lit: they make atoms magnetic. */
/** The plane each real orbital is drawn in, face on: two unit vectors (across, up). Most lie in a
 *  coordinate plane; fxyz has nodes in all three, so it is cut along the x = y diagonal. */
const PLANES: Record<string, [number[], number[]]> = {
  xz: [[1, 0, 0], [0, 0, 1]], yz: [[0, 1, 0], [0, 0, 1]], xy: [[1, 0, 0], [0, 1, 0]],
  diag: [[Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1]],
};
const PLANE_OF: Record<number, Record<number, string>> = {
  1: { 0: 'xz', 1: 'xz', [-1]: 'yz' },
  2: { 0: 'xz', 1: 'xz', [-1]: 'yz', 2: 'xy', [-2]: 'xy' },
  3: { 0: 'xz', 1: 'xz', [-1]: 'yz', 2: 'xz', [-2]: 'diag', 3: 'xy', [-3]: 'xy' },
};

/** One orbital's 2D shape: a polar plot of its angular probability (|Y|²) in its plane, one path
 *  per lobe, with the lobe's sign (the wavefunction's phase) so the two tones can alternate. */
export function orbitalOutline(l: number, m: number, steps = 360): { d: string; plus: boolean }[] {
  if (l === 0) return [{ d: 'M 0.86 0 A 0.86 0.86 0 1 1 -0.86 0 A 0.86 0.86 0 1 1 0.86 0 Z', plus: true }];
  const [u, v] = PLANES[PLANE_OF[l][m]];
  const samples = Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    const dir = [0, 1, 2].map((k) => Math.cos(t) * u[k] + Math.sin(t) * v[k]);
    const y = harmonic(l, m, dir[0], dir[1], dir[2]);
    return { t, y };
  });
  const max = Math.max(...samples.map((p) => p.y * p.y)) || 1;
  // Split the turn into runs of one sign: each run is a lobe, closed through the nucleus.
  const start = samples.findIndex((p, i) => Math.sign(p.y) !== Math.sign(samples[(i + steps - 1) % steps].y));
  const lobes: { d: string; plus: boolean }[] = [];
  let run: { t: number; y: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const p = samples[(Math.max(0, start) + k) % steps];
    if (run.length && (Math.sign(p.y) !== Math.sign(run[0].y) || k === steps)) {
      const r = (q: { t: number; y: number }) => (0.94 * (q.y * q.y)) / max;
      if (Math.max(...run.map(r)) > 0.02) {
        const pts = run.map((q) => `${(Math.cos(q.t) * r(q)).toFixed(3)} ${(-Math.sin(q.t) * r(q)).toFixed(3)}`);
        lobes.push({ d: `M 0 0 L ${pts.join(' L ')} Z`, plus: run[0].y > 0 });
      }
      run = [];
    }
    run.push(p);
  }
  return lobes;
}

/** One subshell's orbitals as small 2D shapes (solid when full, paler when half full, outlined
 *  when empty) with their electrons' spins under them as arrows, a lone electron in cyan. */
function orbitalGlyphs(s: Subshell): string {
  const l = L_OF[s.l];
  return orbitalFill(s.count, s.capacity).map((k, oi) => {
    const paths = orbitalOutline(l, M_ORDER[oi]).map((b) => `<path class="os-lobe ${b.plus ? 'is-plus' : 'is-minus'}" d="${b.d}"/>`).join('');
    const spins = `${k >= 1 ? `<b class="${k === 1 ? 'is-lone' : ''}">↑</b>` : ''}${k === 2 ? '<b>↓</b>' : ''}`;
    return `<figure class="os-glyph om-glyph os-fill-${k}" data-l="${s.l}">
      <svg viewBox="-1 -1 2 2" aria-hidden="true"><path class="os-axis" d="M -0.95 0 H 0.95 M 0 -0.95 V 0.95"/>${paths}</svg>
      <span class="os-unknown" aria-hidden="true">?</span>
      <span class="om-spin" aria-label="${k} electron${k === 1 ? '' : 's'}">${spins}</span>
      <figcaption class="om-name">${ORBITAL_NAMES[s.l][oi]}</figcaption>
    </figure>`;
  }).join('');
}

/**
 * The atom assembled from the bottom up, as an orbital diagram: the nucleus, the noble-gas core,
 * then a numbered step per outer layer in the order layers usually fill (lowest energy first),
 * each layer's orbitals drawn as the textbook cuts through their middles with the electrons'
 * spins under them. Counts are what the element really has, exceptions included. Details opens
 * the core layer by layer and adds each orbital's name.
 */
export function orbitalAssembly(e: Element): string {
  const key = keyIsotope(e);
  const neutrons = key ? key.a - e.z : null;
  const core = buildOrder(e).filter((s) => s.core);
  const coreCount = core.reduce((n, s) => n + s.count, 0);
  const outer = buildOrder(e).filter((s) => !s.core);
  const coreName = e.core ? `${CORE_NAME[e.core] ?? e.core} core` : '';
  const layer = (s: Subshell, step: number | null, extra = '') => {
    const single = orbitalFill(s.count, s.capacity).filter((k) => k === 1).length;
    const sub = `${s.count} of ${s.capacity}${single ? `, ${single} alone` : ''}`;
    return `<div class="oa-row${s.core ? ' is-core' : ''}${extra}" style="--b:${BLOCK_COLOUR[s.l]}">
      <span class="oa-step">${step ?? ''}</span>
      <div class="oa-body"><span class="oa-label"><b>${s.key}${sup(s.count)}</b><small>${sub}</small></span><div class="om-glyphs">${orbitalGlyphs(s)}</div></div>
    </div>`;
  };
  // Steps count up from the nucleus (1) and the core (2); rows are listed top down.
  const rows: string[] = [];
  const first = core.length ? 3 : 2;
  outer.forEach((s, i) => rows.unshift(layer(s, first + i)));
  if (core.length) {
    const coreRows = core.map((s) => layer(s, null, ' oa-core-layer')).reverse().join('');
    rows.push(`<div class="oa-row oa-core">
      <span class="oa-step">2</span>
      <div class="oa-body"><span class="oa-label"><b>${esc(coreName)}</b><small>${coreCount} electrons, as in ${esc((CORE_NAME[e.core!] ?? e.core!).toLowerCase())}</small></span>
      <div class="oa-core-keys">${core.map((s) => `<span style="--b:${BLOCK_COLOUR[s.l]}">${s.key}${sup(s.count)}</span>`).join('')}</div></div>
    </div>${coreRows}`);
  }
  const balls = [[0, 0], [-5.2, -3], [5.2, -3], [0, -6], [-5.2, 3], [5.2, 3], [0, 6]]
    .map(([x, y], i) => `<circle class="${i % 2 ? 'oa-neutron' : 'oa-proton'}" cx="${x}" cy="${y * 0.85}" r="3.4"/>`).join('');
  rows.push(`<div class="oa-row oa-nucleus">
    <span class="oa-step">1</span>
    <div class="oa-body"><span class="oa-label"><svg class="oa-nuc" viewBox="-10 -10 20 20" aria-hidden="true">${balls}</svg><b>Nucleus</b><small>${neutrons == null ? `${e.z} proton${e.z === 1 ? '' : 's'}` : `${e.z} protons, ${neutrons} neutrons`}</small></span></div>
  </div>`);
  const lone = e.unpaired;
  return `<label class="ui-switch-row om-toggle"><span class="ui-switch-text">Details</span><input type="checkbox" role="switch" class="ui-switch" id="om-details"></label>
    <div class="om oa" role="img" aria-label="${esc(e.name)} built up layer by layer: ${esc(e.configuration)}">${rows.join('')}</div>
    <p class="note os-hidden-note" hidden></p>
    <p class="note">Built from the bottom up, lowest energy first. Each arrow is an electron and its spin${lone ? ', a lone one in cyan' : ''}.</p>
    <div class="om-notes">
      <p class="note">Full orbitals are solid, half-full ones paler, empty ones only outlined. The two tones are the wave's two phases. ${lone ? `${esc(e.name)} has ${lone} lone electron${lone === 1 ? '' : 's'}.` : `Every electron in ${esc(e.name.toLowerCase())} is paired.`} The layers overlap in space rather than stack; Shells shows how far out each one reaches.</p>
    </div>`;
}

// ---------- Structure: every orbital at once ----------

/** Each layer's reach in pm (the edge that holds 85% of it) and its usual distance (the mean),
 *  from the same hydrogen-like orbitals and Slater charges as Shells and the 3D view, scaled by
 *  one factor so the outer layer's edge sits on the van der Waals radius. */
export function layerReach(e: Element): { edge: number; mean: number }[] {
  const raw = e.subshells.map((s) => {
    const t = radialTable(s.n, L_OF[s.l]);
    return { edge: (t.edge * 52.9) / s.zeff, mean: (t.mean * 52.9) / s.zeff };
  });
  const k = e.vdw / Math.max(...raw.map((r) => r.edge));
  return raw.map((r) => ({ edge: r.edge * k, mean: r.mean * k }));
}


/** The turn each orbital of a layer is drawn at, so they don't sit on one another. The three p
 *  orbitals are seen from a corner of their axes, which spreads them 120° apart; d and f
 *  orbitals are turned evenly apart. */
export function orbitalTurn(l: number, oi: number): number {
  if (l === 0) return 0;
  if (l === 1) return [90, 210, 330][oi];
  return (oi * 180) / (2 * l + 1);
}

/**
 * Every orbital of the atom drawn on top of the others, centered on the nucleus and sized by how
 * far each layer reaches, so the inner layers sit inside the outer ones the way they do in the
 * atom, always to true scale. infopage.ts makes it live and 3D (together3d.ts): a slider adds the
 * electrons one at a time in the order they fill, and a layer chip picks one layer out.
 */
export function orbitalTogether(e: Element): string {
  const reach = layerReach(e);
  const D = 0.9;
  // Widest first, so the small inner layers are drawn over the big ones.
  const order = e.subshells.map((s, i) => ({ s, i, r: reach[i] })).sort((a, b) => b.r.edge - a.r.edge);
  const subs = order.map(({ s, i, r }) => {
    const l = L_OF[s.l];
    const k = s.capacity / 2;
    const orbs = Array.from({ length: k }, (_, oi) => {
      const paths = orbitalOutline(l, M_ORDER[oi], 180).map((b) => `<path class="${b.plus ? 'is-plus' : 'is-minus'}" d="${b.d}"/>`).join('');
      return `<g class="tg-orb" data-k="${oi}" transform="rotate(${orbitalTurn(l, oi)})">${paths}</g>`;
    }).join('');
    const sc = ((D * (r.edge / e.vdw)) / 0.94).toFixed(4);
    return `<g class="tg-sub" data-i="${i}" data-l="${s.l}" data-r="${(r.edge / e.vdw).toFixed(5)}" style="--b:${BLOCK_COLOUR[s.l]};transform:scale(${sc})">
      <circle class="tg-ghost" r="0.9"/>${orbs}</g>`;
  }).join('');
  const chips = buildOrder(e).map((s) => {
    const i = e.subshells.indexOf(s);
    return `<button type="button" class="tg-chip" data-i="${i}" aria-pressed="false" style="--b:${BLOCK_COLOUR[s.l]}">${s.key}<sup>${s.count}</sup></button>`;
  }).join('');
  return `<div class="tg" data-z="${e.z}">
    <div class="tg-stage">
      <svg viewBox="-1 -1 2 2" role="img" aria-label="Every orbital of ${esc(e.name.toLowerCase())} drawn together around the nucleus, inner layers inside outer ones.">
        <circle class="tg-edge" r="${D}"/>
        ${subs}
        <circle class="tg-nuc" r="0.022"/>
      </svg>
      <span class="tg-edge-lab">edge ${e.vdw} pm · true scale</span>
    </div>
    <p class="tg-read" aria-live="polite"></p>
    <div class="tg-fill">
      <button type="button" class="tg-play" aria-label="Build it up: add the electrons one by one"></button>
      <div class="tg-slider"></div>
    </div>
    <div class="tg-chips" role="group" aria-label="Pick out a layer">${chips}</div>
    <p class="note">Every orbital at once and to true scale, each layer as far out as its electrons usually reach. Turn it with a sideways drag, add the electrons in the order they fill, or tap a layer to zoom in on it.</p>
  </div>`;
}

export const STRUCTURE_VIEWS: { id: string; label: string }[] = [
  { id: 'together', label: 'Together' },
  { id: 'orbitals', label: 'Orbitals' },
  { id: 'shells', label: 'Shells' },
];

// ---------- Isotopes: an album of tiles ----------

/** 0..1 for how long an isotope lasts, on a log scale from a nanosecond to the age of the universe. */
export function lifeMeter(halfLife: number | null): number {
  if (halfLife == null || halfLife <= 0) return 0;
  return Math.max(0.03, Math.min(1, (Math.log10(halfLife) + 9) / (17.6 + 9)));
}

/** Which filter rows an isotope matches: lasting (stable, or a half-life over a year) or fleeting. */
export function isotopeKinds(i: Isotope): string[] {
  return ['all', isLasting(i) ? 'lasting' : 'fleeting'];
}

export const ISO_FILTERS: { id: string; label: string }[] = [
  { id: 'lasting', label: 'Lasting' },
  { id: 'fleeting', label: 'Fleeting' },
  { id: 'all', label: 'All' },
];

/** The neutron chart: one bar per isotope by neutron count, as tall as it lives (log scale),
 *  stable ones full height in cyan, so the element's valley of stability shows as a ridge. */
function isotopeChart(e: Element): string {
  const isos = e.isotopes;
  if (!isos.length) return '';
  const W = 320, H = 92, base = H - 18, top = 6;
  const n0 = isos[0].a - e.z, n1 = isos[isos.length - 1].a - e.z;
  const span = Math.max(1, n1 - n0 + 1), bw = (W - 8) / span;
  const key = keyIsotope(e);
  const bars = isos.map((i) => {
    const n = i.a - e.z;
    const v = i.stable ? 1 : lifeMeter(i.halfLife);
    const h = Math.max(2, v * (base - top));
    const x = 4 + (n - n0) * bw;
    const cls = `ic-bar${i.stable ? ' is-stable' : ''}${key && key.a === i.a ? ' is-key' : ''}`;
    return `<rect class="${cls}" x="${f1(x + bw * 0.12)}" y="${f1(base - h)}" width="${f1(Math.max(1.5, bw * 0.76))}" height="${f1(h)}" rx="1" style="--v:${v.toFixed(3)}"><title>${e.symbol}-${i.a}: ${n} neutrons, ${i.stable ? 'stable' : i.halfLife == null ? 'half-life not known' : formatHalfLife(i.halfLife)}</title></rect>`;
  }).join('');
  const label = (n: number) => `<text x="${f1(4 + (n - n0 + 0.5) * bw)}" y="${H - 4}">${n}</text>`;
  const marks = [n0, ...(key ? [key.a - e.z] : []), n1].filter((n, i, a) => a.indexOf(n) === i);
  return `<figure class="ic">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Isotopes of ${esc(e.name.toLowerCase())} by neutron count; taller bars last longer, full cyan bars are stable.">
      <path class="ic-base" d="M 4 ${base + 0.5} H ${W - 4}"/>${bars}${marks.map(label).join('')}
    </svg>
    <figcaption><span>fewer neutrons</span><span>Taller lasts longer · cyan is stable</span><span>more neutrons</span></figcaption>
  </figure>`;
}

/** A small ring showing a share of 100%. */
const shareRing = (pc: number) => {
  const r = 9, c = 2 * Math.PI * r, d = Math.max(0.6, (pc / 100) * c);
  return `<svg class="it-ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" class="it-ring-bg"/><circle cx="12" cy="12" r="${r}" class="it-ring-fg" stroke-dasharray="${f1(d)} ${f1(c)}" transform="rotate(-90 12 12)"/></svg>`;
};

/** The isotope list: a thin row each, with its lifetime on the shared log ruler and its share of
 *  the natural element; a tap opens its mass, neutrons and spin. Rows carry their kinds for the
 *  filter above. */
function isotopeRows(e: Element): string {
  const key = keyIsotope(e);
  return e.isotopes.map((i) => {
    const n = i.a - e.z;
    const v = i.stable ? 1 : lifeMeter(i.halfLife);
    const life = i.stable ? 'stable' : i.halfLife == null ? 'not known' : formatHalfLife(i.halfLife);
    const share = i.abundance == null ? '' : `${shareRing(i.abundance)}<span>${Number(i.abundance.toPrecision(3))}%</span>`;
    const more = [`${n} neutron${n === 1 ? '' : 's'}`, i.mass == null ? '' : `mass ${i.mass.toFixed(3)} u`, i.spin ? `spin ${i.spin}` : '', key && key.a === i.a ? 'the most common' : ''].filter(Boolean).join(' · ');
    return `<div class="it-item${i.stable ? ' is-stable' : ''}${key && key.a === i.a ? ' is-key' : ''}" data-kinds="${isotopeKinds(i).join(' ')}">
      <button type="button" class="it-row" aria-expanded="false">
        <span class="it-name"><b><sup>${i.a}</sup>${e.symbol}</b></span>
        <span class="it-life"><span class="it-track"><i style="--v:${v.toFixed(3)}"></i></span><span class="it-life-lab">${life}</span></span>
        <span class="it-share">${share || '<span class="na">none in nature</span>'}</span>
      </button>
      <p class="it-more" hidden>${more}</p>
    </div>`;
  }).join('');
}

/**
 * The isotopes at a glance: one dot per known isotope along the neutron count, stable ones lit
 * cyan, the most common one ringed, with the line where neutrons equal protons; and a sentence
 * that puts the three numbers (known, stable, the neutron range) in words.
 */
export function isotopeSummary(e: Element): string {
  const isos = e.isotopes;
  if (!isos.length) return '';
  const stable = isos.filter((i) => i.stable);
  const lasting = isos.filter(isLasting).length;
  const n0 = isos[0].a - e.z, n1 = isos[isos.length - 1].a - e.z;
  const lo = Math.min(n0, e.z), hi = Math.max(n1, e.z);
  const W = 320, H = 46, pad = 10, cy = 20;
  const x = (n: number) => pad + ((n - lo) / Math.max(1, hi - lo)) * (W - 2 * pad);
  const key = keyIsotope(e);
  const dots = isos.map((i) => {
    const n = i.a - e.z;
    const life = i.stable ? 1 : lifeMeter(i.halfLife);
    return `<circle class="isu-dot${i.stable ? ' is-stable' : ''}${key && key.a === i.a ? ' is-key' : ''}" cx="${f1(x(n))}" cy="${cy}" r="${f1(i.stable ? 5 : 2 + 2.2 * life)}"><title>${e.symbol}-${i.a}</title></circle>`;
  }).join('');
  const eq = `<path class="isu-eq" d="M ${f1(x(e.z))} 6 V ${cy + 12}"/><text class="isu-eq-lab" x="${f1(x(e.z))}" y="${H - 2}">N = Z</text>`;
  const sRange = stable.length ? [stable[0].a - e.z, stable[stable.length - 1].a - e.z] : null;
  const words = stable.length
    ? `Of ${isos.length} known isotopes, ${stable.length === 1 ? 'one never decays' : `${stable.length} never decay`}: ${sRange![0] === sRange![1] ? `${sRange![0]} neutrons` : `${sRange![0]} to ${sRange![1]} neutrons`}, in a nucleus of ${e.z} protons. The rest, from ${n0} to ${n1} neutrons, fall apart.`
    : `None of its ${isos.length} known isotopes is stable: every one, from ${n0} to ${n1} neutrons, falls apart in time.`;
  return `<section class="isu">
    <div class="isu-nums"><div><b>${isos.length}</b><span>known</span></div><div><b class="is-stable">${lasting}</b><span>lasting</span></div><div><b>${isos.length - lasting}</b><span>fleeting</span></div><div><b>${n0}–${n1}</b><span>neutrons</span></div></div>
    <svg class="isu-strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(words)}"><path class="isu-base" d="M ${pad} ${cy} H ${W - pad}"/>${eq}${dots}</svg>
    <p class="isu-words">${esc(words)}</p>
  </section>`;
}

export function isotopeTable(e: Element): string {
  const counts = Object.fromEntries(ISO_FILTERS.map((f) => [f.id, e.isotopes.filter((i) => isotopeKinds(i).includes(f.id)).length]));
  return `${isotopeSummary(e)}
    ${isotopeChart(e)}
    <div class="it-filter" id="iso-filter" data-counts='${JSON.stringify(counts)}'></div>
    <div class="it" id="iso-table">
      <div class="it-headrow" aria-hidden="true"><span>Isotope</span><span>How long it lasts</span><span>In nature</span></div>
      ${isotopeRows(e)}
      <p class="it-empty">None of ${esc(e.name.toLowerCase())}'s isotopes fit this filter.</p>
    </div>`;
}

// ---------- Properties: where this element sits among all of them ----------

interface Axis { id: string; label: string; get: (e: Element) => number | null; unit: string; log?: boolean; more: string; less: string; fmt?: (v: number) => string; temp?: boolean; look?: LookId }

const AXES: Axis[] = [
  { id: 'density', look: 'density', label: 'Density', get: (e) => e.density, unit: ' g/cm³', log: true, more: 'densest', less: 'lightest' },
  { id: 'melt', look: 'melt', label: 'Melting point', get: (e) => e.melt, unit: ' K', more: 'highest melting point', less: 'lowest melting point', fmt: (v) => `${Math.round(v)}`, temp: true },
  { id: 'boil', label: 'Boiling point', get: (e) => e.boil, unit: ' K', more: 'highest boiling point', less: 'lowest boiling point', fmt: (v) => `${Math.round(v)}`, temp: true },
  { id: 'en', look: 'electronegativity', label: 'Electronegativity', get: (e) => e.electronegativity, unit: '', more: 'most electronegative', less: 'least electronegative' },
  { id: 'ion', label: 'First ionization energy', get: (e) => e.ionisation, unit: ' eV', more: 'hardest to ionize', less: 'easiest to ionize' },
  { id: 'size', look: 'size', label: 'Size (van der Waals)', get: (e) => e.vdw, unit: ' pm', more: 'largest', less: 'smallest', fmt: (v) => `${Math.round(v)}` },
  { id: 'crust', look: 'crust', label: 'In the crust', get: (e) => e.crust, unit: ' mg/kg', log: true, more: 'most common in the crust', less: 'rarest in the crust' },
  { id: 'sea', label: 'In seawater', get: (e) => e.sea, unit: ' mg/L', log: true, more: 'most common in seawater', less: 'rarest in seawater' },
];

const fmtNum = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (_, p) => sup(p).replace('-', '⁻')) : `${Number(v.toPrecision(3))}`);

/** Rank of v among values, 1 = highest. */
export function rankOf(v: number, values: number[]): number {
  return values.filter((x) => x > v).length + 1;
}

/** "the densest", "4th densest", "3rd lightest": the rank from whichever end is nearer. */
export function rankWords(r: number, count: number, more: string, less: string): string {
  if (r <= count / 2) return r === 1 ? `the ${more}` : `${ordinal(r)} ${more}`;
  const fromBottom = count - r + 1;
  return fromBottom === 1 ? `the ${less}` : `${ordinal(fromBottom)} ${less}`;
}

const LANES = ['s', 'p', 'd', 'f'] as const;
/** From rutherfordium on, only a few atoms have ever been made; bulk properties are predicted. */
const PREDICTED_FROM = 104;

/** The Atlas link under a property: the Atlas colored by it, with this atom picked. */
const seeInAtlas = (e: Element, look?: LookId) => (look ? `<button type="button" class="see-atlas" data-z="${e.z}" data-look="${look}">See in Atlas${'<span aria-hidden="true">›</span>'}</button>` : '');

/** Every measured element's value for a property (superheavy predictions left out of the crowd,
 *  this element kept), with this element's rank in words. */
function crowd(e: Element, a: Axis) {
  const all = ELEMENTS.map((x) => ({ x, v: a.get(x) })).filter((p): p is { x: Element; v: number } => p.v != null && (!a.log || p.v > 0) && (p.x.z < PREDICTED_FROM || p.x.z === e.z));
  const v = a.get(e);
  const has = v != null && (!a.log || v > 0);
  const rank = !has ? '' : e.z >= PREDICTED_FROM ? 'a prediction' : rankWords(rankOf(v!, all.map((p) => p.v)), all.length, a.more, a.less);
  return { all, v, has, rank };
}

/** One property, the full width: its name and the Atlas link, the value and its rank, then every
 *  measured element as a dot in its block's lane and color, this element ringed, the extremes
 *  named at the ends. */
function axisStrip(e: Element, a: Axis): string {
  const { all, v, has, rank } = crowd(e, a);
  const W = 320, pad = 8, laneH = 8, top = 5, H = top * 2 + laneH * 4;
  const t = (x: number) => (a.log ? Math.log10(x) : x);
  const lo = Math.min(...all.map((p) => t(p.v))), hi = Math.max(...all.map((p) => t(p.v)));
  const X = (x: number) => pad + ((t(x) - lo) / (hi - lo || 1)) * (W - pad * 2);
  const Y = (b: Element['block']) => top + LANES.indexOf(b) * laneH + laneH / 2;
  const lanes = LANES.map((b) => `<path class="pr-lane" d="M ${pad} ${Y(b)} H ${W - pad}"/>`).join('');
  const dots = all.filter((p) => p.x.z !== e.z).map((p) => `<circle cx="${f1(X(p.v))}" cy="${Y(p.x.block)}" r="2.4" fill="${BLOCK_COLOUR[p.x.block]}"/>`).join('');
  const minE = all.reduce((m, p) => (p.v < m.v ? p : m)), maxE = all.reduce((m, p) => (p.v > m.v ? p : m));
  const fmt = a.fmt ?? fmtNum;
  const mark = has ? `<path class="pr-guide" d="M ${f1(X(v!))} 1 V ${H - 1}"/><circle class="pr-me" cx="${f1(X(v!))}" cy="${Y(e.block)}" r="5" fill="${BLOCK_COLOUR[e.block]}"/>` : '';
  const value = v == null ? '<span class="na">not known</span>' : `${fmt(v)}${a.unit}`;
  return `<div class="pr">
    <div class="pr-head"><span class="pr-label">${a.label}</span>${seeInAtlas(e, a.look)}</div>
    <div class="pr-text"><b class="pr-value">${value}</b>${rank ? `<em class="pr-rank">${rank}</em>` : ''}</div>
    <div class="pr-vis">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${lanes}<g class="pr-dots">${dots}</g>${mark}</svg>
      <div class="pr-ends"><span>${minE.x.symbol} ${fmt(minE.v)}</span><span>${maxE.x.symbol} ${fmt(maxE.v)}</span></div>
    </div>
  </div>`;
}

const ROOM_K = 298.15;
const kc = (k: number) => `${Math.round(k)} K <small>${Math.round(k - 273.15)} °C</small>`;

/** Melting and boiling on one thermometer: solid, then liquid, then gas, from absolute zero up,
 *  with room temperature marked and the state there in words. */
export function heatStrip(e: Element): string {
  const melt = e.melt, boil = e.boil;
  const state = LOOKS.find((l) => l.id === 'state')!.value!(e);
  const cat = state && 'cat' in state ? state.cat : null;
  const meltA = AXES.find((a) => a.id === 'melt')!, boilA = AXES.find((a) => a.id === 'boil')!;
  const mr = crowd(e, meltA).rank, br = crowd(e, boilA).rank;
  const top = Math.max(500, (boil ?? melt ?? 400) * 1.18);
  const pc = (k: number) => `${Math.min(100, (k / top) * 100).toFixed(2)}%`;
  const bands = melt == null && boil == null ? ''
    : `<div class="th-bar">
        ${melt != null ? `<i class="th-solid" style="width:${pc(melt)}"></i>` : ''}
        ${boil != null ? `<i class="th-liquid" style="width:calc(${pc(boil)} - ${melt != null ? pc(melt) : '0%'})"></i>` : '<i class="th-liquid" style="flex:1"></i>'}
        ${boil != null ? '<i class="th-gas" style="flex:1"></i>' : ''}
        <span class="th-room" style="left:${pc(ROOM_K)}" title="Room temperature"></span>
      </div>
      <div class="th-key"><span><i class="th-solid"></i>Solid</span><span><i class="th-liquid"></i>Liquid</span><span><i class="th-gas"></i>Gas</span><span><i class="th-room-k"></i>Room temperature</span></div>`;
  const predicted = e.z >= PREDICTED_FROM ? ' <small class="pr-pred">predicted</small>' : '';
  const line = (label: string, v: number | null, rank: string) => `<div class="th-row"><span>${label}</span><b>${v == null ? '<span class="na">not known</span>' : kc(v)}${v == null ? '' : predicted}</b>${v != null && rank ? `<em class="pr-rank">${rank}</em>` : ''}</div>`;
  return `<div class="pr th">
    <div class="pr-head"><span class="pr-label">${cat ? `${cat[0].toUpperCase()}${cat.slice(1)} at room temperature` : 'Heat'}</span>${seeInAtlas(e, 'melt')}</div>
    ${bands}
    ${line('Melts', melt, mr)}${line('Boils', boil, br)}
  </div>`;
}

/** How many elements show each oxidation state, -5 to +9. */
export function oxidationCounts(): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of ELEMENTS) for (const o of x.oxidation) m.set(o, (m.get(o) ?? 0) + 1);
  return m;
}

function oxidationStrip(e: Element): string {
  const counts = oxidationCounts();
  const states = Array.from({ length: 15 }, (_, i) => i - 5);
  const max = Math.max(...counts.values());
  const W = 240, colW = W / states.length, H = 58;
  const mine = new Set(e.oxidation);
  const bars = states.map((s, i) => {
    const c = counts.get(s) ?? 0;
    const h = c ? 3 + (c / max) * (H - 20) : 0;
    const x = i * colW + 2;
    const cls = `${s < 0 ? 'ox-neg' : s > 0 ? 'ox-pos' : 'ox-zero'}${mine.has(s) ? ' is-mine' : ''}`;
    return `<rect class="ox-bar ${cls}" x="${f1(x)}" y="${f1(H - 14 - h)}" width="${f1(colW - 4)}" height="${f1(h)}" rx="1.5"/>`
      + `<text class="ox-lab${mine.has(s) ? ' is-mine' : ''}" x="${f1(x + (colW - 4) / 2)}" y="${H - 2}">${s > 0 ? '+' + s : s}</text>`;
  }).join('');
  const most = [...e.oxidation].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
  const words = most != null ? `${most > 0 ? '+' + most : most} is shared by ${counts.get(most)} elements` : '';
  return `<div class="pr pr-ox">
    <div class="pr-head"><span class="pr-label">Oxidation states</span></div>
    <div class="pr-text"><b class="pr-value">${e.oxidation.length ? e.oxidation.map((o) => (o > 0 ? '+' + o : String(o))).join(', ') : '<span class="na">none listed</span>'}</b>${words ? `<em class="pr-rank">${words}</em>` : ''}</div>
    <div class="pr-vis"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg><div class="pr-ends"><span>← electrons gained</span><span>electrons given →</span></div></div>
  </div>`;
}

/** A plain line: a name and a value, for the details that need no chart. */
const kvRow = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
const na = (t: string) => `<span class="na">${t}</span>`;

/** The properties in five groups: heat, weight, chemistry, size, and where it is found. */
export function propertyAxes(e: Element): string {
  const ax = (id: string) => axisStrip(e, AXES.find((a) => a.id === id)!);
  const legend = LANES.map((b) => `<span><i style="background:${BLOCK_COLOUR[b]}"></i>${b}</span>`).join('');
  const group = (title: string, body: string) => `<section class="pr-group"><h3 class="pr-h">${title}</h3><div class="prs">${body}</div></section>`;
  const affinity = e.electronAffinity == null ? na('not known') : e.electronAffinity < 0 ? na('no stable negative ion') : `${Number(e.electronAffinity.toPrecision(3))} eV`;
  const details = (rows: string) => `<div class="pr pr-kv">${rows}</div>`;
  return `<p class="pr-legend">Every dot is an element, in its block's lane and color: ${legend}. The ringed dot is ${esc(e.name.toLowerCase())}.</p>
    ${group('Heat', heatStrip(e))}
    ${group('Weight', ax('density'))}
    ${group('Chemistry', ax('en') + ax('ion') + oxidationStrip(e) + details(
      kvRow('Electron affinity', affinity)
      + kvRow('Geochemical class', e.geochemical ? esc(e.geochemical) : na('not classed'))
      + kvRow('Color in molecule models', modelColor(e.z) ? `<span class="swatch" style="background:${modelColor(e.z)}"></span>${modelColor(e.z)}` : na('none'))))}
    ${group('Size', ax('size') + details(kvRow('Covalent radius', e.covalent == null ? na('not known') : `${Number(e.covalent.toPrecision(3))} pm`)))}
    ${group('Where it is found', ax('crust') + ax('sea'))}`;
}

// ---------- Story: a timeline of discoveries ----------

export function discoveryTimeline(e: Element, caption = true): string {
  const W = 320, H = 92, left = 34, right = W - 8, y0 = 1650, y1 = 2030, base = H - 22;
  const X = (y: number) => left + ((y - y0) / (y1 - y0)) * (right - left);
  const known = ELEMENTS.filter((x) => x.discoveryYear == null || x.discoveryYear < y0);
  const bins = new Map<number, Element[]>();
  for (const x of ELEMENTS) if (x.discoveryYear != null && x.discoveryYear >= y0) {
    const d = Math.floor(x.discoveryYear / 10) * 10;
    bins.set(d, [...(bins.get(d) ?? []), x]);
  }
  const dot = (x: number, i: number, el: Element) =>
    `<circle class="${el.z === e.z ? 'tl-dot is-mine' : 'tl-dot'}" cx="${f1(x)}" cy="${f1(base - 4 - i * 5.2)}" r="${el.z === e.z ? 3.4 : 2.1}"/>`;
  const ancient = known.map((el, i) => dot(14 + (i % 3) * 5.5, Math.floor(i / 3), el)).join('');
  const decades = [...bins.entries()].map(([d, els]) => els.map((el, i) => dot(X(d + 5), i, el)).join('')).join('');
  const labels = [1700, 1800, 1900, 2000].map((y) => `<text class="tl-lab" x="${f1(X(y))}" y="${H - 6}">${y}</text><path class="tl-tick" d="M ${f1(X(y))} ${base + 2} v 5"/>`).join('');
  return `<figure class="tl">
    <svg class="tl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="When each element was discovered">
      <path class="tl-base" d="M ${left - 4} ${base + 2} H ${right}"/>
      <text class="tl-lab" x="${14 + 5.5}" y="${H - 6}">Old</text>
      ${ancient}${decades}${labels}
    </svg>
    ${caption ? `<figcaption>${discoveryWords(e)}</figcaption>` : ''}
  </figure>`;
}

/** Where an element's discovery falls: one of the elements known before chemistry became a
 *  science, or the nth to be identified. */
export function discoveryWords(e: Element, short = false): string {
  const known = ELEMENTS.filter((x) => x.discoveryYear == null || x.discoveryYear < 1650).length;
  if (e.discoveryYear == null || e.discoveryYear < 1650) {
    return short ? `One of ${known} known before chemistry` : `${esc(e.name)} was known ${e.discoveryYear ? `by ${e.discoveryYear}` : 'in antiquity'}, one of ${known} elements known before chemistry became a science.`;
  }
  const order = [...ELEMENTS].sort((a, b) => (a.discoveryYear ?? 0) - (b.discoveryYear ?? 0) || a.z - b.z);
  const rank = order.findIndex((x) => x.z === e.z) + 1;
  return short ? `The ${ordinal(rank)} element found` : `${esc(e.name)} was found in ${e.discoveryYear}, the ${ordinal(rank)} element to be identified.`;
}
