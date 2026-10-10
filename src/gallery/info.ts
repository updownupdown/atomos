// The data layer under each atom: everything the dataset knows about an
// element, as HTML for the View tabs. The top layer stays visual; this is the text
// and tables the player opens on purpose.

import { BLOCK_COLOUR, formatHalfLife, keyIsotope, shortConfiguration, sup, type Element } from './data';
import { ORBITAL_NAMES } from './orbital';
import FACTS from '../data/element-facts.json';
import IMAGES from '../data/element-images.json';
import { disclosureHTML } from '../ui/components';
import { blueprint, discoveryTimeline, isotopeTable, propertyAxes } from './visuals';

export type Tab = 'overview' | 'structure' | 'isotopes' | 'properties' | 'story';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'structure', label: 'Structure' },
  { id: 'isotopes', label: 'Isotopes' },
  { id: 'properties', label: 'Properties' },
  { id: 'story', label: 'Story' },
];

/** The atom screen's View tabs: the 3D model first, then the text tabs. */
export type ViewTab = 'model' | Tab;
export const VIEW_TABS: { id: ViewTab; label: string }[] = [{ id: 'model', label: '3D' }, ...TABS];

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | null, unit = '', digits = 3) => (v == null ? '<span class="na">not known</span>' : `${Number(v.toPrecision(digits))}${unit}`);
const row = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;

