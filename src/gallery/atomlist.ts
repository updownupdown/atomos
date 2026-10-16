// The atom list: every atom in one plain list, for getting from one atom to another quickly. The
// header's atom dropdown opens it on an atom's Build page or Atlas page, as the standard modal
// sheet (ui/sheet.ts, as Search and Settings): the atom icon and Atoms, and the X. It opens as
// the list of the section the player is in. No pictures, so it opens at once.
//   Collect is built for progress: the whole collection's three rings on top, then the periods,
//   each heading carrying its stable and fleeting percents, and per atom its number, symbol,
//   name and two bars (stable parts, fleeting isotopes). Nu swims round the bar of the next thing
//   to build. At the foot, Next goes to the Up next atom.
//   Learn is built for finding: a search field and a dropdown of the sorts (Number, A to Z,
//   Family, Year found) on one row, and per atom its number, symbol, name and family, and its
//   weight (or the year it was found). Each group's heading carries its count: "Period 1 (2)".
// Tapping a row picks that atom and closes the list, as do the X, the mask, Escape and Back.
//
//   openAtomList({ current: 26, tab: 'collect', onPick: (z) => show(z) });

import { ELEMENTS, MAX_Z, elementAt, placeColour, type Element } from './data';
import { atomBuilt, fleetingCount, rowOpen, rowSpan, segmentsOf } from '../core/progress';
import { loadSave, type SaveData } from '../core/save';
import { nextStep } from '../core/next';
import { fleetingOpen } from './locks';
import { icon } from '../ui/icons';
import { nextButton } from '../ui/components';
import { openSheet, sheetSearch, type Sheet } from '../ui/sheet';
import { searchElements } from '../ui/search';
import { COL, sortElements, type SortKey } from '../ui/elementlist';
import './atomlist.css';

export type AtomListTab = 'collect' | 'learn';

export interface AtomListOptions {
  /** The atom on screen now: marked in the list and scrolled to. */
  current: number;
  /** The tab it opens on: the section the player is in. */
  tab: AtomListTab;
  /** A row (or Next) was tapped: the list has started closing. */
  onPick: (z: number) => void;
  /** The list closed, picked or not. */
  onClose?: () => void;
}

/** The whole collection: atoms built, and the shares of the stable parts and fleeting
 *  isotopes built, from 0 to 1. */
export function collectionProgress(save: SaveData): { built: number; atoms: number; stable: number; fleeting: number } {
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = 1; z <= MAX_Z; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((s) => s.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  return { built, atoms: MAX_Z, stable: st ? sb / st : 0, fleeting: ft ? fb / ft : 0 };
}

/** One period's stable and fleeting shares, from 0 to 1. */
export function periodShares(period: number, save: SaveData): { built: number; atoms: number; stable: number; fleeting: number } {
  const [first, last] = rowSpan(period);
  let built = 0, sb = 0, st = 0, fb = 0, ft = 0;
  for (let z = first; z <= last; z++) {
    if (atomBuilt(z, save)) built++;
    const segs = segmentsOf(z, save);
    sb += segs.filter((s) => s.done).length;
    st += segs.length;
    const f = fleetingCount(z, save);
    fb += f.built;
    ft += f.total;
  }
  return { built, atoms: last - first + 1, stable: st ? sb / st : 0, fleeting: ft ? fb / ft : 0 };
}

/** One atom's two shares: its stable parts, and its fleeting isotopes (null when it has none
 *  or they are not open yet). */
export function atomShares(z: number, save: SaveData, fleetOn = fleetingOpen(save)): { stable: number; fleeting: number | null } {
  const segs = segmentsOf(z, save);
  const f = fleetingCount(z, save);
  return {
    stable: segs.length ? segs.filter((s) => s.done).length / segs.length : 0,
    fleeting: fleetOn && f.total ? f.built / f.total : null,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
/** As a percent label, never rounding a start down to nothing or a near miss up to all. */
const pctText = (v: number) => (v <= 0 ? '0%' : v >= 1 ? '100%' : `${Math.min(99, Math.max(1, Math.round(v * 100)))}%`);

/** A share as a bar: white while it runs, green once full, an empty track before it starts.
 *  `nu` puts Nu swimming round it: the next thing to build is there. */
export function shareBar(share: number | null, cls = '', nu = false): string {
  const swim = nu ? '<em class="al-swim" aria-hidden="true"><b></b></em>' : '';
  if (share === null) return `<span class="al-bar is-off ${cls}">${swim}</span>`;
  return `<span class="al-bar ${cls}${share >= 1 ? ' is-done' : ''}${nu ? ' is-nu' : ''}"><i style="width:${pct(share)}"></i>${swim}</span>`;
}

/** Which of the next atom's bars the next step fills: fleeting for a fleeting isotope. */
export function nextLane(stage: string): 'stable' | 'fleeting' {
  return stage.startsWith('fl-') ? 'fleeting' : 'stable';
}

/** A progress ring with an icon in its middle, for the list's top and Collect's side. */
export function shareRing(share: number, ico: string, size = 48): string {
  const r = 20, c = 2 * Math.PI * r;
  const on = c * Math.max(0, Math.min(1, share));
  return `<span class="al-ring${share >= 1 ? ' is-done' : ''}" style="width:${size}px;height:${size}px" aria-hidden="true">`
    + `<svg viewBox="0 0 48 48"><circle class="al-ring-track" cx="24" cy="24" r="${r}"/>`
    + `<circle class="al-ring-on" cx="24" cy="24" r="${r}" stroke-dasharray="${on.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 24 24)"${share <= 0 ? ' hidden' : ''}/></svg>`
    + `<span class="al-ring-ico">${icon(ico as never, { size: Math.round(size * 0.42) })}</span></span>`;
}

let openList: Sheet | null = null;
/** The Learn tab's sort, kept while the app is open. */
let learnSort: LearnSort = 'z';

type LearnSort = 'z' | 'name' | 'series' | 'discovered';
const SORTS: { id: LearnSort; label: string }[] = [
  { id: 'z', label: 'Number' },
  { id: 'name', label: 'A to Z' },
  { id: 'series', label: 'Family' },
  { id: 'discovered', label: 'Year found' },
];

/** Open the list over the screen. */
export function openAtomList(o: AtomListOptions): void {
  const sheet = openSheet({ title: 'Atoms', icon: 'atom', label: 'All atoms', from: 'top', className: 'alist', onClose: () => { if (openList === sheet) openList = null; o.onClose?.(); } });
  openList = sheet;
  const pick = (z: number) => { sheet.close(); o.onPick(z); };
  sheet.body.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-z]');
    if (row) pick(Number(row.dataset.z));
  });
  const show = (tab: AtomListTab) => {
    // One list per place it opens from: Collect's with each atom's bars, the Atlas's to look up.
    sheet.bar.replaceChildren();
    sheet.foot.replaceChildren();
    if (tab === 'collect') paintCollect(sheet, o.current, pick);
    else paintLearn(sheet, o.current);
    // The atom on screen sits in the middle of the list's view.
    const cur = sheet.body.querySelector<HTMLElement>('.is-current');
    requestAnimationFrame(() => {
      if (cur) sheet.body.scrollTop = Math.max(0, cur.offsetTop - sheet.body.clientHeight / 2 + cur.offsetHeight / 2);
      else sheet.body.scrollTop = 0;
      if (tab === 'collect') (cur ?? sheet.body.querySelector<HTMLElement>('[data-z]'))?.focus({ preventScroll: true });
    });
  };
  show(o.tab);
}

