// The data layer under each atom: everything the dataset knows about an
// element, as HTML for the sheet. The top layer stays visual; this is the text
// and tables the player opens on purpose.

import { BLOCK_COLOUR, formatHalfLife, keyIsotope, shortConfiguration, sup, type Element } from './data';
import { ORBITAL_NAMES } from './orbital';

export type Tab = 'overview' | 'structure' | 'isotopes' | 'properties' | 'story';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'structure', label: 'Structure' },
  { id: 'isotopes', label: 'Isotopes' },
  { id: 'properties', label: 'Properties' },
  { id: 'story', label: 'Story' },
];

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | null, unit = '', digits = 3) => (v == null ? '<span class="na">not known</span>' : `${Number(v.toPrecision(digits))}${unit}`);
const kelvin = (k: number | null) => (k == null ? '<span class="na">not known</span>' : `${Math.round(k)} K <span class="dim">(${Math.round(k - 273.15)} °C)</span>`);
const row = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;

/** Small white captions round the loupe: the simple layer, worn like plate markings. */
export function decoratorsHTML(e: Element, collected: boolean): { topLeft: string; topRight: string; bottom: string; name: string } {
  const key = keyIsotope(e);
  const iso = e.stableIsotopes
    ? `${e.stableIsotopes} stable isotope${e.stableIsotopes > 1 ? 's' : ''}`
    : `no stable isotope<br>${e.symbol}-${key?.a ?? e.commonA} · ${formatHalfLife(key?.halfLife ?? null)}`;
  return {
    topLeft: `<span>${e.shells} shell${e.shells > 1 ? 's' : ''}</span><span>${e.subshells.length} layer${e.subshells.length > 1 ? 's' : ''}</span><span>${e.z} electron${e.z > 1 ? 's' : ''}</span><span>${e.vdw} pm${e.vdwEstimated ? ' ~' : ''}</span>`,
    topRight: `<span>${iso}</span><span>${e.isotopes.length} known</span>${collected ? '' : '<span class="dim">not yet collected</span>'}`,
    bottom: shortConfiguration(e),
    name: `<span class="dec-z">${e.z}</span><span class="dec-sym">${e.symbol}</span><span class="dec-name">${esc(e.name)}</span>`,
  };
}


export function layerPills(e: Element): string {
  return e.subshells.map((s) => s.core
    ? `<span class="pill core">${s.key}${sup(s.count)}</span>`
    : `<span class="pill" style="background:${BLOCK_COLOUR[s.l]}">${s.key}${sup(s.count)}</span>`).join('');
}

export function tabHTML(e: Element, tab: Tab, collected: boolean): string {
  switch (tab) {
    case 'overview': return overview(e, collected);
    case 'structure': return structure(e);
    case 'isotopes': return isotopes(e);
    case 'properties': return properties(e);
    case 'story': return story(e);
  }
}

function overview(e: Element, collected: boolean): string {
  const where = e.group ? `group ${e.group}, period ${e.period}` : `period ${e.period}`;
  return `
    <p class="lead">${esc(e.description) || `${esc(e.name)} is element ${e.z}, in the ${e.block} block of the table.`}</p>
    ${row('Series', esc(e.series))}
    ${row('Place in the table', `${where}, ${e.block} block`)}
    ${row('Atomic weight', e.weight == null ? '<span class="na">not known</span>' : `${e.weight}`)}
    ${row('Electrons', `${e.z}, as ${shortConfiguration(e)}`)}
    ${row('Discovered', e.discoveryYear ? `${e.discoveryYear}${e.discoverers ? ', ' + esc(e.discoverers) : ''}` : 'known since antiquity')}
    ${row('In your collection', collected ? 'yes' : 'not yet')}
    ${e.z >= 104 ? '<p class="note">Elements from rutherfordium on have only been made a few atoms at a time; their electron arrangements are predictions, not measurements.</p>' : ''}`;
}

