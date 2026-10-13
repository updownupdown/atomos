// The Atlas: every atom, to admire and to look up. One row of views (Table, Ribbon, Spiral,
// Circle, Details), then the search and the Color chip, which work in every view. On a map, a
// tap picks an atom and shows its peek strip (symbol, name, weight, category, headline fact);
// tapping the strip opens the atom's page. In Details a row opens the page at once. Nothing
// here shows how far an atom is built: that is Collect's.
//
//   const atlas = new Atlas(host, { onBuild: (z) => openBuild(z) });
//   atlas.show();

import { ELEMENTS, elementAt, type Element } from './data';
import { AtlasMap } from './atlasmap';
import { isLayoutId, LAYOUT_STORY, LAYOUTS, type LayoutId } from './layouts';
import { inkOn, isLookId, lookColor, lookLegend, lookOf, LOOKS, type LookId } from './looks';
import { createTable, seriesOne, type Table } from './table';
import { AtlasPage } from './atlaspage';
import { elementFacts } from './info';
import { searchElements } from '../ui/search';
import { icon } from '../ui/icons';
import { closeModal, openModal } from '../ui/modal';
import { scienceButton, setScienceHandler, setScienceOpen } from '../ui/science';
import './atlas.css';

export type AtlasView = LayoutId | 'details';
const VIEWS: { id: AtlasView; label: string }[] = [...LAYOUTS.map((l) => ({ id: l.id as AtlasView, label: l.label })), { id: 'details', label: 'Details' }];
const VIEW_KEY = 'atomos.atlas.view';
const LOOK_KEY = 'atomos.atlas.color';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage off: the choice just resets */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** "55.845", or the mass number in brackets for an atom with no standard weight. */
export const weightText = (e: Element): string => (e.weight == null ? `[${e.commonA}]` : String(Number(e.weight.toPrecision(e.weight < 10 ? 4 : 5))));

export class Atlas {
  private view: AtlasView = ((v) => (v === 'details' || isLayoutId(v) ? v : 'table'))(read(VIEW_KEY));
  private look: LookId = ((v) => (isLookId(v) ? v : 'place'))(read(LOOK_KEY));
  private query = '';
  private picked: number | null = null;
  private map: AtlasMap;
  private table: Table | null = null;
  private page: AtlasPage;
  private root: HTMLElement;
  private views: HTMLElement;
  private input: HTMLInputElement;
  private peekEl: HTMLElement;
  private mapHost: HTMLElement;
  private listHost: HTMLElement;

  constructor(host: HTMLElement, private opts: { onBuild: (z: number) => void }) {
    this.root = host;
    host.classList.add('at');
    host.innerHTML = `
      <div class="at-views" role="radiogroup" aria-label="Atlas view">${VIEWS.map((v) => `<button type="button" role="radio" data-id="${v.id}">${v.label}</button>`).join('')}</div>
      <div class="at-tools">
        <label class="at-search">
          <span class="at-search-icon">${icon('search', { size: 20 })}</span>
          <input type="search" id="atlas-search" placeholder="Search" aria-label="Search the atoms by name, symbol or number" autocomplete="off" spellcheck="false" enterkeyhint="go">
          <button type="button" class="at-clear" aria-label="Clear search" hidden>${icon('clear', { size: 22 })}</button>
        </label>
        <button type="button" class="at-color" aria-haspopup="dialog">${icon('paint', { size: 18 })}<small>Color</small><span></span></button>
      </div>
      <div class="at-legend" hidden></div>
      <div class="at-body">
        <div class="at-map"></div>
        <div class="at-list" hidden></div>
      </div>
      <button type="button" class="at-peek" hidden></button>`;
    this.views = host.querySelector('.at-views')!;
    this.input = host.querySelector('input')!;
    this.peekEl = host.querySelector('.at-peek')!;
    this.mapHost = host.querySelector('.at-map')!;
    this.listHost = host.querySelector('.at-list')!;
    this.map = new AtlasMap(this.mapHost, { onPick: (z) => this.pick(z) });
    this.page = new AtlasPage({ onBuild: opts.onBuild, onClose: () => this.afterPage() });
    document.body.append(this.page.el);
    this.bind();
    this.applyLook();
    this.setView(this.view);
  }