/** Collect: the whole collection, then each period's atoms with their bars. */
function paintCollect(sheet: Sheet, current: number, pick: (z: number) => void): void {
  const save = loadSave();
  const fleetOn = fleetingOpen(save);
  const step = nextStep(save);
  // The whole collection: three rings, atoms built, stable and fleeting.
  const all = collectionProgress(save);
  const gauge = (share: number, ico: string, word: string, line: string, off = false) =>
    `<div class="al-gauge${off ? ' is-off' : ''}">${shareRing(off ? 0 : share, ico, 56)}<b>${off ? '–' : pctText(share)}</b><span>${word}</span><small>${line}</small></div>`;
  let html = `<div class="al-sum" aria-label="${esc(`Your collection: ${all.built} of ${all.atoms} atoms built, ${pctText(all.stable)} stable, ${fleetOn ? pctText(all.fleeting) : 'no'} fleeting`)}">`
    + gauge(all.built / all.atoms, 'atom', 'Atoms', `${all.built} of ${all.atoms}`)
    + gauge(all.stable, 'isotope-stable', 'Stable', 'nuclei, electrons, isotopes')
    + gauge(all.fleeting, 'isotope-fleeting', 'Fleeting', fleetOn ? 'short-lived isotopes' : 'open after one atom', !fleetOn)
    + '</div>';
  for (let p = 1; p <= 7; p++) {
    const [first, last] = rowSpan(p);
    const ps = periodShares(p, save);
    const open = rowOpen(p, save);
    html += `<h3 class="al-period${open ? '' : ' is-locked'}"><span class="al-period-name">${open ? '' : `<span class="al-lock">${icon('lock', { size: 16 })}</span>`}Period ${p} (${ps.built}/${ps.atoms})</span>`
      + `<span class="al-period-pcts"><span${ps.stable >= 1 ? ' class="is-done"' : ''}>${pctText(ps.stable)}</span><span${fleetOn && ps.fleeting >= 1 ? ' class="is-done"' : ''}>${fleetOn ? pctText(ps.fleeting) : '–'}</span></span></h3><ul class="al-rows">`;
    for (let z = first; z <= last; z++) {
      const e = elementAt(z);
      const s = atomShares(z, save, fleetOn);
      const done = atomBuilt(z, save);
      const lane = step?.z === z ? nextLane(step.stage) : null;
      html += `<li><button type="button" class="al-row${z === current ? ' is-current' : ''}${done ? ' is-built' : ''}" data-z="${z}" aria-label="${esc(`${e.name}, ${z}: ${pctText(s.stable)} stable${s.fleeting === null ? '' : `, ${pctText(s.fleeting)} fleeting`}${lane ? ', next to build' : ''}`)}"${z === current ? ' aria-current="true"' : ''}>`
        + `<span class="al-z">${z}</span><b class="al-sym" style="--c:${placeColour(e)}">${e.symbol}</b><span class="al-name">${esc(e.name)}</span>`
        + `<span class="al-bars">${shareBar(s.stable, '', lane === 'stable')}${shareBar(s.fleeting, '', lane === 'fleeting')}</span></button></li>`;
    }
    html += '</ul>';
  }
  sheet.body.innerHTML = html;
  // The foot: Next.
  if (step) sheet.foot.append(nextButton({ label: 'Next', compact: true, landKey: 'atom-list', onClick: () => pick(step.z) }));
}