/** Small white captions round the loupe: the simple layer, worn like plate markings. */
export function decoratorsHTML(e: Element, collected: boolean): { topLeft: string; isoSummary: string; isoList: string; name: string; pick: string } {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const key = keyIsotope(e);
  const stable = e.isotopes.filter((i) => i.stable);
  const isoSummary = stable.length
    ? plural(stable.length, 'stable isotope')
    : `no stable isotope`;
  // Stable ones with their share of the natural element; otherwise the longest-lived few.
  const rows = stable.length
    ? stable.map((i) => `<li><span>${e.symbol}-${i.a}</span><b>${i.abundance == null ? 'trace' : `${Number(i.abundance.toPrecision(3))}%`}</b></li>`)
    : [...e.isotopes].filter((i) => i.halfLife != null).sort((a, b) => b.halfLife! - a.halfLife!).slice(0, 4)
      .map((i) => `<li><span>${e.symbol}-${i.a}</span><b>${formatHalfLife(i.halfLife)}</b></li>`);
  const isoList = `<ul>${rows.join('')}</ul><p>${plural(e.isotopes.length, 'isotope')} known${stable.length ? '' : `, longest-lived ${e.symbol}-${key?.a ?? e.commonA}`}</p>`;
  return {
    topLeft: `<span class="dec-config">${shortConfiguration(e)}</span>`
      + `<span>${plural(e.shells, 'shell')} · ${plural(e.subshells.length, 'layer')}</span>`
      + `<span>${plural(e.z, 'electron')}</span>`
      + `<span>${e.vdw} pm radius${e.vdwEstimated ? ', estimated' : ''}</span>`
      + (collected ? '' : '<span class="dim">not yet collected</span>'),
    isoSummary,
    isoList,
    name: esc(e.name),
    pick: `<span class="dec-z">${e.z}</span><span class="dec-sym">${e.symbol}</span>`,
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

/** An openly licensed photo of the element, hotlinked from Wikimedia Commons with its credit. */
export interface ElementImage { z: number; file: string; author: string; licence: string; licenceUrl?: string; caption: string }
const IMAGE_BY_Z = new Map((IMAGES as ElementImage[]).map((i) => [i.z, i]));
const commons = (file: string, width: number) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
const commonsPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;

export function elementImage(z: number): ElementImage | null {
  return IMAGE_BY_Z.get(z) ?? null;
}

export function elementFacts(z: number): { h: string; f: string[] } | null {
  return (FACTS as { h: string; f: string[] }[])[z - 1] ?? null;
}

function overview(e: Element, collected: boolean): string {
  const img = elementImage(e.z);
  const facts = elementFacts(e.z);
  const where = e.group ? `Group ${e.group} · period ${e.period}` : `Period ${e.period}`;
  const photo = img
    ? `<figure class="ov-photo"><img src="${commons(img.file, 640)}" alt="${esc(img.caption)}" loading="lazy" decoding="async" onerror="this.closest('figure').classList.add('is-missing')">
        <figcaption><span>${esc(img.caption)}</span><span class="ov-credit">Photo <a href="${commonsPage(img.file)}" target="_blank" rel="noopener">${esc(img.author)}</a>, ${img.licenceUrl ? `<a href="${img.licenceUrl}" target="_blank" rel="noopener">${esc(img.licence)}</a>` : esc(img.licence)}, via Wikimedia Commons</span></figcaption></figure>`
    : '';
  const label = `<div class="ov-label">
      <div class="ov-tile" style="--b:${BLOCK_COLOUR[e.block]}"><span>${e.z}</span><b>${e.symbol}</b><em>${e.weight == null ? '' : Number(e.weight.toPrecision(5))}</em></div>
      <div class="ov-meta"><b>${esc(e.series)}</b><span>${where} · ${e.block} block</span><span>${e.z} electrons · ${shortConfiguration(e)}</span></div>
    </div>`;
  return `
    ${photo}
    ${label}
    <p class="ov-headline">${facts ? esc(facts.h) : esc(e.description) || `${esc(e.name)} is element ${e.z}.`}</p>
    ${facts ? `<ul class="ov-facts">${facts.f.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${e.z >= 104 ? '<p class="note">Elements from rutherfordium on have only been made a few atoms at a time; their electron arrangements are predictions, not measurements.</p>' : ''}
    <section class="ov-collection ${collected ? 'is-in' : ''}">
      <h4>In your collection</h4>
      <p>${collected ? `${esc(e.name)} is in your collection.` : `Not collected yet. Solve puzzles to bring ${esc(e.name.toLowerCase())} into your collection.`}</p>
    </section>`;
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
    ${blueprint(e)}
    ${disclosureHTML({ title: 'All the numbers', hint: `${e.subshells.length} layers`, body: `
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
    ${row('Cloud to nucleus', `about ${Math.round((e.vdw * 1e3) / e.nucleusRadius / 1000)},000 to 1`)}` })}`;
}

function isotopes(e: Element): string {
  const rows = e.isotopes.map((i) => `<tr class="${i.stable ? 'stable' : ''}">
    <td>${e.symbol}-${i.a}</td><td>${i.a - e.z}</td><td>${i.mass == null ? '' : i.mass.toFixed(3)}</td>
    <td>${i.abundance == null ? '' : i.abundance + '%'}</td><td>${i.stable ? 'stable' : i.halfLife == null ? '<span class="na">not known</span>' : formatHalfLife(i.halfLife)}</td><td>${i.spin ?? ''}</td></tr>`).join('');
  return `
    ${isotopeTable(e)}
    ${disclosureHTML({ title: 'All the numbers', hint: `${e.isotopes.length} isotopes`, body: `<div class="tablewrap"><table>
      <thead><tr><th>Isotope</th><th>Neutrons</th><th>Mass</th><th>Abundance</th><th>Half-life</th><th>Spin</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` })}
    `;
}

function properties(e: Element): string {
  return `
    ${propertyAxes(e)}
    ${disclosureHTML({ title: 'More about it', body: `
    ${row('Electron affinity', e.electronAffinity != null && e.electronAffinity < 0 ? '<span class="na">no stable negative ion</span>' : num(e.electronAffinity, ' eV'))}
    ${row('Geochemical class', e.geochemical ? esc(e.geochemical) : '<span class="na">not classed</span>')}
    ${row('CPK color', e.cpk ? `<span class="swatch" style="background:${e.cpk}"></span>${e.cpk}` : '<span class="na">none</span>')}
    ${row('Covalent radius', num(e.covalent, ' pm'))}
    ${row('Atomic weight', num(e.weight, '', 6))}` })}`;
}

function story(e: Element): string {
  return `
    ${discoveryTimeline(e)}
    ${e.nameOrigin ? `<blockquote class="story-name"><span>The name</span>${esc(e.nameOrigin)}</blockquote>` : ''}
    ${row('Discovery', e.discoveryYear ? `${e.discoveryYear}${e.discoveryPlace ? ', ' + esc(e.discoveryPlace) : ''}` : 'known since antiquity')}
    ${row('Discovered by', e.discoverers ? esc(e.discoverers) : '<span class="na">not recorded</span>')}
    <h4>Where it comes from</h4><p>${esc(e.sources) || '<span class="na">Not recorded.</span>'}</p>
    <h4>What it is used for</h4><p>${esc(e.uses) || '<span class="na">Not recorded.</span>'}</p>`;
}
