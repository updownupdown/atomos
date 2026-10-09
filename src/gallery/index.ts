// The gallery screen: the vitrine of all 118 atoms and the loupe over one of
// them, wired to the page. The top layer is visual; every number lives in the
// sheet the player opens from the card.

import { STYLES, type Style } from './atom';
import { ELEMENTS, MAX_Z, elementAt, type Element } from './data';
import { Detail } from './detail';
import { Gallery } from './gallery';
import { cardHTML, TABS, tabHTML, type Tab } from './info';
import { LAYOUTS, type LayoutId } from './layouts';
import { loadSave, writeSave, type SaveData } from '../core/save';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface GalleryHandlers {
  /** Opens the old building prototype on an element. */
  onBuild: (z: number) => void;
}

export class GalleryApp {
  private save: SaveData = loadSave();
  private gallery: Gallery;
  private detail: Detail;
  private current: Element | null = null;
  private tab: Tab = 'overview';
  private sheetOpen = false;
  private layoutId: LayoutId = (localStorage.getItem('atomos.gallery.layout') as LayoutId) || 'spiral';
  private style: Style = (localStorage.getItem('atomos.gallery.style') as Style) || 'cloud';

  constructor(private handlers: GalleryHandlers) {
    this.gallery = new Gallery($('gal'), $('gal-labels'));
    this.detail = new Detail($('loupe'), $('ring-labels'));
    this.gallery.setReducedMotion(this.save.settings.reducedMotion);
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
    this.buildControls();
    this.refreshCollected();
    this.gallery.setLayout(this.layoutId, false);
    this.detail.setStyle(this.style);
    this.gallery.onPick = (e) => this.open(e);
    this.gallery.onHover = (e) => this.hover(e);
    this.detail.onSwipe = (dir) => this.step(dir);
    this.detail.onTap = () => this.toggleSheet(false);
    window.addEventListener('keydown', (ev) => this.key(ev));
    this.gallery.start();
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
    const styles = $('style-switch');
    styles.innerHTML = STYLES.map((s) => `<button data-id="${s.id}" aria-pressed="${s.id === this.style}">${s.label}</button>`).join('');
    styles.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setStyle(b.dataset.id as Style)));
    $('loupe-back').onclick = () => this.close();
    $('loupe-prev').onclick = () => this.step(-1);
    $('loupe-next').onclick = () => this.step(1);
    $('card').onclick = () => this.toggleSheet();
    $('sheet-close').onclick = () => this.toggleSheet(false);
    $('sheet-build').onclick = () => { if (this.current) this.handlers.onBuild(this.current.z); };
    const tabs = $('sheet-tabs');
    tabs.innerHTML = TABS.map((t) => `<button data-id="${t.id}" aria-pressed="${t.id === this.tab}">${t.label}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setTab(b.dataset.id as Tab)));
    $('gal-build').onclick = () => this.handlers.onBuild(this.current?.z ?? 1);
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

  private open(e: Element, dir: 1 | -1 | 0 = 0): void {
    const first = !this.current;
    this.current = e;
    this.gallery.select(e.z);
    this.detail.show(e, !first, dir);
    this.detail.setCollected(this.collected(e.z));
    $('card').innerHTML = cardHTML(e, this.collected(e.z));
    $<HTMLButtonElement>('loupe-prev').disabled = e.z === 1;
    $<HTMLButtonElement>('loupe-next').disabled = e.z === MAX_Z;
    $('loupe-prev').textContent = e.z > 1 ? `‹ ${elementAt(e.z - 1).symbol}` : '‹';
    $('loupe-next').textContent = e.z < MAX_Z ? `${elementAt(e.z + 1).symbol} ›` : '›';
    if (this.sheetOpen) this.renderSheet();
    const screen = $('loupe-screen');
    if (screen.hidden) {
      screen.hidden = false;
      this.gallery.stop();
      this.detail.start();
      requestAnimationFrame(() => screen.classList.add('in'));
    }
  }

  private close(): void {
    const screen = $('loupe-screen');
    screen.classList.remove('in');
    this.toggleSheet(false);
    this.detail.stop();
    if (this.current) this.gallery.focus(this.current.z);
    this.gallery.start();
    window.setTimeout(() => { screen.hidden = true; }, 220);
  }

  private step(dir: 1 | -1): void {
    if (!this.current) return;
    const z = this.current.z + dir;
    if (z < 1 || z > MAX_Z) return;
    this.open(elementAt(z), dir);
  }

  private toggleSheet(open = !this.sheetOpen): void {
    this.sheetOpen = open;
    const sheet = $('sheet');
    sheet.hidden = !open;
    $('card').setAttribute('aria-expanded', String(open));
    if (open) this.renderSheet();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    $('sheet-tabs').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === tab)));
    this.renderSheet();
  }

  private renderSheet(): void {
    if (!this.current) return;
    const e = this.current;
    $('sheet-title').innerHTML = `<b>${e.symbol}</b> ${e.name} <span class="dim">${e.z}</span>`;
    $('sheet-body').innerHTML = tabHTML(e, this.tab, this.collected(e.z));
    $('sheet-body').scrollTop = 0;
  }

  private key(ev: KeyboardEvent): void {
    if ($('loupe-screen').hidden) return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
    else if (ev.key === 'Escape') { if (this.sheetOpen) this.toggleSheet(false); else this.close(); }
  }

  /** Show the gallery screen (after the game hands back). */
  show(): void {
    $('gallery-screen').hidden = false;
    this.refreshCollected();
    if ($('loupe-screen').hidden) this.gallery.start(); else this.detail.start();
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
