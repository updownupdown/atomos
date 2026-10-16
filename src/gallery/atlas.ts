// The Atlas: every atom, to admire and to look up. One row: the Shape and Color boxes, each
// dropping its list (open ones first, then the ones still to earn, an amber name and lock), and
// search, which opens over both. Over the map, "About this shape" (the microscope) at the top
// left with the legend beside it, and the peek strip at the foot. Shapes open as periods
// are built and colors with the first win of a game (earn.ts); tapping one still to earn opens a
// sheet with how, and a game card to get there. On a map, a tap picks an atom and shows its peek
// strip at the foot (number and symbol plate, name, period and category); tapping the strip opens
// the atom's page. In Details a row opens the page at once. Nothing
// here shows how far an atom is built: that is Collect's.
//
//   const atlas = new Atlas(host, { onBuild: (z) => openBuild(z) });
//   atlas.show();

import { ELEMENTS, elementAt, placeColour, type Element } from './data';
import { AtlasMap } from './atlasmap';
import { isLayoutId, LAYOUT_STORY, LAYOUTS, type LayoutId } from './layouts';
import { shapeStory } from './shapestory';
import { inkOn, isLookId, lookColor, lookLegend, lookOf, LOOKS, type LookId } from './looks';
import { createTable, seriesOne, type Table } from './table';
import { AtlasPage } from './atlaspage';
import { searchElements } from '../ui/search';
import { icon } from '../ui/icons';
import { gameCard } from '../puzzles/gameCard';
import { isUnlocked, unlockPuzzle, type UnlockId } from '../core/unlocks';
import { loadSave } from '../core/save';
import { rowOf, stepState, stepsOf } from '../core/progress';
import { atomGame } from '../core/atomGames';
import { playUnlock } from '../puzzles/unlock';
import { aPuzzle, earnables, gameName, meetText, takeFresh, watchEarnings, type Earnable } from './earn';
import { UNKNOWN_FILL } from './looks';
import { closeModal, openModal } from '../ui/modal';
import { scienceButton, setScienceHandler, setScienceOpen } from '../ui/science';
import './atlas.css';
import { nuShow } from '../ui/nu';

/** Place has no scale to explain, so its legend names the families instead: each swatch is the
 *  family's hue (period 4's shade), and a tap lights its atoms. Lanthanum and actinium count with
 *  their series; hydrogen belongs to none. */
const FAMILIES: { id: string; label: string; of: (e: Element) => boolean; swatch: number[] }[] = [
  { id: 'alkali', label: 'Alkali metals', of: (e) => e.group === 1 && e.z !== 1, swatch: [19] },
  { id: 'earth', label: 'Alkaline earths', of: (e) => e.group === 2, swatch: [20] },
  { id: 'transition', label: 'Transition metals', of: (e) => e.group != null && e.group >= 3 && e.group <= 12 && e.z !== 57 && e.z !== 89, swatch: [21, 23, 24, 25, 26, 29, 30] },
  { id: 'boron', label: 'Boron group', of: (e) => e.group === 13, swatch: [31] },
  { id: 'carbon', label: 'Carbon group', of: (e) => e.group === 14, swatch: [32] },
  { id: 'nitrogen', label: 'Nitrogen group', of: (e) => e.group === 15, swatch: [33] },
  { id: 'chalcogen', label: 'Chalcogens', of: (e) => e.group === 16, swatch: [34] },
  { id: 'halogen', label: 'Halogens', of: (e) => e.group === 17, swatch: [35] },
  { id: 'noble', label: 'Noble gases', of: (e) => e.group === 18, swatch: [36] },
  { id: 'lanthanide', label: 'Lanthanides', of: (e) => e.z >= 57 && e.z <= 71, swatch: [60] },
  { id: 'actinide', label: 'Actinides', of: (e) => e.z >= 89 && e.z <= 103, swatch: [92] },
];
const swatchFill = (zs: number[]) => {
  const c = zs.map((z) => placeColour(elementAt(z)));
  return c.length === 1 ? c[0] : `linear-gradient(90deg, ${c.join(', ')})`;
};

