// The picture at the top of each science tab: a build blueprint for the
// structure, an album of isotope tiles, axes that place each property among
// all elements, and a timeline of discoveries. Plain SVG and HTML strings,
// coloured through the design tokens in style.css.

import { BLOCK_COLOUR, ELEMENTS, L_OF, formatHalfLife, keyIsotope, sup, type Element, type Subshell } from './data';
import { radial, radialTable } from './orbital';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (v: number) => Math.round(v * 10) / 10;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---------- Structure: an exploded assembly drawing ----------

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

export function blueprint(e: Element): string {
  const key = keyIsotope(e);
  const neutrons = key ? key.a - e.z : null;
  const core = e.subshells.filter((s) => s.core);
  const coreCount = core.reduce((n, s) => n + s.count, 0);
  const outer = buildOrder(e).filter((s) => !s.core);

  const W = 380, cx = 124, calloutX = 252, tilt = 0.32;
  const rad = (n: number, l: number) => 20 + (n - 1) * 15 + l * 4;
  const ring = (cy: number, r: number, cls: string) =>
    `<path class="bp-back ${cls}" d="M ${cx - r} ${cy} A ${r} ${r * tilt} 0 0 1 ${cx + r} ${cy}"/>`
    + `<path class="bp-front ${cls}" d="M ${cx - r} ${cy} A ${r} ${r * tilt} 0 0 0 ${cx + r} ${cy}"/>`;

  // Parts from the top down; drawn bottom-up so the nucleus sits on the base line.
  type Part = { h: number; draw: (cy: number, step: number) => string };
  const parts: Part[] = [];
  let step = 0;
  const callout = (cy: number, r: number, n: number, title: string, sub: string, colour?: string) =>
    `<path class="bp-leader" d="M ${cx + r + 3} ${cy} H ${calloutX - 12}"/>`
    + `<circle class="bp-step" cx="${calloutX}" cy="${cy}" r="9"/><text class="bp-step-n" x="${calloutX}" y="${cy + 3.5}">${n}</text>`
    + `<text class="bp-title" x="${calloutX + 15}" y="${cy - 1}"${colour ? ` style="fill:${colour}"` : ''}>${title}</text>`
    + `<text class="bp-sub" x="${calloutX + 15}" y="${cy + 11}">${sub}</text>`;

  parts.push({
    h: 46,
    draw: (cy, n) => {
      const balls: string[] = [];
      const pts = [[0, 0], [-5.2, -3], [5.2, -3], [0, -6], [-5.2, 3], [5.2, 3], [0, 6]];
      pts.forEach(([x, y], i) => balls.push(`<circle class="${i % 2 ? 'bp-neutron' : 'bp-proton'}" cx="${cx + x}" cy="${cy + y * 0.8}" r="3.4"/>`));
      return balls.join('') + callout(cy, 10, n, 'Nucleus', neutrons == null ? `${e.z} protons` : `${e.z} protons, ${neutrons} neutrons`);
    },
  });
  if (core.length) {
    const shells = [...new Set(core.map((s) => s.n))];
    parts.push({
      h: 40,
      draw: (cy, n) => shells.map((sn) => ring(cy, rad(sn, 0) + 2, 'bp-core')).join('')
        + callout(cy, rad(shells[shells.length - 1], 0) + 2, n, `${CORE_NAME[e.core!] ?? e.core} core`, `${coreCount} electrons, ready made`),
    });
  }
  for (const s of outer) {
    parts.push({
      h: 42,
      draw: (cy, n) => {
        const r = rad(s.n, L_OF[s.l]);
        const fill = orbitalFill(s.count, s.capacity);
        const colour = BLOCK_COLOUR[s.l];
        const dots: string[] = [];
        fill.forEach((k, i) => {
          const a = Math.PI * 0.5 + (i / fill.length) * Math.PI * 2;
          for (let j = 0; j < 2; j++) {
            const aj = a + (j ? 0.09 : -0.09) * (60 / r);
            const x = cx + r * Math.cos(aj), y = cy + r * tilt * Math.sin(aj);
            const back = Math.sin(aj) < 0;
            dots.push(j < k
              ? `<circle class="bp-e${back ? ' back' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="3" style="fill:${colour}"/>`
              : `<circle class="bp-slot${back ? ' back' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="2.5"/>`);
          }
        });
        return `<g style="stroke:${colour}">${ring(cy, r, 'bp-layer')}</g>${dots.join('')}`
          + callout(cy, r, n, `${s.key}${sup(s.count)}`, `${s.count} of ${s.capacity}`, colour);
      },
    });
  }

  const top = 26, bottom = 52;
  const H = top + parts.reduce((h, p) => h + p.h, 0) + bottom;
  let y = H - bottom - parts[0].h / 2;
  const body: string[] = [];
  const centres: number[] = [];
  parts.forEach((p, i) => {
    if (i) y -= (parts[i - 1].h + p.h) / 2;
    centres.push(y);
    body.push(p.draw(y, ++step));
  });
  const axis = `<path class="bp-axis" d="M ${cx} ${centres[centres.length - 1] - 26} V ${centres[0] + 22}"/>`;
  const sheet = `${e.symbol.toUpperCase()}${key ? '-' + key.a : ''}`;
  const titleBlock = `<g class="bp-block"><rect x="${W - 168}" y="${H - 34}" width="160" height="26"/>`
    + `<path d="M ${W - 100} ${H - 34} V ${H - 8}"/>`
    + `<text x="${W - 160}" y="${H - 17}">${sheet}</text><text x="${W - 92}" y="${H - 17}">Not to scale</text></g>`;
  const svg = `<svg class="bp" viewBox="0 0 ${W} ${H}" role="img" aria-label="Assembly drawing of ${esc(e.name)}, layer by layer">
    <defs><pattern id="bp-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M 12 0 H 0 V 12" class="bp-gridline"/></pattern></defs>
    <rect width="${W}" height="${H}" fill="url(#bp-grid)" class="bp-paper"/>
    <text class="bp-head" x="12" y="18">Assembly · ${esc(e.name)}</text>
    ${axis}${body.join('')}${titleBlock}
  </svg>`;

  // The same steps in words.
  const steps: string[] = [];
  steps.push(`<li><b>Nucleus.</b> ${e.z} proton${e.z === 1 ? '' : 's'}${neutrons ? ` and ${neutrons} neutron${neutrons === 1 ? '' : 's'}` : ''}, packed into a ball about ${e.nucleusRadius.toFixed(1)} fm in radius.</li>`);
  if (core.length) steps.push(`<li><b>${CORE_NAME[e.core!] ?? e.core} core.</b> ${coreCount} electrons in ${core.map((s) => s.key).join(', ')}, the same as a finished ${CORE_NAME[e.core!]?.toLowerCase() ?? e.core} atom.</li>`);
  for (const s of outer) {
    const fill = orbitalFill(s.count, s.capacity);
    const single = fill.filter((k) => k === 1).length;
    const full = s.count === s.capacity;
    steps.push(`<li><b>${s.key}.</b> Add ${s.count} electron${s.count === 1 ? '' : 's'}${full ? ', filling it' : ` of a possible ${s.capacity}`}${single ? `; ${single} sit${single === 1 ? 's' : ''} alone` : ''}.</li>`);
  }
  return `<figure class="bp-figure">${svg}</figure>
    <ol class="bp-steps">${steps.join('')}</ol>
    <p class="note">An illustration, like an exploded drawing: real electrons are clouds, not rings, and the layers overlap rather than stack. Each pair of dots is one orbital; hollow dots are room to spare. The 3D tab shows the true shapes and sizes.</p>`;
}

