// The data layer under each atom: everything the dataset knows about an
// element, as HTML for the View tabs. The top layer stays visual; this is the text
// and tables the player opens on purpose.

import { BLOCK_COLOUR, elementAt as elementAtZ, formatHalfLife, keyIsotope, shortConfiguration, sup, type Element } from './data';
import { ORBITAL_NAMES } from './orbital';
import FACTS from '../data/element-facts.json';
import STORY from '../data/element-story.json';
import IMAGES from '../data/element-images.json';
import { disclosureHTML } from '../ui/components';
import { loadSave, type SaveData } from '../core/save';
import { discoveryTimeline, discoveryWords, isotopeTable, orbitalAssembly, orbitalTogether, propertyAxes, shellPlot } from './visuals';
import { layout } from './layouts';
import { lookColor, inkOn } from './looks';
import { icon } from '../ui/icons';
import './info.css';

export type Tab = 'overview' | 'structure' | 'isotopes' | 'properties';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
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
  const more = [moreStable ? `+${moreStable} stable` : '', moreUnstable ? `+${moreUnstable} fleeting` : ''].filter(Boolean);
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

/** A small periodic table with this atom lit, the way back to it in the Atlas. */
function locator(e: Element): string {
  const { cells } = layout('table');
  const x0 = Math.min(...cells.map((c) => c.x)), y0 = Math.min(...cells.map((c) => c.y));
  const x1 = Math.max(...cells.map((c) => c.x + c.w)), y1 = Math.max(...cells.map((c) => c.y + c.h));
  const me = cells.find((c) => c.z === e.z)!;
  const rect = (c: (typeof cells)[number], cls: string) => `<rect class="${cls}" x="${(c.x - x0 + 0.06).toFixed(2)}" y="${(c.y - y0 + 0.06).toFixed(2)}" width="${(c.w - 0.12).toFixed(2)}" height="${(c.h - 0.12).toFixed(2)}" rx="0.14"/>`;
  const same = (c: (typeof cells)[number]) => elementAtZ(c.z).period === e.period && elementAtZ(c.z).group !== null;
  const rows = cells.filter((c) => c.z !== e.z).map((c) => rect(c, same(c) ? 'lc-row' : 'lc-cell')).join('');
  return `<button type="button" class="ov-locate" data-z="${e.z}" aria-label="Show ${esc(e.name.toLowerCase())} in the Atlas">
    <svg viewBox="0 0 ${(x1 - x0).toFixed(2)} ${(y1 - y0).toFixed(2)}" aria-hidden="true">${rows}<g style="--p:${lookColor('place', e)}">${rect(me, 'lc-me')}</g></svg>
  </button>`;
}