/** A family's name for one atom: "Noble gases" becomes "Noble gas". */
export const familyOf = (e: Element) => (e.series.endsWith('gases') ? e.series.slice(0, -2) : e.series.replace(/s$/, ''));
const yearSection = (e: Element) => (e.discoveryYear === null ? 'Known since ancient times' : e.discoveryYear < 1700 ? 'Before 1700' : `${Math.floor(e.discoveryYear / 50) * 50}s`);
const weightText = (e: Element) => (e.weight === null ? '–' : String(+e.weight.toFixed(e.weight < 100 ? 3 : 2)));

/** Learn: a search field and the sort dropdown on one row, then every atom with its family and
 *  weight. */
function paintLearn(sheet: Sheet, current: number): void {
  const { el: search, input } = sheetSearch({ placeholder: 'Name or symbol', label: 'Find an atom by name, symbol or number' });
  const sorts = sortSelect((id) => { learnSort = id; paint(); sheet.body.scrollTop = 0; });
  const row1 = document.createElement('div');
  row1.className = 'al-find';
  row1.append(search, sorts);
  sheet.bar.append(row1);
  const row = (e: Element) => `<li><button type="button" class="sheet-row${e.z === current ? ' is-current' : ''}" data-z="${e.z}"${e.z === current ? ' aria-current="true"' : ''}>`
    + `<span class="sheet-z">${e.z}</span><b class="sheet-sym" style="--c:${placeColour(e)}">${e.symbol}</b>`
    + `<span class="sheet-name"><span>${esc(e.name)}</span><small>${esc(familyOf(e))}</small></span>`
    + `<span class="sheet-fig">${learnSort === 'discovered' ? (e.discoveryYear ?? 'Ancient') : weightText(e)}</span></button></li>`;
  const paint = () => {
    const q = input.value.trim();
    sorts.hidden = Boolean(q);
    if (q) {
      const found = searchElements(q);
      sheet.body.innerHTML = found.length ? `<ul class="sheet-rows al-found">${found.map(row).join('')}</ul>` : `<p class="sheet-empty">No atom matches “${esc(q)}”.</p>`;
      return;
    }
    const key: SortKey = learnSort;
    const list = sortElements([...ELEMENTS], key);
    const section = learnSort === 'discovered' ? yearSection : COL[key].section ?? (() => '');
    let html = '';
    let open = '';
    const counts = new Map<string, number>();
    for (const e of list) counts.set(section(e), (counts.get(section(e)) ?? 0) + 1);
    for (const e of list) {
      const s = section(e);
      if (s !== open) {
        if (open) html += '</ul>';
        const n = counts.get(s) ?? 0;
        html += `<h3 class="sheet-group" aria-label="${esc(`${s}, ${n} ${n === 1 ? 'atom' : 'atoms'}`)}">${esc(s)} (${n})</h3><ul class="sheet-rows">`;
        open = s;
      }
      html += row(e);
    }
    sheet.body.innerHTML = `${html}</ul>`;
  };
  input.addEventListener('input', () => { paint(); sheet.body.scrollTop = 0; });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    sheet.body.querySelector<HTMLElement>('[data-z]')?.click();
  });
  paint();
}

/** The sorts as a dropdown: the sort in use, a chevron, and the system's own list of the four. */
function sortSelect(onChange: (id: LearnSort) => void): HTMLLabelElement {
  const el = document.createElement('label');
  el.className = 'al-sort';
  el.innerHTML = `<span class="sr-only">Sort by</span><select>${SORTS.map((s) => `<option value="${s.id}"${s.id === learnSort ? ' selected' : ''}>${s.label}</option>`).join('')}</select>${icon('chevron-down', { size: 18 })}`;
  const sel = el.querySelector('select')!;
  sel.onchange = () => onChange(sel.value as LearnSort);
  return el;
}

/** Close the list if it is open (the screen is changing). */
export function closeAtomList(): void {
  openList?.close();
}

/** The list is open. */
export function atomListOpen(): boolean {
  return openList !== null;
}