// ---------- Structure, second and third views: the shells as they are, and the orbital boxes ----------

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
export function orbitalBoxes(e: Element): string {
  const byShell = new Map<number, Subshell[]>();
  for (const s of e.subshells) byShell.set(s.n, [...(byShell.get(s.n) ?? []), s]);
  const rows = [...byShell.entries()].sort((a, b) => b[0] - a[0]).map(([n, subs]) => {
    const groups = subs.sort((a, b) => L_OF[a.l] - L_OF[b.l]).map((s) => {
      const boxes = orbitalFill(s.count, s.capacity).map((k) => `<i class="ob-box${k === 1 ? ' is-lone' : ''}">${k >= 1 ? '<b>↑</b>' : ''}${k === 2 ? '<b>↓</b>' : ''}</i>`).join('');
      return `<div class="ob-group${s.core ? ' is-core' : ''}" style="--b:${BLOCK_COLOUR[s.l]}"><span class="ob-key">${s.key}</span><div class="ob-boxes">${boxes}</div></div>`;
    }).join('');
    return `<div class="ob-row"><span class="ob-shell">${SHELL_NAMES[n - 1]}</span><div class="ob-groups">${groups}</div></div>`;
  }).join('');
  const lone = e.unpaired;
  return `<div class="ob">${rows}</div>
    <p class="note">Each box is one orbital and holds two electrons of opposite spin. ${lone ? `${esc(e.name)} has ${lone} lone electron${lone === 1 ? '' : 's'}, lit in cyan.` : `Every electron in ${esc(e.name.toLowerCase())} is paired.`} The outermost shell is at the top; the noble-gas core is dimmed.</p>`;
}

