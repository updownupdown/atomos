// The data layer under each atom: everything the dataset knows about an
// element, as HTML for the View tabs. The top layer stays visual; this is the text
// and tables the player opens on purpose.

import { BLOCK_COLOUR, formatHalfLife, keyIsotope, shortConfiguration, sup, type Element } from './data';
import { ORBITAL_NAMES } from './orbital';
import FACTS from '../data/element-facts.json';
import STORY from '../data/element-story.json';
import IMAGES from '../data/element-images.json';
import { disclosureHTML } from '../ui/components';
import { loadSave, type SaveData } from '../core/save';
import { discoveryTimeline, isotopeTable, orbitalAssembly, propertyAxes, shellPlot } from './visuals';

export type Tab = 'overview' | 'structure' | 'isotopes' | 'properties' | 'story';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'story', label: 'Story' },
  { id: 'structure', label: 'Structure' },
  { id: 'isotopes', label: 'Isotopes' },
  { id: 'properties', label: 'Properties' },
];

/** The atom screen's View tabs: the 3D model first, then the text tabs. */
export type ViewTab = 'model' | Tab;
export const VIEW_TABS: { id: ViewTab; label: string }[] = [{ id: 'model', label: '3D' }, ...TABS];

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | null, unit = '', digits = 3) => (v == null ? '<span class="na">not known</span>' : `${Number(v.toPrecision(digits))}${unit}`);
const row = (label: string, value: string) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;

/** The captions round the 3D atom: decorators, worn like plate markings. Top left, the electron
 *  configuration large with its counts in small tracked capitals; top right, the isotopes, every
 *  one when they fit, else the first eight (stable ones by share, then the longest-lived) and
 *  how many more of each kind. */
export function decoratorsHTML(e: Element): { topLeft: string; topRight: string } {
  const plural = (n: number, word: string) => `<b>${n}</b> ${word}${n === 1 ? '' : 's'}`;
  const stable = e.isotopes.filter((i) => i.stable).sort((a, b) => (b.abundance ?? 0) - (a.abundance ?? 0));
  const unstable = e.isotopes.filter((i) => !i.stable).sort((a, b) => (b.halfLife ?? 0) - (a.halfLife ?? 0));
  const shown = [...stable, ...unstable].slice(0, ISO_SHOWN);
  const moreStable = stable.length - shown.filter((i) => i.stable).length;
  const moreUnstable = unstable.length - shown.filter((i) => !i.stable).length;
  const rows = shown.map((i) => `<li class="${i.stable ? 'is-stable' : ''}"${!i.stable && i.halfLife != null ? ` style="--fade:${fadeSeconds(i.halfLife).toFixed(2)}s"` : ''}><span>${e.symbol}-${i.a}</span><b>${i.stable
    ? (i.abundance == null ? 'trace' : `${Number(i.abundance.toPrecision(3))}%`)
    : i.halfLife == null ? 'unknown' : formatHalfLife(i.halfLife, true)}</b></li>`).join('');
  const more = [moreStable ? `+${moreStable} stable` : '', moreUnstable ? `+${moreUnstable} unstable` : ''].filter(Boolean);
  return {
    topLeft: `<span class="dec-config">${shortConfiguration(e)}</span>`
      + `<span class="dec-line">${plural(e.shells, 'shell')}</span>`
      + `<span class="dec-line">${plural(e.subshells.length, 'layer')}</span>`
      + `<span class="dec-line">${plural(e.z, 'electron')}</span>`
      + `<span class="dec-line"><b>${e.vdw}</b> pm radius${e.vdwEstimated ? ' (est.)' : ''}</span>`,
    topRight: `<span class="dec-cap">Isotopes</span><ul class="dec-iso">${rows}</ul>`
      + (more.length ? `<span class="dec-more">${more.join(' · ')}</span>` : ''),
  };
}
const ISO_SHOWN = 8;

/** How long a tapped isotope's line takes to fade back: a step per power of ten of its half-life,
 *  so a millisecond isotope blinks out, one of a few minutes fades over several seconds and one of
 *  millions of years lingers. Stable ones never fade (see .dec-tr.read). */
export function fadeSeconds(halfLife: number): number {
  return Math.min(30, Math.max(0.25, 3 + 1.4 * Math.log10(halfLife)));
}

export function layerPills(e: Element): string {
  return e.subshells.map((s) => s.core
    ? `<span class="pill core">${s.key}${sup(s.count)}</span>`
    : `<span class="pill" style="background:${BLOCK_COLOUR[s.l]}">${s.key}${sup(s.count)}</span>`).join('');
}