export type AtlasView = LayoutId | 'details';
const VIEWS: { id: AtlasView; label: string }[] = [...LAYOUTS.map((l) => ({ id: l.id as AtlasView, label: l.label })), { id: 'details', label: 'Details' }];
const lensOf = (v: AtlasView): UnlockId | null => (v === 'table' || v === 'details' ? null : `lens:${v}`);
/** The years the time-lapse steps through: antiquity, then every year an element was found. */
const ERAS: [number, string][] = [[1700, 'Alchemy'], [1800, 'The chemical revolution'], [1860, 'Batteries split compounds apart'], [1900, 'Spectroscopes and the periodic table'], [1940, 'Radioactivity'], [Infinity, 'Reactors and atom smashers']];
const VIEW_KEY = 'atomos.atlas.view';
const LOOK_KEY = 'atomos.atlas.color';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage off: the choice just resets */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Atlas {
  private view: AtlasView = ((v) => (v === 'details' || isLayoutId(v) ? v : 'table'))(read(VIEW_KEY));
  private look: LookId = ((v) => (isLookId(v) ? v : 'place'))(read(LOOK_KEY));
  private query = '';
  /** The family lit from Place's legend, if any. */
  private family: string | null = null;
  private picked: number | null = null;
  private map: AtlasMap;
  private table: Table | null = null;
  readonly page: AtlasPage;
  private root: HTMLElement;
  private views: HTMLElement;
  private input: HTMLInputElement;
  private peekEl: HTMLElement;
  private mapHost: HTMLElement;
  private listHost: HTMLElement;
  private looksEl: HTMLElement;
  /** The Shape or Color list while it is dropped. */
  private menu: { el: HTMLElement; box: HTMLElement; off: () => void } | null = null;
  private earned: Earnable[] = [];
  /** A color just opened, shown once before going back to the player's own choice. */
  private tempLook: LookId | null = null;
  private tempTimer = 0;
  /** The time-lapse: the year it has reached, while it plays. */
  private lapse: { timer: number; year: number } | null = null;

  constructor(host: HTMLElement, private opts: { onBuild: (z: number) => void }) {
    this.root = host;
    host.classList.add('at');
    host.innerHTML = `
      <div class="at-pickers">
        <div class="at-pick"><button type="button" class="at-box" data-menu="shape" aria-haspopup="true" aria-expanded="false" aria-label="Shape">${icon('shapes', { size: 20 })}<span id="at-shape-v"></span>${icon('chevron-down', { size: 20 })}</button><div class="at-menu at-views" role="radiogroup" aria-label="Shape" hidden></div></div>
        <div class="at-pick"><button type="button" class="at-box" data-menu="look" aria-haspopup="true" aria-expanded="false" aria-label="Color">${icon('paint', { size: 20 })}<span id="at-look-v"></span>${icon('chevron-down', { size: 20 })}</button><div class="at-menu at-looks" role="radiogroup" aria-label="Color by" hidden></div></div>
        <div class="at-search">
          <button type="button" class="at-search-btn" aria-label="Search the atoms" aria-expanded="false">${icon('search', { size: 20 })}</button>
          <input type="search" id="atlas-search" placeholder="Name, symbol or number" aria-label="Search the atoms by name, symbol or number" autocomplete="off" spellcheck="false" enterkeyhint="go">
          <button type="button" class="at-clear" aria-label="Close search">${icon('clear', { size: 22 })}</button>
        </div>
      </div>
      <div class="at-body">
        <div class="at-map"></div>
        <div class="at-list" hidden></div>
        <div class="at-top"><div class="at-legend"></div></div>
        <button type="button" class="at-peek" hidden></button>
      </div>`;
    this.views = host.querySelector('.at-views')!;
    this.looksEl = host.querySelector('.at-looks')!;
    this.input = host.querySelector('input')!;
    this.peekEl = host.querySelector('.at-peek')!;
    this.mapHost = host.querySelector('.at-map')!;
    this.listHost = host.querySelector('.at-list')!;
    this.earned = earnables();
    this.paintViews();
    watchEarnings();
    const refresh = () => this.refreshEarned();
    window.addEventListener('atomos:progress', refresh);
    window.addEventListener('atomos:win', refresh);
    this.map = new AtlasMap(this.mapHost, { onPick: (z) => this.pick(z), onOpen: (z) => { this.pick(z); this.openPage(z); } });
    this.page = new AtlasPage({ onBuild: opts.onBuild, onClose: () => this.afterPage() });
    document.body.append(this.page.el);
    this.bind();
    this.applyLook();
    this.setView(this.view);
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLElement>('.at-box').forEach((box) => {
      box.onclick = () => this.toggleMenu(box);
    });
    this.views.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!b) return;
      const v = b.dataset.id as AtlasView;
      const locked = this.lockOf(v);
      this.closeMenu();
      if (locked) this.offerShape(locked);
      else this.setView(v);
    });
    // Arrow keys walk a dropped list.
    for (const list of [this.views, this.looksEl]) {
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = [...list.querySelectorAll<HTMLElement>('[data-id]')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      });
    }
    // Search: a button at the end of the row that opens a field over both boxes; it closes when
    // left empty.
    const tools = this.root.querySelector<HTMLElement>('.at-pickers')!;
    const searchBtn = this.root.querySelector<HTMLButtonElement>('.at-search-btn')!;
    const openSearch = (on: boolean) => {
      tools.classList.toggle('is-searching', on);
      searchBtn.setAttribute('aria-expanded', String(on));
      if (on) { this.closeMenu(); this.input.focus(); }
    };
    searchBtn.onclick = () => openSearch(!tools.classList.contains('is-searching') || Boolean(this.query));
    this.input.addEventListener('blur', () => { if (!this.query) openSearch(false); });
    const clear = this.root.querySelector<HTMLButtonElement>('.at-clear')!;
    this.input.addEventListener('input', () => {
      this.query = this.input.value.trim();
      if (this.query) { tools.classList.add('is-searching'); this.family = null; this.paintFamilies(); }
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
    // Clearing the search closes it.
    clear.addEventListener('pointerdown', (e) => e.preventDefault());
    clear.addEventListener('click', () => {
      this.input.value = '';
      this.input.dispatchEvent(new Event('input'));
      openSearch(false);
      this.input.blur();
    });
    this.looksEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!b) return;
      const id = b.dataset.id as LookId;
      const locked = this.earned.find((x) => x.id === `look:${id}` && !x.open);
      this.closeMenu();
      if (locked) { this.offerEarnable(locked); return; }
      this.endTemp();
      this.setLook(id);
    });
    // The microscope: about the shape on screen, why the atoms are arranged this way.
    const sci = scienceButton('at-sci');
    sci.insertAdjacentHTML('beforeend', '<span>About this shape</span>');
    // Floats at the bottom left; the atom card, when one is picked, covers it.
    this.root.querySelector('.at-body')!.append(sci);
    // The legend can wrap to more lines (Place's families): keep the shape clear of it.
    const top = this.root.querySelector<HTMLElement>('.at-top')!;
    new ResizeObserver(() => this.map.setTopRoom(top.offsetHeight ? top.offsetTop + top.offsetHeight + 8 : 0)).observe(top);
    this.peekEl.onclick = () => { if (this.picked != null) this.openPage(this.picked); };
  }

  /** Table, the open shapes, Details, then the shapes still to earn. */
  /** Table, the open shapes, Details, then the shapes still to earn. */
  private viewOrder(): { id: AtlasView; label: string; locked: boolean }[] {
    const all = VIEWS.map((v) => ({ ...v, locked: Boolean(this.lockOf(v.id)) }));
    return [...all.filter((v) => !v.locked), ...all.filter((v) => v.locked)];
  }

  /** A shape still to earn: its earnable; null for an open one. */
  private lockOf(v: AtlasView): Earnable | null {
    const id = lensOf(v);
    const e = id ? this.earned.find((x) => x.id === id) : undefined;
    return e && !e.open ? e : null;
  }

  /** One line of a dropped list: a still-to-earn one is its name in amber after a lock. */
  private static item(id: string, label: string, on: boolean, locked: boolean, title = ''): string {
    return `<button type="button" role="radio" data-id="${id}"${locked ? ' class="is-locked"' : ''} aria-checked="${on}"${title ? ` title="${esc(title)}"` : ''}${locked ? ` aria-label="${esc(label)}, still to earn"` : ''}><span>${esc(label)}</span>${locked ? icon('lock', { size: 18 }) : on ? icon('check', { size: 18 }) : ''}</button>`;
  }

  private paintViews(): void {
    this.views.innerHTML = this.viewOrder().map((v) => Atlas.item(v.id, v.label, v.id === this.view, v.locked)).join('');
    this.root.querySelector('#at-shape-v')!.textContent = VIEWS.find((v) => v.id === this.view)!.label;
    this.paintLooks();
  }

  /** The Color list: every way to color the atoms, open ones first. */
  private paintLooks(): void {
    const cur = this.shown();
    const rows = LOOKS.map((l) => ({ l, locked: Boolean(this.earned.find((x) => x.id === `look:${l.id}` && !x.open)) }));
    this.looksEl.innerHTML = [...rows.filter((r) => !r.locked), ...rows.filter((r) => r.locked)]
      .map(({ l, locked }) => Atlas.item(l.id, l.label, !locked && l.id === cur, locked, locked ? '' : l.blurb)).join('');
    this.root.querySelector('#at-look-v')!.textContent = lookOf(cur).label;
  }

  /** Drop a box's list under it, or put it away. A tap anywhere else or Escape puts it away. */
  private toggleMenu(box: HTMLElement): void {
    const was = this.menu?.box;
    this.closeMenu();
    if (was === box) return;
    const el = box.parentElement!.querySelector<HTMLElement>('.at-menu')!;
    el.hidden = false;
    box.setAttribute('aria-expanded', 'true');
    box.parentElement!.classList.add('is-open');
    const away = (e: Event) => { if (!box.parentElement!.contains(e.target as Node)) this.closeMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.closeMenu(); box.focus(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    this.menu = { el, box, off: () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); } };
    (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>('[data-id]'))?.focus({ preventScroll: true });
  }

  private closeMenu(): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    m.off();
    m.el.hidden = true;
    m.box.setAttribute('aria-expanded', 'false');
    m.box.parentElement!.classList.remove('is-open');
  }

  /** After a win or a build: what is open now, and the views row and the map to match. */
  private refreshEarned(): void {
    const before = this.earned.map((e) => e.open).join();
    this.earned = earnables();
    this.paintViews();
    if (before !== this.earned.map((e) => e.open).join()) this.setView(this.view);
  }

  setView(want: AtlasView): void {
    // A shape still to earn is never shown (one saved from before falls back to the Table).
    const v: AtlasView = this.lockOf(want) ? 'table' : want;
    this.view = v;
    write(VIEW_KEY, v);
    this.paintViews();
    this.stopLapse();
    const details = v === 'details';
    this.mapHost.hidden = details;
    this.listHost.hidden = !details;
    this.root.classList.toggle('is-details', details);
    if (details) {
      if (!this.table) {
        this.table = createTable({ onPick: (z) => this.openPage(z) });
        this.listHost.append(this.table.el);
      }
      this.table.setQuery(this.query);
      this.paintColors();
    } else {
      // The picked atom stays picked from one map to the next.
      this.map.setLayout(v);
      this.map.select(this.picked);
      this.applySearch();
      this.paintColors();
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
    p.setAttribute('aria-label', `${e.name}: open its page`);
    p.innerHTML = `<span class="at-plate" style="background:${fill};color:${inkOn(fill)}"><small>${e.z}</small><b>${e.symbol}</b></span>
      <span class="at-peek-text"><b>${esc(e.name)}</b><span>Period ${rowOf(z)} · ${esc(seriesOne(e))}</span></span>
      <span class="at-peek-go">${icon('chevron-right', { size: 22 })}</span>`;
  }

  private applySearch(): void {
    const fam = FAMILIES.find((f) => f.id === this.family);
    const found = this.query ? searchElements(this.query).map((e) => e.z) : fam ? ELEMENTS.filter(fam.of).map((e) => e.z) : null;
    if (this.view === 'details') { this.table?.setQuery(this.query); return; }
    this.map.setMatches(found);
    // One atom found: pick it.
    if (found && found.length === 1) this.pick(found[0]);
  }

  /** Open an atom's page (also from the dock's atom list and search). */
  openPage(z: number): void {
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
    this.paintColors();
  }

  /** The look showing: a color just opened, else the player's choice (if it is open). */
  private shown(): LookId {
    if (this.tempLook) return this.tempLook;
    return this.lookOpen(this.look) ? this.look : 'place';
  }

  private lookOpen(id: LookId): boolean {
    const e = this.earned.find((x) => x.id === `look:${id}`);
    return !e || e.open;
  }

  private paintColors(): void {
    const look = this.shown();
    const fn = (e: Element) => lookColor(look, e);
    if (!this.lapse) this.map.setColors(fn);
    this.table?.setColors(fn);
    if (this.picked != null) this.pick(this.picked);
    this.paintLooks();
    const legend = this.root.querySelector<HTMLElement>('.at-legend')!;
    const lg = lookLegend(look);
    const fresh = this.tempLook ? `<span class="at-fresh">${icon('star', { size: 16 })}<b>${esc(lookOf(look).label)}</b> is open<button type="button" class="at-keep">Keep it</button></span>` : '';
    const lapse = look === 'discovery' && !this.root.classList.contains('is-details') ? this.lapseControl() : '';
    const families = look === 'place' && !fresh && !this.root.classList.contains('is-details');
    if (look !== 'place' && this.family) { this.family = null; this.applySearch(); }
    if (families) {
      legend.innerHTML = FAMILIES.map((f) => `<button type="button" class="at-key at-fam" data-fam="${f.id}" aria-pressed="false"><i style="background:${swatchFill(f.swatch)}"></i>${esc(f.label)}</button>`).join('');
      legend.querySelectorAll<HTMLButtonElement>('.at-fam').forEach((b) => { b.onclick = () => this.lightFamily(b.dataset.fam!); });
      this.paintFamilies();
      const more = () => { legend.classList.toggle('is-more', legend.scrollLeft + legend.clientWidth < legend.scrollWidth - 2); legend.classList.toggle('is-back', legend.scrollLeft > 2); };
      legend.onscroll = more;
      requestAnimationFrame(more);
      return;
    }
    legend.classList.remove('is-more', 'is-back');
    legend.onscroll = null;
    if (!lg && !fresh && !lapse) { legend.innerHTML = ''; return; }
    legend.innerHTML = fresh + (!lg ? '' : lg.swatches
      ? lg.swatches.map((s) => `<span class="at-key"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')
      : `<span>${esc(lg.low ?? '')}</span><i class="at-ramp"></i><span>${esc(lg.high ?? '')}</span><span class="at-key"><i class="at-unknown"></i>Not known</span>`) + lapse;
    legend.querySelector<HTMLButtonElement>('.at-keep')?.addEventListener('click', () => { const id = this.tempLook!; this.endTemp(); this.setLook(id); });
    legend.querySelector<HTMLButtonElement>('.at-lapse')?.addEventListener('click', () => this.toggleLapse());
  }

  /** Light one family's atoms on the map (a second tap lets go); a search showing is cleared. */
  private lightFamily(id: string): void {
    this.family = this.family === id ? null : id;
    if (this.family && this.query) {
      this.input.value = '';
      this.query = '';
      this.root.querySelector<HTMLButtonElement>('.at-clear')!.hidden = true;
    }
    this.paintFamilies();
    this.applySearch();
    // A family half off screen slides into view when tapped.
    this.root.querySelector<HTMLElement>(`.at-fam[data-fam="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  private paintFamilies(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.at-fam').forEach((b) => {
      const on = b.dataset.fam === this.family;
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Paint the Atlas once in a color just opened, then go back to the player's own. */
  private showOnce(id: LookId): void {
    this.tempLook = id;
    this.paintColors();
    clearTimeout(this.tempTimer);
    this.tempTimer = window.setTimeout(() => this.endTemp(), 6000);
  }

  private endTemp(): void {
    if (!this.tempLook) return;
    clearTimeout(this.tempTimer);
    this.tempLook = null;
    this.paintColors();
  }

  // ---- Time-lapse: Glyph's toy. Under Discovered, a play button fills the table in year by year.

  private lapseControl(): string {
    const open = isUnlocked('toy:timelapse');
    if (this.lapse) {
      const y = this.lapse.year;
      const era = y < 0 ? 'Known since antiquity' : ERAS.find(([to]) => y < to)![1];
      return `<button type="button" class="at-lapse is-on" aria-label="Stop the time-lapse">${icon('close', { size: 16 })}<b>${y < 0 ? 'Antiquity' : y}</b><span>${esc(era)}</span></button>`;
    }
    return `<button type="button" class="at-lapse${open ? '' : ' is-locked'}">${icon(open ? 'play' : 'lock', { size: 16 })}<b>Time-lapse</b></button>`;
  }

  private toggleLapse(): void {
    if (this.lapse) { this.stopLapse(); return; }
    if (!isUnlocked('toy:timelapse')) { this.offerEarnable(this.earned.find((e) => e.id === 'toy:timelapse')!); return; }
    const years = [-1, ...new Set(ELEMENTS.map((e) => e.discoveryYear).filter((y): y is number => y != null && y > 0))].sort((a, b) => a - b);
    let i = 0;
    const found = (e: Element) => (e.discoveryYear == null || e.discoveryYear <= 0 ? -1 : e.discoveryYear);
    const step = () => {
      const year = years[i];
      this.lapse = { timer: 0, year };
      this.map.setColors((e) => (found(e) <= year ? lookColor('discovery', e) : UNKNOWN_FILL));
      this.paintColors();
      i++;
      // A pause on antiquity, then a year at a time, with a last look at the full table.
      this.lapse.timer = window.setTimeout(i < years.length ? step : () => this.stopLapse(), i === 1 ? 1400 : i >= years.length ? 2200 : 130);
    };
    step();
  }

  private stopLapse(): void {
    if (!this.lapse) return;
    clearTimeout(this.lapse.timer);
    this.lapse = null;
    this.paintColors();
  }

  /** How to earn a color or toy: its game's card. Play opens its puzzle right here once the game
   *  has been played, otherwise the atom where building next meets it. */
  private earnCard(e: Earnable): HTMLElement {
    const meet = !e.played && e.next;
    return gameCard({
      id: e.game!, name: gameName(e.game!),
      extra: meet ? meetText(e) : `Win one to open ${e.label}`,
      action: {
        label: 'Play',
        ariaLabel: meet ? `Build ${elementAt(e.next!).name} to meet ${gameName(e.game!)}` : `Play ${gameName(e.game!)} to open ${e.label}`,
        onClick: async () => {
          closeModal();
          if (meet) { this.opts.onBuild(e.next!); return; }
          const won = await playUnlock(e.id, { title: e.kind === 'toy' ? 'The time-lapse' : `${e.label} colors`, note: `${e.label} is open in the Atlas.` });
          if (won) this.refreshEarned();
        },
      },
    });
  }

  /** A locked toy or color on its own: what it is and how to earn it. */
  private offerEarnable(e: Earnable): void {
    const what = e.kind === 'toy' ? 'Play history: the table fills in year by year, from antiquity to today, in the order the elements were found.' : `Color the whole Atlas by ${lookOf(e.id.slice(5) as LookId).blurb.replace(/^./, (c) => c.toLowerCase())}`;
    const sheet = openModal(`<h2>${esc(e.label)}</h2><div class="earn-one"><p>${esc(what)}</p><p class="earn-how">${icon('lock', { size: 20 })}<span>Win ${esc(aPuzzle(unlockPuzzle(e.id)))} to open it, anywhere in the game.</span></p><div class="earn-go"></div></div>`);
    sheet.querySelector('.earn-go')!.append(this.earnCard(e));
  }

  /** A shape still to earn: what it is, how far its period is built, and the card for the next
   *  atom's puzzle, which opens that atom's Build page. */
  private offerShape(e: Earnable): void {
    const l = LAYOUTS.find((x) => `lens:${x.id}` === e.id)!;
    const { built, total } = e.count!;
    const sheet = openModal(`<h2>${esc(e.label)}</h2><div class="earn-one"><p>${esc(LAYOUT_STORY[l.id][0].replace(/<[^>]+>/g, ''))}</p>`
      + `<p class="earn-how">${icon('lock', { size: 20 })}<span>Opens when Period ${e.period} is built.</span></p>`
      + `<div class="earn-count"><span class="earn-bar"><i style="width:${(100 * built) / total}%"></i></span><small>${built} of ${total} built · ${total - built} to go</small></div><div class="earn-go"></div></div>`);
    if (e.next) {
      const z = e.next;
      const step = stepsOf(z).find((st) => !stepState(loadSave(), z, st).done) ?? stepsOf(z)[0];
      const game = atomGame(z, step);
      sheet.querySelector('.earn-go')!.append(gameCard({
        id: game, name: gameName(game), extra: `Next: ${elementAt(z).name}`,
        action: { label: 'Play', ariaLabel: `Build ${elementAt(z).name}`, onClick: () => { closeModal(); this.opts.onBuild(z); } },
      }));
    }
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
    if (this.family) { this.family = null; this.map.setMatches(null); }
    if (look && this.lookOpen(look)) this.setLook(look);
    if (this.view === 'details') this.setView('table');
    this.pick(z, true);
    // A color still to earn: say how.
    const locked = look ? this.earned.find((e) => e.id === `look:${look}` && !e.open) : undefined;
    if (locked) this.offerEarnable(locked);
  }

  /** The microscope: a page's guide, why the atoms are arranged this way (a map), or nothing (Details). */
  registerScience(): void {
    // Only while the Atlas is the screen showing: progress (a new unlock) redraws it from behind
    // other screens, and the floating microscope would then appear over them.
    if (this.root.closest('[hidden]') || !document.getElementById('loupe-screen')?.hidden) return;
    if (this.page.isOpen) { setScienceHandler(() => this.page.openGuide(), 'How to read this page'); return; }
    if (this.view === 'details') { setScienceHandler(null); return; }
    const l = LAYOUTS.find((x) => x.id === this.view)!;
    setScienceHandler(() => {
      setScienceOpen(true);
      openModal(`<h2>${l.label}</h2>${shapeStory(l.id)}`, () => setScienceOpen(false));
    }, `About this shape: ${l.label}`);
  }

  show(): void {
    this.page.show();
    this.refreshEarned();
    // Something opened since the last visit: show it off once.
    const fresh = takeFresh();
    const shape = [...fresh].reverse().find((id) => id.startsWith('lens:'));
    const look = [...fresh].reverse().find((id) => id.startsWith('look:'));
    if (shape && !this.page.isOpen) {
      this.setView(shape.slice(5) as AtlasView);
      this.mapHost.classList.remove('is-reveal');
      void this.mapHost.offsetWidth;
      this.mapHost.classList.add('is-reveal');
      window.setTimeout(() => this.mapHost.classList.remove('is-reveal'), 3200);
      // Nu circles the Shape box, which now shows the newly earned shape.
      const btn = this.root.querySelector<HTMLElement>('[data-menu="shape"]');
      if (btn) requestAnimationFrame(() => nuShow(btn));
    }
    if (look) this.showOnce(look.slice(5) as LookId);
  }

  hide(): void {
    this.closeMenu();
    this.page.hide();
    this.stopLapse();
    this.endTemp();
  }
}