export const STRUCTURE_VIEWS: { id: string; label: string }[] = [
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'shells', label: 'Shells' },
  { id: 'boxes', label: 'Orbitals' },
];

// ---------- Isotopes: an album of tiles ----------

/** 0..1 for how long an isotope lasts, on a log scale from a nanosecond to the age of the universe. */
export function lifeMeter(halfLife: number | null): number {
  if (halfLife == null || halfLife <= 0) return 0;
  return Math.max(0.03, Math.min(1, (Math.log10(halfLife) + 9) / (17.6 + 9)));
}

/** Which filter rows an isotope matches: stable, found in nature, radioactive. */
export function isotopeKinds(i: { stable: boolean; abundance: number | null }): string[] {
  const k = ['all'];
  if (i.stable) k.push('stable'); else k.push('radioactive');
  if (i.abundance != null) k.push('natural');
  return k;
}

export const ISO_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stable', label: 'Stable' },
  { id: 'natural', label: 'In nature' },
  { id: 'radioactive', label: 'Radioactive' },
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
    return `<rect class="${cls}" x="${f1(x + bw * 0.12)}" y="${f1(base - h)}" width="${f1(Math.max(1.5, bw * 0.76))}" height="${f1(h)}" rx="1" style="--v:${v.toFixed(3)}"><title>${e.symbol}-${i.a}: ${n} neutrons, ${i.stable ? 'stable' : formatHalfLife(i.halfLife)}</title></rect>`;
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

/** The isotope table: one row each, with its lifetime on the shared log ruler and its share of
 *  the natural element as a ring. Rows carry their kinds for the filter above. */
function isotopeRows(e: Element): string {
  const key = keyIsotope(e);
  return e.isotopes.map((i) => {
    const n = i.a - e.z;
    const v = i.stable ? 1 : lifeMeter(i.halfLife);
    const life = i.stable ? 'stable' : i.halfLife == null ? 'not known' : formatHalfLife(i.halfLife);
    const share = i.abundance == null ? '' : `${shareRing(i.abundance)}<span>${Number(i.abundance.toPrecision(3))}%</span>`;
    return `<div class="it-row${i.stable ? ' is-stable' : ''}${key && key.a === i.a ? ' is-key' : ''}" data-kinds="${isotopeKinds(i).join(' ')}">
      <div class="it-name"><b><sup>${i.a}</sup>${e.symbol}</b><span>${n} neutron${n === 1 ? '' : 's'}</span></div>
      <div class="it-life"><span class="it-track"><i style="--v:${v.toFixed(3)}"></i></span><span class="it-life-lab">${life}</span></div>
      <div class="it-share">${share || '<span class="na">—</span>'}</div>
    </div>`;
  }).join('');
}