export function tabHTML(e: Element, tab: Tab, collected: boolean, save: SaveData = loadSave()): string {
  switch (tab) {
    case 'overview': return overview(e, collected);
    case 'structure': return structure(e);
    case 'isotopes': return isotopes(e, save);
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
  const photo = img
    ? `<figure class="ov-photo"><img src="${commons(img.file, 640)}" alt="${esc(img.caption)}" loading="lazy" decoding="async" onerror="this.closest('figure').classList.add('is-missing')">
        <figcaption><span>${esc(img.caption)}</span><span class="ov-credit">Photo <a href="${commonsPage(img.file)}" target="_blank" rel="noopener">${esc(img.author)}</a>, ${img.licenceUrl ? `<a href="${img.licenceUrl}" target="_blank" rel="noopener">${esc(img.licence)}</a>` : esc(img.licence)}, via Wikimedia Commons</span></figcaption></figure>`
    : '';
  // The element's card and where it sits, then its headline fact, then the photo and the rest.
  const stat = (v: string | number, label: string) => `<div><b>${v}</b><span>${label}</span></div>`;
  const hero = `<header class="ov-hero" style="--b:${BLOCK_COLOUR[e.block]}">
      <div class="ov-tile"><span class="ov-z">${e.z}</span><b>${e.symbol}</b><span class="ov-n">${esc(e.name)}</span><em>${e.weight == null ? `[${e.commonA}]` : Number(e.weight.toPrecision(5))}</em></div>
      <div class="ov-meta">
        <span class="ov-series">${esc(e.series)}</span>
        <div class="ov-stats">${stat(e.group ?? '–', 'Group')}${stat(e.period, 'Period')}${stat(e.block, 'Block')}${stat(e.z, 'Electrons')}</div>
        <span class="ov-conf">${shortConfiguration(e)}</span>
      </div>
    </header>`;
  void collected; // the Build button carries collection progress now
  return `
    ${hero}
    <p class="ov-headline">${facts ? esc(facts.h) : esc(e.description) || `${esc(e.name)} is element ${e.z}.`}</p>
    ${photo}
    ${facts ? `<ul class="ov-facts">${facts.f.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <h3 class="story-h">Uses</h3>${storyList(storyLists(e).uses)}
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
    <div class="st-switch" id="struct-switch"></div>
    <div class="st-view" data-view="orbitals">${orbitalAssembly(e)}</div>
    <div class="st-view" data-view="shells" hidden>${shellPlot(e)}</div>
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

function isotopes(e: Element, _save: SaveData): string {
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
    <section class="info-card"><h3>Additional Details</h3>
    ${row('Electron affinity', e.electronAffinity != null && e.electronAffinity < 0 ? '<span class="na">no stable negative ion</span>' : num(e.electronAffinity, ' eV'))}
    ${row('Geochemical class', e.geochemical ? esc(e.geochemical) : '<span class="na">not classed</span>')}
    ${row('CPK color', e.cpk ? `<span class="swatch" style="background:${e.cpk}"></span>${e.cpk}` : '<span class="na">none</span>')}
    ${row('Covalent radius', num(e.covalent, ' pm'))}
    ${row('Atomic weight', num(e.weight, '', 6))}</section>`;
}

/** Origins and uses as short bullet lists (src/data/element-story.json, American spelling);
 *  the dataset's prose, split into sentences, if an element has none. */
function storyLists(e: Element): { origins: string[]; uses: string[] } {
  const own = (STORY as { z: number; origins: string[]; uses: string[] }[])[e.z - 1];
  if (own && own.z === e.z) return own;
  const split = (t: string | null) => (t ?? '').split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
  return { origins: split(e.sources), uses: split(e.uses) };
}

const storyList = (items: string[]) => items.length
  ? `<ul class="story-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
  : '<p class="na">Not recorded.</p>';

function story(e: Element): string {
  const { origins } = storyLists(e);
  const list = storyList;
  const ancient = !e.discoveryYear;
  return `
    ${e.nameOrigin ? `<blockquote class="story-name"><span>The name</span>${esc(e.nameOrigin)}</blockquote>` : ''}
    <section class="story-disc">
      <div class="story-when"><span class="story-cap">Discovered</span><b class="story-year">${ancient ? 'In antiquity' : e.discoveryYear}</b></div>
      <div class="story-by">
        ${e.discoverers ? `<p class="story-who">${esc(e.discoverers)}</p>` : ancient ? '<p class="story-who">No one discoverer is recorded</p>' : ''}
        ${e.discoveryPlace ? `<p class="story-where">${esc(e.discoveryPlace)}</p>` : ''}
      </div>
    </section>
    ${discoveryTimeline(e)}
    <h3 class="story-h">Origins</h3>${list(origins)}`;
}