function structure(e: Element): string {
  const shells = new Map<number, number>();
  for (const s of e.subshells) shells.set(s.n, (shells.get(s.n) ?? 0) + s.count);
  const shellRow = [...shells.entries()].map(([n, c]) => `<span class="shell"><b>${c}</b>${['K', 'L', 'M', 'N', 'O', 'P', 'Q'][n - 1]} (n=${n})</span>`).join('');
  const layers = e.subshells.map((s) => {
    const filled = Math.min(s.count, s.capacity / 2);
    const names = ORBITAL_NAMES[s.l].slice(0, filled).join(', ');
    return `<tr class="${s.core ? 'core' : ''}"><td><span class="dot" style="background:${BLOCK_COLOUR[s.l]}"></span>${s.key}</td><td>${s.count} / ${s.capacity}</td><td>${filled}</td><td class="l">${names}</td><td>${s.core ? 'core' : 'outer'}</td></tr>`;
  }).join('');
  const key = keyIsotope(e);
  return `
    ${row('Configuration', `${e.configuration.split(' ').map((s) => s.slice(0, 2) + sup(s.slice(2))).join(' ')}`)}
    ${row('Short form', shortConfiguration(e))}
    <div class="shells">${shellRow}</div>
    <div class="tablewrap"><table>
      <thead><tr><th>Layer</th><th>Electrons</th><th>Orbitals</th><th class="l">Orbitals in use</th><th></th></tr></thead>
      <tbody>${layers}</tbody></table></div>
    ${row('Occupied orbitals', `${e.orbitals}`)}
    ${row('Unpaired electrons', `${e.unpaired}`)}
    ${row('Van der Waals radius', `${e.vdw} pm${e.vdwEstimated ? ' <span class="dim">(estimated from the element above it)</span>' : ''}`)}
    ${row('Covalent radius', num(e.covalent, ' pm'))}
    ${row('Nucleus', `${key ? `${e.z} protons, ${key.a - e.z} neutrons (${e.symbol}-${key.a})` : `${e.z} protons`}, radius about ${e.nucleusRadius.toFixed(1)} fm`)}
    ${row('Cloud to nucleus', `about ${Math.round((e.vdw * 1e3) / e.nucleusRadius / 1000)},000 to 1`)}
    <p class="note">The drawn atom scales its outer layer to the van der Waals radius; spacing between layers follows hydrogen-like orbitals with Slater's effective charges. Lobes are sharpened a little for legibility.</p>`;
}

function isotopes(e: Element): string {
  const rows = e.isotopes.map((i) => `<tr class="${i.stable ? 'stable' : ''}">
    <td>${e.symbol}-${i.a}</td><td>${i.a - e.z}</td><td>${i.mass == null ? '' : i.mass.toFixed(3)}</td>
    <td>${i.abundance == null ? '' : i.abundance + '%'}</td><td>${i.stable ? 'stable' : i.halfLife == null ? '<span class="na">not known</span>' : formatHalfLife(i.halfLife)}</td><td>${i.spin ?? ''}</td></tr>`).join('');
  return `
    ${row('Stable isotopes', `${e.stableIsotopes}`)}
    ${row('Known isotopes', `${e.isotopes.length}`)}
    <div class="tablewrap"><table>
      <thead><tr><th>Isotope</th><th>Neutrons</th><th>Mass</th><th>Abundance</th><th>Half-life</th><th>Spin</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="note">Half-lives from the mendeleev dataset; stable means observationally stable.</p>`;
}

function properties(e: Element): string {
  return `
    ${row('Density', num(e.density, ' g/cm³'))}
    ${row('Melting point', kelvin(e.melt))}
    ${row('Boiling point', kelvin(e.boil))}
    ${row('Electronegativity (Pauling)', num(e.electronegativity))}
    ${row('First ionisation energy', num(e.ionisation, ' eV', 4))}
    ${row('Electron affinity', num(e.electronAffinity, ' eV'))}
    ${row('Oxidation states', e.oxidation.length ? e.oxidation.map((o) => (o > 0 ? '+' + o : String(o))).join(', ') : '<span class="na">none listed</span>')}
    ${row('Abundance in the crust', num(e.crust, ' mg/kg'))}
    ${row('Abundance in seawater', num(e.sea, ' mg/L'))}
    ${row('Geochemical class', e.geochemical ? esc(e.geochemical) : '<span class="na">not classed</span>')}
    ${row('CPK colour', e.cpk ? `<span class="swatch" style="background:${e.cpk}"></span>${e.cpk}` : '<span class="na">none</span>')}`;
}

function story(e: Element): string {
  return `
    ${row('Name', esc(e.nameOrigin) || '<span class="na">origin not recorded</span>')}
    ${row('Discovery', e.discoveryYear ? `${e.discoveryYear}${e.discoveryPlace ? ', ' + esc(e.discoveryPlace) : ''}` : 'known since antiquity')}
    ${row('Discovered by', e.discoverers ? esc(e.discoverers) : '<span class="na">not recorded</span>')}
    <h4>Where it comes from</h4><p>${esc(e.sources) || '<span class="na">Not recorded.</span>'}</p>
    <h4>What it is used for</h4><p>${esc(e.uses) || '<span class="na">Not recorded.</span>'}</p>`;
}