export function isotopeTable(e: Element): string {
  const stable = e.isotopes.filter((i) => i.stable).length;
  const first = e.isotopes[0], last = e.isotopes[e.isotopes.length - 1];
  const counts = Object.fromEntries(ISO_FILTERS.map((f) => [f.id, e.isotopes.filter((i) => isotopeKinds(i).includes(f.id)).length]));
  return `<div class="iso-head">
      <div><b>${e.isotopes.length}</b><span>isotopes known</span></div>
      <div><b>${stable}</b><span>stable</span></div>
      <div><b>${first ? first.a - e.z : 0}–${last ? last.a - e.z : 0}</b><span>neutrons</span></div>
    </div>
    ${isotopeChart(e)}
    <div class="it-filter" id="iso-filter" data-counts='${JSON.stringify(counts)}'></div>
    <div class="it" id="iso-table" data-filter="all">
      <div class="it-row it-headrow" aria-hidden="true"><div>Isotope</div><div>How long it lasts</div><div>In nature</div></div>
      ${isotopeRows(e)}
      <p class="it-empty">None of ${esc(e.name.toLowerCase())}'s isotopes fit this filter.</p>
    </div>`;
}

// ---------- Properties: where this element sits among all of them ----------

interface Axis { label: string; get: (e: Element) => number | null; unit: string; log?: boolean; more: string; less: string; fmt?: (v: number) => string; temp?: boolean }

