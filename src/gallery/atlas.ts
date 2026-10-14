// The Atlas: every atom, to admire and to look up. One row of views (Table, the shapes earned so
// far, Details, then the shapes still to earn), then the search and the Color chip, which work in
// every view. Shapes open as periods are built and colors with the first win of a game (earn.ts);
// a locked shape shows a gray preview with how far its period is built and the atom to build next. On a map, a
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
import { nextButton, playButton } from '../ui/components';
import { isUnlocked, unlockPuzzle, type UnlockId } from '../core/unlocks';
import { loadSave } from '../core/save';
import { atomBuilt, rowSpan } from '../core/progress';
import { playUnlock } from '../puzzles/unlock';
import { aPuzzle, earnables, gameName, meetText, takeFresh, watchEarnings, type Earnable } from './earn';
import { UNKNOWN_FILL } from './looks';
import { closeModal, openModal } from '../ui/modal';
import { scienceButton, setScienceHandler, setScienceOpen } from '../ui/science';
import './atlas.css';

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
/** "55.845", or the mass number in brackets for an atom with no standard weight. */
export const weightText = (e: Element): string => (e.weight == null ? `[${e.commonA}]` : String(Number(e.weight.toPrecision(e.weight < 10 ? 4 : 5))));

export class Atlas {
  private view: AtlasView = ((v) => (v === 'details' || isLayoutId(v) ? v : 'table'))(read(VIEW_KEY));
  private look: LookId = ((v) => (isLookId(v) ? v : 'place'))(read(LOOK_KEY));
  private query = '';
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
  private lockEl: HTMLElement;
  private countEl: HTMLButtonElement;
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
      <div class="at-views" role="radiogroup" aria-label="Atlas view"></div>
      <div class="at-tools">
        <label class="at-search">
          <span class="at-search-icon">${icon('search', { size: 20 })}</span>
          <input type="search" id="atlas-search" placeholder="Search" aria-label="Search the atoms by name, symbol or number" autocomplete="off" spellcheck="false" enterkeyhint="go">
          <button type="button" class="at-clear" aria-label="Clear search" hidden>${icon('clear', { size: 22 })}</button>
        </label>
        <button type="button" class="at-color" aria-haspopup="dialog">${icon('paint', { size: 18 })}<small>Color</small><span></span></button>
      </div>
      <div class="at-legend" hidden></div>
      <p class="at-note" hidden></p>
      <div class="at-body">
        <div class="at-map"></div>
        <div class="at-lock" hidden></div>
        <div class="at-list" hidden></div>
      </div>
      <button type="button" class="at-peek" hidden></button>`;
    this.views = host.querySelector('.at-views')!;
    this.input = host.querySelector('input')!;
    this.peekEl = host.querySelector('.at-peek')!;
    this.mapHost = host.querySelector('.at-map')!;
    this.listHost = host.querySelector('.at-list')!;
    this.lockEl = host.querySelector('.at-lock')!;
    this.countEl = document.createElement('button');
    this.countEl.type = 'button';
    this.countEl.className = 'at-count';
    this.countEl.onclick = () => this.openEarned();
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
    this.views.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (b) this.setView(b.dataset.id as AtlasView);
    });
    // Arrow keys walk the views, like any radio group.
    this.views.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const order = this.viewOrder();
      const i = order.findIndex((v) => v.id === this.view);
      const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
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

  /** Table, the open shapes, Details, then the shapes still to earn. */
  private viewOrder(): { id: AtlasView; label: string; locked: boolean }[] {
    const locked = (v: AtlasView) => { const id = lensOf(v); return Boolean(id && !this.earned.find((e) => e.id === id)?.open); };
    const all = VIEWS.map((v) => ({ ...v, locked: locked(v.id) }));
    return [...all.filter((v) => !v.locked), ...all.filter((v) => v.locked)];
  }

  private paintViews(): void {
    this.views.innerHTML = this.viewOrder().map((v) => `<button type="button" role="radio" data-id="${v.id}"${v.locked ? ' class="is-locked"' : ''} aria-label="${v.label}${v.locked ? ', locked' : ''}">${v.locked ? icon('lock', { size: 14 }) : ''}${v.label}</button>`).join('');
    this.views.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => {
      const on = b.dataset.id === this.view;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const shapes = this.earned.filter((e) => e.kind === 'shape'), rest = this.earned.filter((e) => e.kind !== 'shape');
    const n = (l: Earnable[]) => l.filter((e) => e.open).length;
    this.countEl.innerHTML = `${icon('star', { size: 16 })}<span>${n(this.earned)} of ${this.earned.length}</span>`;
    this.countEl.setAttribute('aria-label', `Earned in the Atlas: ${n(shapes)} of ${shapes.length} shapes, ${n(rest)} of ${rest.length} colors and toys`);
  }

  /** After a win or a build: what is open now, and the views row and the map to match. */
  private refreshEarned(): void {
    const before = this.earned.map((e) => e.open).join();
    this.earned = earnables();
    this.paintViews();
    if (before !== this.earned.map((e) => e.open).join()) this.setView(this.view);
    else if (this.lockedView()) this.paintLock();
  }

  /** The current view's lens, when it is still to earn. */
  private lockedView(): Earnable | null {
    const id = lensOf(this.view);
    const e = id ? this.earned.find((x) => x.id === id) : undefined;
    return e && !e.open ? e : null;
  }

  setView(v: AtlasView): void {
    this.view = v;
    write(VIEW_KEY, v);
    this.views.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => {
      const on = b.dataset.id === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.views.querySelector<HTMLElement>(`[data-id="${v}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.stopLapse();
    const lock = this.lockedView();
    this.lockEl.hidden = !lock;
    const note = this.root.querySelector<HTMLElement>('.at-note')!;
    note.hidden = v !== 'sizes';
    note.textContent = v === 'sizes' ? "Drawn to scale: each circle is as wide as its atom (van der Waals radius), from hydrogen's 110 pm to francium's 348 pm." : '';
    this.root.classList.toggle('is-locked', Boolean(lock));
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
      if (lock) this.paintLock();
      else this.paintColors();
    }
    this.registerScience();
  }

  /** A shape still to earn: its cells in gray, the period's built atoms lit, and a card with how
   *  far the period is built and the atom to build next. */
  private paintLock(): void {
    const e = this.lockedView();
    if (!e) return;
    const save = loadSave();
    const [first, last] = rowSpan(e.period!);
    this.map.setColors((el) => (el.z >= first && el.z <= last && atomBuilt(el.z, save) ? lookColor('place', el) : UNKNOWN_FILL));
    const { built, total } = e.count!;
    this.lockEl.innerHTML = `<div class="at-lock-card">
        <b>${esc(e.label)} opens with Period ${e.period}</b>
        <span class="at-lock-bar"><i style="width:${(100 * built) / total}%"></i></span>
        <small>${built} of ${total} built · ${total - built} to go</small>
      </div>`;
    if (e.next) {
      const card = this.lockEl.querySelector('.at-lock-card')!;
      card.append(nextButton({ label: `Next: ${elementAt(e.next).name}`, compact: true, onClick: () => this.opts.onBuild(e.next!) }));
    }
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
    if (!this.lockedView() && !this.lapse) this.map.setColors(fn);
    this.table?.setColors(fn);
    if (this.picked != null) this.pick(this.picked);
    this.root.querySelector('.at-color span')!.textContent = lookOf(look).label;
    const legend = this.root.querySelector<HTMLElement>('.at-legend')!;
    const lg = lookLegend(look);
    const fresh = this.tempLook ? `<span class="at-fresh">${icon('star', { size: 16 })}<b>${esc(lookOf(look).label)}</b> is open<button type="button" class="at-keep">Keep it</button></span>` : '';
    const lapse = look === 'discovery' && !this.root.classList.contains('is-details') ? this.lapseControl() : '';
    legend.hidden = !lg && !fresh;
    if (legend.hidden) return;
    legend.innerHTML = fresh + (!lg ? '' : lg.swatches
      ? lg.swatches.map((s) => `<span class="at-key"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')
      : `<span>${esc(lg.low ?? '')}</span><i class="at-ramp"></i><span>${esc(lg.high ?? '')}</span><span class="at-key"><i class="at-unknown"></i>Not known</span>`) + lapse;
    legend.querySelector<HTMLButtonElement>('.at-keep')?.addEventListener('click', () => { const id = this.tempLook!; this.endTemp(); this.setLook(id); });
    legend.querySelector<HTMLButtonElement>('.at-lapse')?.addEventListener('click', () => this.toggleLapse());
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

  /** The Color sheet: every way to color the atoms, the ones still to earn with how to earn them. */
  private openColors(): void {
    const cur = this.shown();
    const rows = LOOKS.map((l) => {
      const e = this.earned.find((x) => x.id === `look:${l.id}`);
      if (e && !e.open) {
        return `<div class="look-row is-locked" data-id="${l.id}">
          <span class="look-main"><b>${esc(l.label)}</b><span>Win ${esc(aPuzzle(e.game!))} to open it</span></span>
          <span class="look-go"></span></div>`;
      }
      return `<button class="look-row" data-id="${l.id}" aria-pressed="${l.id === cur}">
        <span class="look-main"><b>${esc(l.label)}</b><span>${esc(l.blurb)}</span></span>
        ${l.id === cur ? `<span class="look-on">${icon('check', { size: 20 })}</span>` : ''}
      </button>`;
    }).join('');
    const sheet = openModal(`<h2>Color by</h2><div class="look-list">${rows}</div>`);
    sheet.querySelectorAll<HTMLButtonElement>('button.look-row').forEach((b) => (b.onclick = () => {
      closeModal();
      this.endTemp();
      this.setLook(b.dataset.id as LookId);
    }));
    sheet.querySelectorAll<HTMLElement>('.look-row.is-locked').forEach((r) => {
      const e = this.earned.find((x) => x.id === `look:${r.dataset.id}`)!;
      r.querySelector('.look-go')!.append(this.earnButton(e));
    });
  }

  /** How to earn a color or toy: Play its game right here once it has been played, otherwise the
   *  atom where building next meets it. */
  private earnButton(e: Earnable): HTMLButtonElement {
    if (!e.played && e.next) {
      return playButton({ label: meetText(e), compact: true, icon: 'chevron-right', className: 'look-meet', onClick: () => { closeModal(); this.opts.onBuild(e.next!); } });
    }
    return playButton({
      label: 'Play', compact: true, ariaLabel: `Play ${gameName(e.game!)} to open ${e.label}`,
      onClick: async () => {
        closeModal();
        const won = await playUnlock(e.id, { title: e.kind === 'toy' ? 'The time-lapse' : `${e.label} colors`, note: `${e.label} is open in the Atlas.` });
        if (won) this.refreshEarned();
      },
    });
  }

  /** A locked toy or color on its own: what it is and how to earn it. */
  private offerEarnable(e: Earnable): void {
    const what = e.kind === 'toy' ? 'Play history: the table fills in year by year, from antiquity to today, in the order the elements were found.' : `Color the whole Atlas by ${lookOf(e.id.slice(5) as LookId).blurb.replace(/^./, (c) => c.toLowerCase())}`;
    const sheet = openModal(`<h2>${esc(e.label)}</h2><div class="earn-one"><p>${esc(what)}</p><p class="earn-how">${icon('lock', { size: 20 })}<span>Win ${esc(aPuzzle(unlockPuzzle(e.id)))} to open it, anywhere in the game.</span></p><div class="earn-go"></div></div>`);
    sheet.querySelector('.earn-go')!.append(this.earnButton(e));
  }

  /** The count beside the title: everything there is to earn in the Atlas, open or not. */
  private openEarned(): void {
    const row = (e: Earnable) => `<div class="earn-row${e.open ? ' is-open' : ''}" data-id="${e.id}">
        <span class="look-main"><b>${esc(e.label)}</b><span>${esc(e.kind === 'shape' && !e.open ? `${e.how}: ${e.count!.built} of ${e.count!.total} built` : e.how)}</span></span>
        <span class="earn-mark">${e.open ? icon('check', { size: 20 }) : ''}</span></div>`;
    const part = (title: string, list: Earnable[]) => `<h3 class="earn-h">${title} <small>${list.filter((e) => e.open).length} of ${list.length}</small></h3>${list.map(row).join('')}`;
    const sheet = openModal(`<h2>Earn the Atlas</h2><p class="earn-lede">Every fact is open. Building periods opens new shapes, and each game's first win opens a new way to color the table.</p>
      <div class="look-list">${part('Shapes', this.earned.filter((e) => e.kind === 'shape'))}${part('Colors and toys', this.earned.filter((e) => e.kind !== 'shape'))}</div>`);
    sheet.querySelectorAll<HTMLElement>('.earn-row:not(.is-open)').forEach((r) => {
      const e = this.earned.find((x) => x.id === r.dataset.id)!;
      const mark = r.querySelector('.earn-mark')!;
      if (e.kind === 'shape') {
        if (e.next) mark.append(playButton({ label: elementAt(e.next).name, compact: true, icon: 'chevron-right', onClick: () => { closeModal(); this.opts.onBuild(e.next!); } }));
      } else mark.append(this.earnButton(e));
    });
  }

  /** Beside the Atlas title: how much of the Atlas is earned; a tap lists the rest. */
  get countButton(): HTMLButtonElement {
    return this.countEl;
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
    if (look && this.lookOpen(look)) this.setLook(look);
    if (this.view === 'details' || this.lockedView()) this.setView('table');
    this.pick(z, true);
    // A color still to earn: say how.
    const locked = look ? this.earned.find((e) => e.id === `look:${look}` && !e.open) : undefined;
    if (locked) this.offerEarnable(locked);
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
    }
    if (look) this.showOnce(look.slice(5) as LookId);
  }

  hide(): void {
    this.page.hide();
    this.stopLapse();
    this.endTemp();
  }
}
