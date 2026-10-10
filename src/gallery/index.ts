// The gallery screen: the vitrine of all 118 atoms and the loupe over one of
// them, wired to the page. The top layer is visual, with a few white captions
// round the atom; every number lives in the modal behind the microscope.

import { STYLES, type Style } from './atom';
import { CLOUD_RINGS, ELEMENTS, MAX_Z, elementAt, type Element } from './data';
import { Detail } from './detail';
import { Gallery } from './gallery';
import { decoratorsHTML, TABS, tabHTML, type Tab } from './info';
import { icon, type IconName } from '../ui/icons';
import { closeButton, createTabs, type Tabs } from '../ui/components';
import { openElementPicker } from '../ui/picker';
import { isLayoutId, LAYOUT_STORY, LAYOUTS, type LayoutId } from './layouts';
import { setScienceHandler, setScienceOpen } from '../ui/science';
import { openModal } from '../ui/modal';
import { loadSave, writeSave, type SaveData } from '../core/save';

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
  private tab: Tab = 'overview';
  private sheetOpen = false;
  private layoutId: LayoutId = (() => {
    const saved = localStorage.getItem('atomos.gallery.layout');
    return isLayoutId(saved) ? saved : 'spiral';
  })();
  private style: Style = (() => {
    const saved = localStorage.getItem('atomos.gallery.style');
    return STYLES.some((s) => s.id === saved) ? (saved as Style) : 'cloud';
  })();
  private rings = localStorage.getItem('atomos.gallery.rings') !== 'off';
  private isoOpen = false;
  private tabs!: Tabs;

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
    this.detail.onTap = () => this.toggleSheet(false);
    window.addEventListener('keydown', (ev) => this.key(ev));
    this.gallery.start();
    this.registerScience();
  }

  /** Re-read the save: called when the game screen hands back. */
  refreshCollected(): void {
    this.save = loadSave();
    const got = this.save.settings.unlockAll ? ELEMENTS.map((e) => e.z) : Object.keys(this.save.built).map(Number);
    this.gallery.setCollected(got);
    if (this.current) this.detail.setCollected(this.collected(this.current.z));
    $('gal-count').textContent = `${got.length} of ${MAX_Z}`;
  }

  private collected(z: number): boolean {
    return this.save.settings.unlockAll || Boolean(this.save.built[z]);
  }

  private buildControls(): void {
    const seg = $('layout-switch');
    seg.innerHTML = LAYOUTS.map((l) => `<button data-id="${l.id}" aria-pressed="${l.id === this.layoutId}">${l.label}</button>`).join('');
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setLayout(b.dataset.id as LayoutId)));
    $('layout-note').textContent = LAYOUTS.find((l) => l.id === this.layoutId)!.note;
    // Bottom right: how the atom is drawn, as three icons.
    const styleIcon: Record<Style, IconName> = { cloud: 'view-cloud', shapes: 'view-shapes', hybrid: 'view-hybrid' };
    const styles = $('style-switch');
    styles.innerHTML = STYLES.map((s) => `<button class="ui-icon-btn ui-icon-btn--ghost" data-id="${s.id}" aria-pressed="${s.id === this.style}" aria-label="${s.label}" title="${s.label}">${icon(styleIcon[s.id])}</button>`).join('');
    styles.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setStyle(b.dataset.id as Style)));
    // Bottom left: the scale legend, one short line per reference circle with its diameter, and the toggle.
    const legend = $('scale-legend');
    legend.innerHTML = `<button class="ui-icon-btn ui-icon-btn--ghost scale-toggle" id="rings-toggle" aria-pressed="${this.rings}"></button>`
      + `<ul>${CLOUD_RINGS.map((r) => `<li><i class="${r.style}"></i>${r.pm * 2}</li>`).join('')}</ul><span class="unit">pm across</span>`;
    $('rings-toggle').onclick = () => this.setRings(!this.rings);
    this.paintRingsToggle();
    // The bar: previous, the element's name (opens the science), next.
    $('loupe-prev').innerHTML = icon('prev', { size: 28 });
    $('loupe-next').innerHTML = icon('next', { size: 28 });
    $('loupe-prev').onclick = () => this.step(-1);
    $('loupe-next').onclick = () => this.step(1);
    $('bar-pick').onclick = () => this.openPicker();
    // Top right: the isotope summary opens a short list.
    $('dec-top-right').addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.iso-toggle')) this.setIsoOpen(!this.isoOpen);
    });
    // The science modal: floating card, tabs, an X; tapping the dimmed page behind closes it.
    const card = $('sheet-card');
    card.prepend(closeButton(() => this.toggleSheet(false)));
    $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) this.toggleSheet(false); });
    this.tabs = createTabs(TABS.map((t) => ({ id: t.id, label: t.label })), { active: this.tab, label: 'About this element', onChange: (id) => this.setTab(id as Tab) });
    $('sheet-tabs').replaceWith(this.tabs.el);
    this.tabs.el.id = 'sheet-tabs';
    this.bindTabSwipe();
  }

  /** The element picker opens from the number and symbol in the bar. */
  private openPicker(): void {
    openElementPicker((z) => this.open(elementAt(z)), { current: this.current?.z, locked: (z) => !this.collected(z) });
  }

  /** Swipe sideways in the science sheet to move between tabs; tables that scroll sideways keep the gesture. */
  private bindTabSwipe(): void {
    const body = $('sheet-body');
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
      const i = TABS.findIndex((t) => t.id === this.tab);
      const next = TABS[i + (dx < 0 ? 1 : -1)];
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
    b.innerHTML = icon(this.rings ? 'scale' : 'scale-off');
    b.setAttribute('aria-pressed', String(this.rings));
    const label = this.rings ? 'Hide the scale circles' : 'Show the scale circles';
    b.setAttribute('aria-label', label);
    b.title = label;
    $('scale-legend').classList.toggle('off', !this.rings);
  }

  private setIsoOpen(open: boolean): void {
    this.isoOpen = open;
    const tr = $('dec-top-right');
    tr.classList.toggle('open', open);
    const t = tr.querySelector('.iso-toggle');
    if (t) {
      t.setAttribute('aria-expanded', String(open));
      t.querySelector('.chev')!.innerHTML = icon(open ? 'chevron-up' : 'chevron-down', { size: 18 });
    }
  }

  private setLayout(id: LayoutId): void {
    this.layoutId = id;
    localStorage.setItem('atomos.gallery.layout', id);
    $('layout-switch').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    $('layout-note').textContent = LAYOUTS.find((l) => l.id === id)!.note;
    this.gallery.setLayout(id, !this.save.settings.reducedMotion);
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
    const dec = decoratorsHTML(e, this.collected(e.z));
    $('dec-top-left').innerHTML = dec.topLeft;
    $('dec-top-right').innerHTML = `<button class="iso-toggle" aria-expanded="false" aria-controls="iso-list">${dec.isoSummary}<span class="chev"></span></button><div class="iso-list" id="iso-list">${dec.isoList}</div>`;
    this.setIsoOpen(this.isoOpen);
    $('dec-name').innerHTML = dec.name;
    $('bar-pick').innerHTML = `${dec.pick}<span class="bar-chev">${icon('chevron-up', { size: 18 })}</span>`;
    $<HTMLButtonElement>('loupe-prev').disabled = e.z === 1;
    $<HTMLButtonElement>('loupe-next').disabled = e.z === MAX_Z;
    $('loupe-prev').title = e.z > 1 ? elementAt(e.z - 1).name : '';
    $('loupe-next').title = e.z < MAX_Z ? elementAt(e.z + 1).name : '';
    if (this.sheetOpen) this.renderSheet();
    const screen = $('loupe-screen');
    if (screen.hidden) {
      screen.hidden = false;
      this.gallery.stop();
      this.detail.start();
      requestAnimationFrame(() => screen.classList.add('in'));
    }
    this.registerScience();
    this.handlers.onLoupe?.(e.z);
  }

  /** The header microscope: the element's science in the atom view, the arrangement's story on the map. */
  private registerScience(): void {
    if ($('gallery-screen').hidden) return;
    if (!$('loupe-screen').hidden && this.current) setScienceHandler(() => this.toggleSheet(), `The science of ${this.current.name}`);
    else setScienceHandler(() => this.openLayoutStory(), 'Why the atoms are arranged this way');
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
    this.toggleSheet(false);
    this.detail.stop();
    if (this.current) this.gallery.focus(this.current.z);
    this.gallery.start();
    window.setTimeout(() => { screen.hidden = true; this.registerScience(); }, 220);
    this.handlers.onLoupe?.(null);
  }

  private step(dir: 1 | -1): void {
    if (!this.current) return;
    const z = this.current.z + dir;
    if (z < 1 || z > MAX_Z) return;
    this.open(elementAt(z));
  }

  private toggleSheet(open = !this.sheetOpen): void {
    this.sheetOpen = open;
    const sheet = $('sheet');
    sheet.hidden = !open;
    setScienceOpen(open);
    if (open) {
      this.renderSheet();
      this.tabs.select(this.tab);
    }
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.renderSheet();
    $('sheet-body').scrollTop = 0;
    this.tabs.el.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  private renderSheet(): void {
    if (!this.current) return;
    const e = this.current;
    $('sheet-title').innerHTML = `<b>${e.symbol}</b> ${e.name} <span class="dim">${e.z}</span>`;
    $('sheet-body').innerHTML = tabHTML(e, this.tab, this.collected(e.z));
    $('sheet-body').scrollTop = 0;
  }

  private key(ev: KeyboardEvent): void {
    if ($('gallery-screen').hidden || $('loupe-screen').hidden) return;
    if (this.sheetOpen && ev.key !== 'Escape') return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
    else if (ev.key === 'Escape') { if (this.sheetOpen) this.toggleSheet(false); else this.close(); }
  }

  /** Show the gallery screen (after the game hands back). */
  show(): void {
    $('gallery-screen').hidden = false;
    this.refreshCollected();
    this.registerScience();
    if ($('loupe-screen').hidden) this.gallery.start(); else this.detail.start();
  }

  hide(): void {
    $('gallery-screen').hidden = true;
    this.toggleSheet(false);
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