const AXES: Axis[] = [
  { label: 'Density', get: (e) => e.density, unit: ' g/cm³', log: true, more: 'densest', less: 'lightest' },
  { label: 'Melting point', get: (e) => e.melt, unit: ' K', more: 'highest melting point', less: 'lowest melting point', fmt: (v) => `${Math.round(v)}`, temp: true },
  { label: 'Boiling point', get: (e) => e.boil, unit: ' K', more: 'highest boiling point', less: 'lowest boiling point', fmt: (v) => `${Math.round(v)}`, temp: true },
  { label: 'Electronegativity', get: (e) => e.electronegativity, unit: '', more: 'most electronegative', less: 'least electronegative' },
  { label: 'First ionization energy', get: (e) => e.ionisation, unit: ' eV', more: 'hardest to ionize', less: 'easiest to ionize' },
  { label: 'Size (van der Waals)', get: (e) => e.vdw, unit: ' pm', more: 'largest', less: 'smallest', fmt: (v) => `${Math.round(v)}` },
  { label: 'In the crust', get: (e) => e.crust, unit: ' mg/kg', log: true, more: 'most common in the crust', less: 'rarest in the crust' },
  { label: 'In seawater', get: (e) => e.sea, unit: ' mg/L', log: true, more: 'most common in seawater', less: 'rarest in seawater' },
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

/** One property: the label and value on the left; on the right every measured element as a dot
 *  in its block's lane and color, this element ringed, the extremes named at the ends. */
function axisStrip(e: Element, a: Axis): string {
  // Values for the superheavy elements are predictions, so they are left out of the crowd.
  const all = ELEMENTS.map((x) => ({ x, v: a.get(x) })).filter((p): p is { x: Element; v: number } => p.v != null && (!a.log || p.v > 0) && (p.x.z < PREDICTED_FROM || p.x.z === e.z));
  const v = a.get(e);
  const W = 240, pad = 10, laneH = 9, top = 4, H = top * 2 + laneH * 4;
  const t = (x: number) => (a.log ? Math.log10(x) : x);
  const lo = Math.min(...all.map((p) => t(p.v))), hi = Math.max(...all.map((p) => t(p.v)));
  const X = (x: number) => pad + ((t(x) - lo) / (hi - lo || 1)) * (W - pad * 2);
  const Y = (b: Element['block']) => top + LANES.indexOf(b) * laneH + laneH / 2;
  const lanes = LANES.map((b) => `<path class="pr-lane" d="M ${pad} ${Y(b)} H ${W - pad}"/>`).join('');
  const dots = all.filter((p) => p.x.z !== e.z).map((p) => `<circle cx="${f1(X(p.v))}" cy="${Y(p.x.block)}" r="2.3" fill="${BLOCK_COLOUR[p.x.block]}"/>`).join('');
  const minE = all.reduce((m, p) => (p.v < m.v ? p : m)), maxE = all.reduce((m, p) => (p.v > m.v ? p : m));
  const fmt = a.fmt ?? fmtNum;
  const has = v != null && (!a.log || v > 0);
  let mark = '', rank = '';
  if (has) {
    const x = f1(X(v)), y = Y(e.block);
    rank = e.z >= PREDICTED_FROM ? 'a prediction' : rankWords(rankOf(v, all.map((p) => p.v)), all.length, a.more, a.less);
    mark = `<path class="pr-guide" d="M ${x} 1 V ${H - 1}"/><circle class="pr-me" cx="${x}" cy="${y}" r="4.6" fill="${BLOCK_COLOUR[e.block]}"/>`;
  }
  const value = v == null ? '<span class="na">not known</span>'
    : a.temp ? `${fmt(v)} K<small>${Math.round(v - 273.15)} °C</small>` : `${fmt(v)}${a.unit}`;
  return `<div class="pr">
    <div class="pr-text"><span class="pr-label">${a.label}</span><b class="pr-value">${value}</b>${rank ? `<em class="pr-rank">${rank}</em>` : ''}</div>
    <div class="pr-vis">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${lanes}<g class="pr-dots">${dots}</g>${mark}</svg>
      <div class="pr-ends"><span>${minE.x.symbol} ${fmt(minE.v)}</span><span>${maxE.x.symbol} ${fmt(maxE.v)}</span></div>
    </div>
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
    <div class="pr-text"><span class="pr-label">Oxidation states</span><b class="pr-value">${e.oxidation.length ? e.oxidation.map((o) => (o > 0 ? '+' + o : String(o))).join(', ') : '<span class="na">none listed</span>'}</b>${words ? `<em class="pr-rank">${words}</em>` : ''}</div>
    <div class="pr-vis"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg><div class="pr-ends"><span>← electrons gained</span><span>electrons given →</span></div></div>
  </div>`;
}

export function propertyAxes(e: Element): string {
  const legend = LANES.map((b) => `<span><i style="background:${BLOCK_COLOUR[b]}"></i>${b}</span>`).join('');
  return `<p class="pr-legend">Every dot is an element, in its block's lane and color: ${legend}. The ringed dot is ${esc(e.name.toLowerCase())}.</p>
    <div class="prs">${AXES.slice(0, 6).map((a) => axisStrip(e, a)).join('')}${oxidationStrip(e)}${AXES.slice(6).map((a) => axisStrip(e, a)).join('')}</div>`;
}

// ---------- Story: a timeline of discoveries ----------

export function discoveryTimeline(e: Element): string {
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
  const order = [...ELEMENTS].sort((a, b) => (a.discoveryYear ?? 0) - (b.discoveryYear ?? 0) || a.z - b.z);
  const rank = order.findIndex((x) => x.z === e.z) + 1;
  const caption = e.discoveryYear == null || e.discoveryYear < y0
    ? `${esc(e.name)} was known ${e.discoveryYear ? `by ${e.discoveryYear}` : 'in antiquity'}, one of ${known.length} elements known before chemistry became a science.`
    : `${esc(e.name)} was found in ${e.discoveryYear}, the ${ordinal(rank)} element to be identified.`;
  return `<figure class="tl">
    <svg class="tl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="When each element was discovered">
      <path class="tl-base" d="M ${left - 4} ${base + 2} H ${right}"/>
      <text class="tl-lab" x="${14 + 5.5}" y="${H - 6}">Old</text>
      ${ancient}${decades}${labels}
    </svg>
    <figcaption>${caption}</figcaption>
  </figure>`;
}