function overview(e: Element, collected: boolean): string {
  const img = elementImage(e.z);
  const facts = elementFacts(e.z);
  // The real thing first, when there is a photo of it.
  const photo = img
    ? `<figure class="ov-photo"><img src="${commons(img.file, 640)}" alt="${esc(img.caption)}" loading="lazy" decoding="async" onerror="this.closest('figure').classList.add('is-missing')">
        <figcaption><span>${esc(img.caption)}</span><span class="ov-credit">Photo <a href="${commonsPage(img.file)}" target="_blank" rel="noopener">${esc(img.author)}</a>, ${img.licenceUrl ? `<a href="${img.licenceUrl}" target="_blank" rel="noopener">${esc(img.licence)}</a>` : esc(img.licence)}, via Wikimedia Commons</span></figcaption></figure>`
    : '';
  // Its plate in its place color, the little table with it lit, and where it sits in words.
  const fill = lookColor('place', e);
  const weight = e.weight == null ? `[${e.commonA}]` : `${Number(e.weight.toPrecision(5))}`;
  const where = [e.group == null ? (e.z < 90 ? 'Lanthanide' : 'Actinide') : `Group ${e.group}`, `Period ${e.period}`].join(' · ');
  const stat = (label: string, value: string) => `<span class="ov-stat"><small>${label}</small><b>${value}</b></span>`;
  const band = `<header class="ov-band">
      <div class="ov-plate" style="background:${fill};color:${inkOn(fill)}"><span>${e.z}</span><b>${e.symbol}</b></div>
      <p class="ov-where"><b>${esc(e.series)}</b><span>${where}</span></p>
      ${locator(e)}
      <div class="ov-stats">${stat('Weight', weight)}${stat('Electrons', shortConfiguration(e))}${stat('Block', e.block)}</div>
    </header>`;
  void collected; // the Build button carries collection progress now
  // Each line appears once: Made in and Used for (and the name's origin) skip anything the
  // headline or facts above already say.
  const headline = facts ? facts.h : e.description || `${e.name} is element ${e.z}.`;
  const highlights = [headline, ...(facts?.f ?? [])];
  const { origins, uses } = storyLists(e);
  const [keptOrigins, keptUses] = unrepeated(highlights, [origins, uses]);
  // The name's origin is a short line, so it only counts as said when a fact is about the name or symbol.
  const naming = highlights.filter((h) => /\b(nam(e|ed|es)|symbol)\b/i.test(h));
  const name = e.nameOrigin && !naming.some((h) => overlap(e.nameOrigin!, h) >= REPEAT) ? [e.nameOrigin] : [];
  const ancient = !e.discoveryYear || e.discoveryYear < 1650;
  // "Known to the ancients" only repeats the line above it.
  const who = e.discoverers && !(ancient && /ancient|prehistor|antiquity/i.test(e.discoverers)) ? e.discoverers : '';
  const by = [who, e.discoveryPlace ?? ''].filter(Boolean).map(esc).join(' · ');
  return `
    ${band}
    ${photo}
    <p class="ov-headline">${esc(headline)}</p>
    ${facts ? `<ul class="ov-facts">${facts.f.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${name.length ? `<blockquote class="story-name"><span>The name</span>${esc(name[0])}</blockquote>` : ''}
    <section class="ov-disc">
      <span class="story-cap">Discovered</span>
      <div class="ov-disc-row"><b class="story-year">${!e.discoveryYear ? 'In antiquity' : e.discoveryYear}</b><span>${discoveryWords(e, true)}</span></div>
      ${by ? `<p class="ov-disc-by">${by}</p>` : ''}
      ${discoveryTimeline(e, false)}
    </section>
    ${keptOrigins.length ? `<h3 class="story-h">Made in</h3>${storyList(keptOrigins)}` : ''}
    ${keptUses.length ? `<h3 class="story-h">Used for</h3>${storyList(keptUses)}` : ''}
    ${e.z >= 104 ? '<p class="note">Elements from rutherfordium on have only been made a few atoms at a time; their electron arrangements are predictions, not measurements.</p>' : ''}`;
}

/** Words that say little on their own, left out when comparing lines. */
const FILLER = new Set('the a an of and in to is it its as for by with from on at or that this are was be their than into which used use uses most more made make also'.split(' '));
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !FILLER.has(w)).map((w) => w.slice(0, 6)));

/** How much two lines say the same thing: shared words over the shorter line's words (0 to 1). */
export function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/** Lines at or above this overlap repeat an earlier one. Tuned on all 118 elements:
 *  at half the words shared, nearly every pair is the same fact said twice. */
const REPEAT = 0.5;

/** Each group's lines, minus any that repeat something shown before them (the
 *  highlights, an earlier group, or an earlier line of the same group). */
export function unrepeated(highlights: string[], groups: string[][]): string[][] {
  const seen = [...highlights];
  return groups.map((g) => g.filter((line) => {
    if (seen.some((s) => overlap(line, s) >= REPEAT)) return false;
    seen.push(line);
    return true;
  }));
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
    <div class="st-top"><div class="st-switch" id="struct-switch"></div><button type="button" class="st-3d" data-z="${e.z}" aria-label="See ${esc(e.name.toLowerCase())} in 3D, full screen">3D${icon('fullscreen', { size: 18 })}</button></div>
    <div class="st-view" data-view="together">${orbitalTogether(e)}</div>
    <div class="st-view" data-view="orbitals" hidden>${orbitalAssembly(e)}</div>
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
  return isotopeTable(e);
}

function properties(e: Element): string {
  return propertyAxes(e);
}

/** Origins and uses as short bullet lists (src/data/element-story.json, American spelling);
 *  the dataset's prose, split into sentences, if an element has none. */
function storyLists(e: Element): { origins: string[]; uses: string[] } {
  const own = (STORY as { z: number; origins: string[]; uses: string[] }[])[e.z - 1];
  if (own && own.z === e.z) return own;
  const split = (t: string | null) => (t ?? '').split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
  return { origins: split(e.sources), uses: split(e.uses) };
}

/** Two lines, and the rest folded under "More". */
const storyList = (items: string[]) => {
  if (!items.length) return '<p class="na">Not recorded.</p>';
  const li = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join('');
  const rest = items.slice(2);
  return `<ul class="story-list">${li(items.slice(0, 2))}</ul>`
    + (rest.length ? `<details class="story-more"><summary>${rest.length} more</summary><ul class="story-list">${li(rest)}</ul></details>` : '');
};

