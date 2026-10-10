// The gallery screen: the vitrine of all 118 atoms and the loupe over one of
// them, wired to the page. The atom screen's View has tabs: the 3D model, with
// a few white captions round the atom, then the element's science as pages.
// Each page ends with a "How to read this" button that opens its guide.

import { STYLES, type Style } from './atom';
import { CLOUD_RINGS, ELEMENTS, MAX_Z, elementAt, type Element } from './data';
import { Detail } from './detail';
import { Gallery } from './gallery';
import { decoratorsHTML, tabHTML, VIEW_TABS, type ViewTab } from './info';
import { guideHTML } from './guide';
import { icon, type IconName } from '../ui/icons';
import { createSegments, createTabs, type Tabs } from '../ui/components';
import { ISO_FILTERS, STRUCTURE_VIEWS } from './visuals';
import { createAtomBar, type AtomBar } from './atombar';
import { isLayoutId, LAYOUT_STORY, LAYOUTS, type LayoutId } from './layouts';
import { setScienceHandler, setScienceOpen } from '../ui/science';
import { openModal } from '../ui/modal';
import { loadSave, writeSave, type SaveData } from '../core/save';
import { atomProgress } from '../core/progress';
import { createElementList, type ElementList } from '../ui/elementlist';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface GalleryHandlers {
  /** Opens Build mode on an element. */
  onBuild: (z: number) => void;
  /** The loupe opened on an element, or closed (null): the app shell tracks which. */
  onLoupe?: (z: number | null) => void;
}

export class GalleryApp {
  private save: SaveData = loadSave();
  private gallery: Gallery;
  private detail: Detail;
  private current: Element | null = null;
  private tab: ViewTab = 'model';
  private isoFilter = 'all';
  private structView = 'blueprint';
  private layoutId: LayoutId = (() => {
    const saved = localStorage.getItem('atomos.gallery.layout');
    return isLayoutId(saved) ? saved : 'spiral';
  })();
  private style: Style = (() => {
    const saved = localStorage.getItem('atomos.gallery.style');
    return STYLES.some((s) => s.id === saved) ? (saved as Style) : 'cloud';
  })();
  /** The gallery shows the atoms on a map, or every element in a sortable Details table. */
  private details = localStorage.getItem('atomos.gallery.view') === 'details';
  private list: ElementList | null = null;
  private rings = localStorage.getItem('atomos.gallery.rings') !== 'off';
  private tabs!: Tabs;
  private bar!: AtomBar;

  constructor(private handlers: GalleryHandlers) {
    this.gallery = new Gallery($('gal'), $('gal-labels'));
    this.detail = new Detail($('loupe'));
    this.gallery.setReducedMotion(this.save.settings.reducedMotion);
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
    this.buildControls();
    this.refreshCollected();
    this.gallery.setLayout(this.layoutId, false);
    this.detail.setStyle(this.style);
    this.detail.setRings(this.rings);
    this.gallery.onPick = (e) => this.open(e);
    this.gallery.onHover = (e) => this.hover(e);
    window.addEventListener('keydown', (ev) => this.key(ev));
    // Build announces each change to an atom's progress so the tiles' bars stay current.
    window.addEventListener('atomos:progress', () => this.refreshCollected());
    this.paintDetails();
    this.startMap();
    this.registerScience();
  }

  /** Re-read the save: called when the game screen hands back. */
  refreshCollected(): void {
    this.save = loadSave();
    const got = this.save.settings.unlockAll ? ELEMENTS.map((e) => e.z) : Object.keys(this.save.built).map(Number);
    const save = this.save;
    this.gallery.setCollected(got, (z) => atomProgress(z, save));
    if (this.current) this.detail.setCollected(this.collected(this.current.z));
    $('gal-count').textContent = `${got.length} of ${MAX_Z}`;
    this.list?.refresh();
  }

  private collected(z: number): boolean {
    return this.save.settings.unlockAll || Boolean(this.save.built[z]);
  }

