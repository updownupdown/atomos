// The picture at the top of each science tab: a build blueprint for the
// structure, an album of isotope tiles, axes that place each property among
// all elements, and a timeline of discoveries. Plain SVG and HTML strings,
// coloured through the design tokens in style.css.

import { BLOCK_COLOUR, ELEMENTS, L_OF, formatHalfLife, keyIsotope, sup, type Element, type Subshell } from './data';

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
    <p class="note">An illustration, like an exploded drawing: real electrons are clouds, not rings, and the layers overlap rather than stack. Each pair of dots is one orbital; hollow dots are room to spare. The atom view shows the true shapes and sizes.</p>`;
}

// ---------- Isotopes: an album of tiles ----------

/** 0..1 for how long an isotope lasts, on a log scale from a nanosecond to the age of the universe. */
export function lifeMeter(halfLife: number | null): number {
  if (halfLife == null || halfLife <= 0) return 0;
  return Math.max(0.03, Math.min(1, (Math.log10(halfLife) + 9) / (17.6 + 9)));
}

export function isotopeAlbum(e: Element): string {
  const key = keyIsotope(e);
  const stable = e.isotopes.filter((i) => i.stable).length;
  const tiles = e.isotopes.map((i) => {
    const cls = ['iso-tile', i.stable ? 'is-stable' : '', key && i.a === key.a ? 'is-key' : ''].filter(Boolean).join(' ');
    const meter = i.stable ? (i.abundance ?? 0) / 100 : lifeMeter(i.halfLife);
    const caption = i.stable
      ? (i.abundance == null ? 'trace' : `${Number(i.abundance.toPrecision(3))}%`)
      : i.halfLife == null ? '?' : formatHalfLife(i.halfLife);
    return `<div class="${cls}" title="${e.symbol}-${i.a}: ${i.a - e.z} neutrons, ${i.stable ? 'stable' : 'half-life ' + caption}">
      <span class="iso-a">${i.a}</span><span class="iso-sym">${e.symbol}</span>
      <span class="iso-cap">${caption}</span><i class="iso-meter" style="--v:${meter.toFixed(3)}"></i></div>`;
  }).join('');
  const first = e.isotopes[0], last = e.isotopes[e.isotopes.length - 1];
  return `<div class="iso-head">
      <div><b>${e.isotopes.length}</b><span>isotopes known</span></div>
      <div><b>${stable}</b><span>stable</span></div>
      <div><b>${first ? first.a - e.z : 0}–${last ? last.a - e.z : 0}</b><span>neutrons</span></div>
    </div>
    <p class="iso-intro">Every ${esc(e.name.toLowerCase())} atom has ${e.z} proton${e.z === 1 ? '' : 's'}; the neutrons vary. Bright tiles are stable, with their share of natural ${esc(e.name.toLowerCase())}; the others decay, and their bar shows how long they last.</p>
    <div class="iso-album">${tiles}</div>`;
}

// ---------- Properties: where this element sits among all of them ----------

interface Axis { label: string; get: (e: Element) => number | null; unit: string; log?: boolean; more: string; less: string; fmt?: (v: number) => string }

const AXES: Axis[] = [
  { label: 'Density', get: (e) => e.density, unit: ' g/cm³', log: true, more: 'densest', less: 'lightest' },
  { label: 'Melting point', get: (e) => e.melt, unit: ' K', more: 'highest melting point', less: 'lowest melting point', fmt: (v) => `${Math.round(v)}` },
  { label: 'Boiling point', get: (e) => e.boil, unit: ' K', more: 'highest boiling point', less: 'lowest boiling point', fmt: (v) => `${Math.round(v)}` },
  { label: 'Electronegativity', get: (e) => e.electronegativity, unit: '', more: 'most electronegative', less: 'least electronegative' },
  { label: 'First ionisation energy', get: (e) => e.ionisation, unit: ' eV', more: 'hardest to ionise', less: 'easiest to ionise' },
  { label: 'Size (van der Waals)', get: (e) => e.vdw, unit: ' pm', more: 'largest', less: 'smallest', fmt: (v) => `${Math.round(v)}` },
  { label: 'In the crust', get: (e) => e.crust, unit: ' mg/kg', log: true, more: 'most common in the crust', less: 'rarest in the crust' },
  { label: 'In seawater', get: (e) => e.sea, unit: ' mg/L', log: true, more: 'most common in seawater', less: 'rarest in seawater' },
];

const fmtNum = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (_, p) => sup(p).replace('-', '⁻')) : `${Number(v.toPrecision(3))}`);

/** Rank of v among values, 1 = highest. */
export function rankOf(v: number, values: number[]): number {
  return values.filter((x) => x > v).length + 1;
}

function axisStrip(e: Element, a: Axis): string {
  const all = ELEMENTS.map((x) => ({ x, v: a.get(x) })).filter((p): p is { x: Element; v: number } => p.v != null && (!a.log || p.v > 0));
  const v = a.get(e);
  const W = 300, pad = 8;
  const t = (x: number) => (a.log ? Math.log10(x) : x);
  const lo = Math.min(...all.map((p) => t(p.v))), hi = Math.max(...all.map((p) => t(p.v)));
  const X = (x: number) => pad + ((t(x) - lo) / (hi - lo || 1)) * (W - pad * 2);
  const ticks = all.map((p) => `<path d="M ${f1(X(p.v))} 12 v 10"/>`).join('');
  const minE = all.reduce((m, p) => (p.v < m.v ? p : m)), maxE = all.reduce((m, p) => (p.v > m.v ? p : m));
  const fmt = a.fmt ?? fmtNum;
  let mark = '', caption = '<span class="na">not measured</span>';
  if (v != null && (!a.log || v > 0)) {
    const x = X(v);
    const r = rankOf(v, all.map((p) => p.v));
    const fromBottom = all.length - r + 1;
    caption = r <= all.length / 2
      ? (r === 1 ? `the ${a.more} of all ${all.length} measured` : `${ordinal(r)} ${a.more} of ${all.length}`)
      : (fromBottom === 1 ? `the ${a.less} of all ${all.length} measured` : `${ordinal(fromBottom)} ${a.less} of ${all.length}`);
    mark = `<path class="ax-mark" d="M ${f1(x)} 8 v 18"/><circle class="ax-dot" cx="${f1(x)}" cy="17" r="3.5"/>`;
  }
  return `<div class="ax">
    <div class="ax-top"><span>${a.label}</span><b>${v == null ? '<span class="na">not known</span>' : fmt(v) + a.unit}</b></div>
    <svg class="ax-svg" viewBox="0 0 ${W} 36" preserveAspectRatio="none" aria-hidden="true">
      <path class="ax-base" d="M ${pad} 17 H ${W - pad}"/><g class="ax-ticks">${ticks}</g>${mark}
    </svg>
    <div class="ax-ends"><span>${minE.x.symbol} ${fmt(minE.v)}</span><em>${caption}</em><span>${maxE.x.symbol} ${fmt(maxE.v)}</span></div>
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
  const W = 300, colW = W / states.length, H = 64;
  const mine = new Set(e.oxidation);
  const bars = states.map((s, i) => {
    const c = counts.get(s) ?? 0;
    const h = c ? 4 + (c / max) * (H - 24) : 0;
    const x = i * colW + 3;
    return `<rect class="${mine.has(s) ? 'ox-bar is-mine' : 'ox-bar'}" x="${f1(x)}" y="${f1(H - 16 - h)}" width="${f1(colW - 6)}" height="${f1(h)}" rx="1.5"/>`
      + `<text class="${mine.has(s) ? 'ox-lab is-mine' : 'ox-lab'}" x="${f1(x + (colW - 6) / 2)}" y="${H - 3}">${s > 0 ? '+' + s : s}</text>`;
  }).join('');
  const most = [...e.oxidation].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
  const words = e.oxidation.length
    ? `${esc(e.name)} shows ${e.oxidation.map((o) => (o > 0 ? '+' + o : String(o))).join(', ')}. ${most != null ? `${most > 0 ? '+' + most : most} is shared by ${counts.get(most)} elements.` : ''}`
    : `No common oxidation states are listed for ${esc(e.name.toLowerCase())}.`;
  return `<div class="ax ox">
    <div class="ax-top"><span>Oxidation states</span><b>${e.oxidation.length ? e.oxidation.map((o) => (o > 0 ? '+' + o : String(o))).join(', ') : '<span class="na">none listed</span>'}</b></div>
    <svg class="ox-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg>
    <p class="ax-note">${words} Bars count how many elements use each state.</p>
  </div>`;
}

export function propertyAxes(e: Element): string {
  return `<div class="axes">${AXES.slice(0, 6).map((a) => axisStrip(e, a)).join('')}${oxidationStrip(e)}${AXES.slice(6).map((a) => axisStrip(e, a)).join('')}</div>
    <p class="note">Each faint tick is another element; the bright one is ${esc(e.name.toLowerCase())}. Density and abundance use a log scale.</p>`;
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