  private bind(): void {
    this.views.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (b) this.setView(b.dataset.id as AtlasView);
    });
    // Arrow keys walk the views, like any radio group.
    this.views.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = VIEWS.findIndex((v) => v.id === this.view);
      const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
      this.setView(next.id);
      this.views.querySelector<HTMLElement>(`[data-id="${next.id}"]`)!.focus();
    });
    const clear = this.root.querySelector<HTMLButtonElement>('.at-clear')!;
    this.input.addEventListener('input', () => {
      this.query = this.input.value.trim();
      clear.hidden = !this.query;
      this.applySearch();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = searchElements(this.query)[0];
      if (!first) return;
      e.preventDefault();
      this.input.blur();
      if (this.view === 'details') this.openPage(first.z);
      else this.pick(first.z, true);
    });
    clear.addEventListener('click', () => {
      this.input.value = '';
      this.input.dispatchEvent(new Event('input'));
      this.input.focus();
    });
    this.root.querySelector<HTMLButtonElement>('.at-color')!.onclick = () => this.openColors();
    // The microscope: why the atoms are arranged this way.
    this.root.querySelector('.at-tools')!.append(scienceButton('at-sci'));
    this.peekEl.onclick = () => { if (this.picked != null) this.openPage(this.picked); };
  }

  setView(v: AtlasView): void {
    this.view = v;
    write(VIEW_KEY, v);
    this.views.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => {
      const on = b.dataset.id === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const details = v === 'details';
    this.mapHost.hidden = details;
    this.listHost.hidden = !details;
    this.root.classList.toggle('is-details', details);
    if (details) {
      if (!this.table) {
        this.table = createTable({ onPick: (z) => this.openPage(z) });
        this.listHost.append(this.table.el);
        this.table.setColors((e) => lookColor(this.look, e));
      }
      this.table.setQuery(this.query);
    } else {
      // The picked atom stays picked from one map to the next.
      this.map.setLayout(v);
      this.map.select(this.picked);
      this.applySearch();
    }
    this.registerScience();
  }

  /** On a map: pick an atom and show its peek strip, or let go (null). */
  private pick(z: number | null, reveal = false): void {
    this.picked = z;
    this.map.select(z);
    if (z != null && reveal) this.map.reveal(z);
    const p = this.peekEl;
    p.hidden = z == null;
    if (z == null) return;
    const e = elementAt(z);
    const fill = lookColor(this.look, e);
    const fact = elementFacts(z)?.h ?? '';
    p.setAttribute('aria-label', `${e.name}: open its page`);
    p.innerHTML = `<span class="at-plate" style="background:${fill};color:${inkOn(fill)}">${e.symbol}</span>
      <span class="at-peek-text"><b>${esc(e.name)}</b><span>${e.z} · ${weightText(e)} · ${esc(seriesOne(e))}</span><span class="at-peek-fact">${esc(fact)}</span></span>
      <span class="at-peek-go">${icon('chevron-right', { size: 22 })}</span>`;
  }

  private applySearch(): void {
    const found = this.query ? searchElements(this.query).map((e) => e.z) : null;
    if (this.view === 'details') { this.table?.setQuery(this.query); return; }
    this.map.setMatches(found);
    // One atom found: pick it.
    if (found && found.length === 1) this.pick(found[0]);
  }

  private openPage(z: number): void {
    const order = this.view === 'details' && this.table ? this.table.order() : ELEMENTS.map((e) => e.z);
    this.page.open(z, order.includes(z) ? order : ELEMENTS.map((e) => e.z));
    this.registerScience();
  }

  /** Back from a page: the map keeps the atom it was on, picked. */
  private afterPage(): void {
    const z = this.page.current;
    if (z != null && this.view !== 'details') { this.pick(z); this.map.reveal(z); }
    this.registerScience();
  }

  private setLook(id: LookId): void {
    this.look = id;
    write(LOOK_KEY, id);
    this.applyLook();
  }

  /** Color the maps, the Details plates and the peek strip, and show the legend. */
  private applyLook(): void {
    const fn = (e: Element) => lookColor(this.look, e);
    this.map.setColors(fn);
    this.table?.setColors(fn);
    if (this.picked != null) this.pick(this.picked);
    const l = lookOf(this.look);
    this.root.querySelector('.at-color span')!.textContent = l.label;
    const legend = this.root.querySelector<HTMLElement>('.at-legend')!;
    const lg = lookLegend(this.look);
    legend.hidden = !lg;
    if (!lg) return;
    legend.innerHTML = lg.swatches
      ? lg.swatches.map((s) => `<span class="at-key"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')
      : `<span>${esc(lg.low ?? '')}</span><i class="at-ramp"></i><span>${esc(lg.high ?? '')}</span><span class="at-key"><i class="at-unknown"></i>Not known</span>`;
  }

  /** The Color sheet: every way to color the atoms. */
  private openColors(): void {
    const rows = LOOKS.map((l) => `<button class="look-row" data-id="${l.id}" aria-pressed="${l.id === this.look}">
        <span class="look-main"><b>${esc(l.label)}</b><span>${esc(l.blurb)}</span></span>
        ${l.id === this.look ? `<span class="look-on">${icon('check', { size: 20 })}</span>` : ''}
      </button>`).join('');
    const sheet = openModal(`<h2>Color by</h2><div class="look-list">${rows}</div>`);
    sheet.querySelectorAll<HTMLButtonElement>('.look-row').forEach((b) => (b.onclick = () => {
      closeModal();
      this.setLook(b.dataset.id as LookId);
    }));
  }

  /** Show an atom in the Atlas from one of its pages: on a map (the Table, if Details was showing),
   *  picked, and colored by a property when one is given. */
  focus(z: number, look: LookId | null = null): void {
    if (this.page.isOpen) this.page.close();
    // A search left from before would dim the rest of the map.
    if (this.query) {
      this.input.value = '';
      this.query = '';
      this.root.querySelector<HTMLButtonElement>('.at-clear')!.hidden = true;
      this.map.setMatches(null);
    }
    if (look) this.setLook(look);
    if (this.view === 'details') this.setView('table');
    this.pick(z, true);
  }

  /** The microscope: a page's guide, why the atoms are arranged this way (a map), or nothing (Details). */
  registerScience(): void {
    if (this.page.isOpen) { setScienceHandler(() => this.page.openGuide(), 'How to read this page'); return; }
    if (this.view === 'details') { setScienceHandler(null); return; }
    const l = LAYOUTS.find((x) => x.id === this.view)!;
    setScienceHandler(() => {
      setScienceOpen(true);
      openModal(`<h2>${l.label}</h2>${LAYOUT_STORY[l.id].map((p) => `<p>${p}</p>`).join('')}`, () => setScienceOpen(false));
    }, 'Why the atoms are arranged this way');
  }

  show(): void {
    this.page.show();
  }

  hide(): void {
    this.page.hide();
  }
}