  private buildControls(): void {
    const seg = $('layout-switch');
    seg.innerHTML = LAYOUTS.map((l) => `<button data-id="${l.id}">${l.label}</button>`).join('')
      + `<button data-id="details">Details</button>`;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
      if (b.dataset.id === 'details') this.setDetails(true);
      else this.setLayout(b.dataset.id as LayoutId);
    }));
    // The two corner tools speak the same way: a small caption, then chips with an icon and a
    // plain label. Bottom right: how the atom is drawn.
    const styleIcon: Record<Style, IconName> = { cloud: 'view-cloud', shapes: 'view-shapes', hybrid: 'view-hybrid' };
    const styles = $('style-switch');
    styles.innerHTML = `<span class="tool-cap">Draw as</span>`
      + STYLES.map((s) => `<button class="tool-chip" data-id="${s.id}" aria-pressed="${s.id === this.style}">${icon(styleIcon[s.id], { size: 18 })}<span>${s.label}</span></button>`).join('');
    styles.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setStyle(b.dataset.id as Style)));
    // Bottom left: the scale circles, one line per circle with its diameter, and the switch.
    const line = (style: string) => `<svg width="18" height="4" aria-hidden="true"><line x1="1" y1="2" x2="17" y2="2" stroke="currentColor" stroke-width="1.5"${style === 'dashed' ? ' stroke-dasharray="3 2.5"' : ''}/></svg>`;
    const legend = $('scale-legend');
    legend.innerHTML = `<span class="tool-cap">Scale circles</span>`
      + `<ul>${CLOUD_RINGS.map((r, i) => `<li>${line(r.style)}<span>${r.pm * 2}${i === CLOUD_RINGS.length - 1 ? ' pm' : ''}</span></li>`).join('')}</ul>`
      + `<button class="tool-chip" id="rings-toggle" aria-pressed="${this.rings}"></button>`;
    $('rings-toggle').onclick = () => this.setRings(!this.rings);
    this.paintRingsToggle();
    // The bar: previous, the element (opens the picker), next.
    this.bar = createAtomBar({ onChange: (z) => this.open(elementAt(z)), locked: (z) => !this.collected(z) });
    $('loupe-screen').append(this.bar.el);
    // View's tabs: the model, then the element's science as pages.
    this.tabs = createTabs(VIEW_TABS, { active: this.tab, label: 'About this element', onChange: (id) => this.setTab(id as ViewTab) });
    this.tabs.el.setAttribute('aria-controls', 'atom-panel');
    $('atom-tabs').append(this.tabs.el);
    this.bindTabSwipe();
  }

  /** Swipe sideways on a page to move between tabs; tables that scroll sideways keep the gesture. The model turns instead. */
  private bindTabSwipe(): void {
    const body = $('atom-panel');
    let start: { x: number; y: number; t: number } | null = null;
    body.addEventListener('pointerdown', (ev) => {
      start = null;
      for (let n = ev.target as HTMLElement | null; n && n !== body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX !== 'visible') return;
      }
      start = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    body.addEventListener('pointerup', (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y, dt = performance.now() - start.t;
      start = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6 || dt > 700) return;
      const i = VIEW_TABS.findIndex((t) => t.id === this.tab);
      const next = VIEW_TABS[i + (dx < 0 ? 1 : -1)];
      if (!next) return;
      this.tabs.select(next.id);
      this.setTab(next.id);
    });
    body.addEventListener('pointercancel', () => { start = null; });
  }

  private setRings(on: boolean): void {
    this.rings = on;
    localStorage.setItem('atomos.gallery.rings', on ? 'on' : 'off');
    this.detail.setRings(on);
    this.paintRingsToggle();
  }

  private paintRingsToggle(): void {
    const b = $('rings-toggle');
    // The chip names what tapping it does, like the drawing chips name what they draw.
    b.innerHTML = `${icon(this.rings ? 'scale-off' : 'scale', { size: 18 })}<span>${this.rings ? 'Hide' : 'Show'}</span>`;
    b.setAttribute('aria-label', this.rings ? 'Hide the scale circles' : 'Show the scale circles');
    $('scale-legend').classList.toggle('off', !this.rings);
  }

  private setLayout(id: LayoutId): void {
    const animate = !this.details && !this.save.settings.reducedMotion;
    this.layoutId = id;
    localStorage.setItem('atomos.gallery.layout', id);
    this.gallery.setLayout(id, animate);
    this.setDetails(false);
  }

  /** Switch between the map and the Details table. */
  private setDetails(on: boolean): void {
    const was = this.details;
    this.details = on;
    try { localStorage.setItem('atomos.gallery.view', on ? 'details' : 'map'); } catch { /* storage off: the choice just resets */ }
    this.paintDetails();
    if (!$('gallery-screen').hidden && $('loupe-screen').hidden) {
      if (on) this.gallery.stop();
      else if (was) this.gallery.start();
    }
    this.registerScience();
  }

  /** The arrangement buttons, the note under them, and the table when Details is on. */
  private paintDetails(): void {
    const id = this.details ? 'details' : this.layoutId;
    $('layout-switch').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    $('layout-note').textContent = this.details ? 'Every element in one table: tap a heading to sort, a row to open it' : LAYOUTS.find((l) => l.id === this.layoutId)!.note;
    $('gallery-screen').classList.toggle('is-details', this.details);
    $('gal-details').hidden = !this.details;
    if (this.details && !this.list) {
      this.list = createElementList({
        variant: 'table',
        onPick: (z) => this.open(elementAt(z)),
        locked: (z) => !this.collected(z),
        storageKey: 'atomos.details.sort',
      });
      $('gal-details').append(this.list.el);
    }
  }

  /** Run the map's render loop, unless the Details table covers it. */
  private startMap(): void {
    if (!this.details) this.gallery.start();
  }

  private setStyle(style: Style): void {
    this.style = style;
    localStorage.setItem('atomos.gallery.style', style);
    $('style-switch').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === style)));
    this.detail.setStyle(style);
  }

  private hover(e: Element | null): void {
    const tag = $('gal-hover');
    tag.hidden = !e;
    if (e) tag.textContent = `${e.z} ${e.name}${this.collected(e.z) ? '' : ' · not yet collected'}`;
  }

  private open(e: Element): void {
    const first = !this.current;
    this.current = e;
    this.gallery.select(e.z);
    this.detail.show(e, !first);
    this.detail.setCollected(this.collected(e.z));
    const dec = decoratorsHTML(e);
    $('dec-top-left').innerHTML = dec.topLeft;
    $('dec-top-right').innerHTML = dec.topRight;
    this.bar.set(e.z);
    this.renderPanel();
    const screen = $('loupe-screen');
    if (screen.hidden) {
      screen.hidden = false;
      this.gallery.stop();
      if (this.tab === 'model') this.detail.start();
      requestAnimationFrame(() => { screen.classList.add('in'); this.tabs.select(this.tab); });
    }
    this.registerScience();
    this.handlers.onLoupe?.(e.z);
  }

  /** The microscope: the arrangement's story on the map. In the atom view each page has its own
   *  guide button at its foot instead, so the row's microscope stands down there. */
  private registerScience(): void {
    if ($('gallery-screen').hidden) return;
    if ((!$('loupe-screen').hidden && this.current) || this.details) setScienceHandler(null);
    else setScienceHandler(() => this.openLayoutStory(), 'Why the atoms are arranged this way');
  }

  private openGuide(): void {
    if (!this.current || this.tab === 'model') return;
    openModal(guideHTML(this.current, this.tab));
  }

  private openLayoutStory(): void {
    const l = LAYOUTS.find((x) => x.id === this.layoutId)!;
    setScienceOpen(true);
    openModal(`<h2>${l.label}</h2>${LAYOUT_STORY[l.id].map((p) => `<p>${p}</p>`).join('')}`, () => setScienceOpen(false));
  }

  /** Open the loupe on an element (Atom, View mode), from the app shell. */
  openAtom(z: number): void {
    if (this.current?.z === z && !$('loupe-screen').hidden) return;
    this.open(elementAt(z));
  }

  /** Back to the maps, from the app shell. */
  closeAtom(): void {
    if (!$('loupe-screen').hidden) this.close();
  }

  private close(): void {
    const screen = $('loupe-screen');
    screen.classList.remove('in');
    this.detail.stop();
    if (this.current) this.gallery.focus(this.current.z);
    this.startMap();
    window.setTimeout(() => { screen.hidden = true; this.registerScience(); }, 220);
    this.handlers.onLoupe?.(null);
  }

  private step(dir: 1 | -1): void {
    if (!this.current) return;
    const z = this.current.z + dir;
    if (z < 1 || z > MAX_Z) return;
    this.open(elementAt(z));
  }

  private setTab(tab: ViewTab): void {
    this.tab = tab;
    const model = tab === 'model';
    $('loupe-screen').classList.toggle('on-page', !model);
    $('atom-panel').hidden = model;
    if (!$('loupe-screen').hidden && !$('gallery-screen').hidden) {
      if (model) this.detail.start(); else this.detail.stop();
    }
    this.renderPanel();
    $('atom-panel').scrollTop = 0;
  }

  /** The open page, for the current element; the model needs no page. */
  private renderPanel(): void {
    if (!this.current || this.tab === 'model') return;
    const panel = $('atom-panel');
    const label = VIEW_TABS.find((t) => t.id === this.tab)!.label.toLowerCase();
    panel.innerHTML = `<div class="atom-page">${tabHTML(this.current, this.tab, this.collected(this.current.z))}`
      + `<div class="page-guide"><button type="button" class="guide-btn" id="guide-btn">${icon('microscope')}<span><b>How to read this</b><small>A guide to the ${label} page, and more context</small></span></button></div></div>`;
    $('guide-btn').onclick = () => this.openGuide();
    this.mountIsotopeFilter();
    this.mountStructureSwitch();
    panel.scrollTop = 0;
    panel.setAttribute('aria-label', VIEW_TABS.find((t) => t.id === this.tab)!.label);
  }

  /** The structure page's three ways to see the atom: the blueprint, the shells as they are, the orbital boxes. */
  private mountStructureSwitch(): void {
    const slot = document.getElementById('struct-switch');
    if (!slot) return;
    const views = [...document.querySelectorAll<HTMLElement>('.st-view')];
    const apply = (id: string) => {
      this.structView = id;
      for (const v of views) v.hidden = v.dataset.view !== id;
    };
    const seg = createSegments(STRUCTURE_VIEWS, { active: this.structView, label: 'How to see the structure', onChange: apply });
    slot.append(seg.el);
    seg.select(this.structView);
    apply(this.structView);
  }

  /** The isotope page's filter: All, Stable, In nature, Radioactive; kept while stepping through elements. */
  private mountIsotopeFilter(): void {
    const slot = document.getElementById('iso-filter');
    const table = document.getElementById('iso-table');
    if (!slot || !table) return;
    const counts = JSON.parse(slot.dataset.counts ?? '{}') as Record<string, number>;
    const apply = (id: string) => {
      this.isoFilter = id;
      let shown = 0;
      table.querySelectorAll<HTMLElement>('.it-row[data-kinds]').forEach((row) => {
        const on = row.dataset.kinds!.split(' ').includes(id);
        row.hidden = !on;
        if (on) shown++;
      });
      table.classList.toggle('is-empty', shown === 0);
    };
    const seg = createSegments(ISO_FILTERS.map((f) => ({ id: f.id, label: `${f.label} ${counts[f.id] ?? 0}` })), { active: this.isoFilter, label: 'Show isotopes', onChange: apply });
    slot.append(seg.el);
    seg.select(this.isoFilter);
    apply(this.isoFilter);
  }

  private key(ev: KeyboardEvent): void {
    if ($('gallery-screen').hidden || $('loupe-screen').hidden) return;
    if (!$('modal').hidden || document.querySelector('.ui-drawer')) return;
    // Arrow keys on the tab strip move between tabs; elsewhere they step through the elements.
    if ((ev.target as HTMLElement).closest?.('.ui-tabs')) return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
    else if (ev.key === 'Escape') this.close();
  }

  /** Show the gallery screen (after the game hands back). */
  show(): void {
    $('gallery-screen').hidden = false;
    this.refreshCollected();
    this.registerScience();
    if ($('loupe-screen').hidden) this.startMap(); else if (this.tab === 'model') this.detail.start();
  }

  hide(): void {
    $('gallery-screen').hidden = true;
    this.gallery.stop();
    this.detail.stop();
  }

  /** Persist a setting change made from the game's settings sheet. */
  syncSettings(): void {
    this.save = loadSave();
    writeSave(this.save);
    this.gallery.setReducedMotion(this.save.settings.reducedMotion);
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
  }
}
