// An atom's page in the Atlas: what it is, before anything about playing. The bar holds Back,
// the atom's number, symbol and name, and chevrons to the previous and next atom in the view's
// order, with the microscope for each page's guide; then the Info tabs (Overview, Structure,
// Isotopes, Properties, from info.ts); and at the
// foot one contained row, the only way from here into play: Build.
//
//   const page = new AtlasPage({ onBuild, onClose });
//   document.body.append(page.el);
//   page.open(26, order);

import { elementAt, type Element } from './data';
import { tabHTML, TABS, type Tab } from './info';
import { guideHTML } from './guide';
import { mountInfoPage, type InfoState } from './infopage';
import { rowLockNote } from './locks';
import { loadSave, type OrbitalShape } from '../core/save';
import { orbitalShapeUnlocked, SHAPE_AT } from '../core/progress';
import { createTabs, type Tabs } from '../ui/components';
import { icon } from '../ui/icons';
import { openModal } from '../ui/modal';
import { scienceButton } from '../ui/science';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class AtlasPage {
  readonly el: HTMLElement;
  current: number | null = null;
  private order: number[] = [];
  private tab: Tab = 'overview';
  private tabs: Tabs;
  private panel: HTMLElement;
  private state: InfoState = { isoFilter: 'lasting', structView: 'together', hiddenShapes: [] };
  private open_ = false;
  private shown = true;

  constructor(private opts: { onBuild: (z: number) => void; onClose: () => void }) {
    const el = document.createElement('section');
    el.className = 'at-page';
    el.hidden = true;
    el.setAttribute('aria-label', 'An atom in the Atlas');
    el.innerHTML = `
      <div class="ap-bar">
        <button type="button" class="ap-round ap-back" aria-label="Back to the Atlas">${icon('chevron-left', { size: 24 })}</button>
        <div class="ap-name"><small></small><b></b></div>
        <div class="ap-walk">
          <button type="button" class="ap-round ap-step" data-dir="-1">${icon('chevron-left', { size: 20 })}<span></span></button>
          <button type="button" class="ap-round ap-step" data-dir="1"><span></span>${icon('chevron-right', { size: 20 })}</button>
        </div>
      </div>
      <div class="ap-tabs"></div>
      <div class="ap-panel" role="tabpanel"></div>
      <div class="ap-foot"><button type="button" class="ap-build"></button></div>`;
    this.el = el;
    this.panel = el.querySelector('.ap-panel')!;
    this.tabs = createTabs(TABS, { active: this.tab, label: 'About this atom', onChange: (id) => { this.tab = id as Tab; this.render(); } });
    el.querySelector('.ap-tabs')!.append(this.tabs.el);
    // The microscope in the bar opens the open page's guide (Atlas registers it).
    el.querySelector('.ap-walk')!.before(scienceButton('ui-icon-btn ui-icon-btn--ghost science-btn ap-sci'));
    el.querySelector<HTMLButtonElement>('.ap-back')!.onclick = () => this.close();
    el.querySelectorAll<HTMLButtonElement>('.ap-step').forEach((b) => (b.onclick = () => this.step(Number(b.dataset.dir))));
    el.querySelector<HTMLButtonElement>('.ap-build')!.onclick = () => {
      if (this.current != null && !rowLockNote(this.current)) this.opts.onBuild(this.current);
    };
    window.addEventListener('keydown', (ev) => {
      // Only while the page is on screen: not under the 3D atom it opened, nor under a sheet.
      if (!this.isOpen || !this.shown || document.body.dataset.screen !== 'gallery' || !document.getElementById('modal')?.hidden) return;
      if ((ev.target as HTMLElement).closest?.('.ui-tabs, input')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); this.close(); }
      else if (ev.key === 'ArrowRight') this.step(1);
      else if (ev.key === 'ArrowLeft') this.step(-1);
    });
    // The Isotopes page shows what is built and what has decayed.
    window.addEventListener('atomos:progress', () => { if (this.isOpen && this.tab === 'isotopes') this.render(); });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Open on an atom; `order` is the view's order, for the chevrons. */
  open(z: number, order: number[]): void {
    this.order = order;
    this.current = z;
    this.open_ = true;
    this.el.hidden = !this.shown;
    this.paint();
  }

  close(): void {
    this.open_ = false;
    this.el.hidden = true;
    this.opts.onClose();
  }

  /** The Atlas is on screen again: the page comes back as it was, fresh. */
  show(): void {
    this.shown = true;
    if (this.open_) { this.el.hidden = false; this.paint(); }
  }

  /** The Atlas left the screen (Build, another section): the page waits, out of the way. */
  hide(): void {
    this.shown = false;
    this.el.hidden = true;
    // Its Info page leaves the document so the atom screen's own pages are the only ones in it.
    this.panel.replaceChildren();
  }

  /** "How to read this": the open page's guide. */
  openGuide(): void {
    if (this.current != null) openModal(guideHTML(elementAt(this.current), this.tab));
  }

  private step(dir: number): void {
    if (this.current == null) return;
    const i = this.order.indexOf(this.current);
    const z = this.order[i + dir];
    if (z == null) return;
    this.current = z;
    this.paint();
  }

  private paint(): void {
    if (this.current == null) return;
    const e = elementAt(this.current);
    this.el.querySelector('.ap-name small')!.textContent = `${e.z} ${e.symbol}`;
    this.el.querySelector('.ap-name b')!.textContent = e.name;
    const i = this.order.indexOf(e.z);
    this.el.querySelectorAll<HTMLButtonElement>('.ap-step').forEach((b) => {
      const z = this.order[i + Number(b.dataset.dir)];
      b.disabled = z == null;
      b.querySelector('span')!.textContent = z == null ? '' : elementAt(z).symbol;
      b.setAttribute('aria-label', z == null ? 'No more atoms this way' : `${Number(b.dataset.dir) < 0 ? 'Previous' : 'Next'}: ${elementAt(z).name}`);
    });
    this.paintBuild(e);
    this.tabs.select(this.tab, false);
    this.render();
  }

  /** The one way into play: Build, or what opens it while the atom's period is shut. */
  private paintBuild(e: Element): void {
    const b = this.el.querySelector<HTMLButtonElement>('.ap-build')!;
    const lock = rowLockNote(e.z);
    b.disabled = Boolean(lock);
    b.innerHTML = lock
      ? `<span class="ap-build-ico">${icon('lock', { size: 20 })}</span><span class="ap-build-text"><b>Build ${esc(e.name.toLowerCase())}</b><small>${esc(lock)}</small></span>`
      : `<span class="ap-build-ico">${icon('atom', { size: 22 })}</span><span class="ap-build-text"><b>Build ${esc(e.name.toLowerCase())}</b></span><span class="ap-build-go">${icon('chevron-right', { size: 22 })}</span>`;
  }

  private render(): void {
    if (this.current == null || !this.shown) return;
    const e = elementAt(this.current);
    const save = loadSave();
    this.state.hiddenShapes = (Object.keys(SHAPE_AT) as OrbitalShape[]).filter((l) => !orbitalShapeUnlocked(l, save));
    const label = TABS.find((t) => t.id === this.tab)!.label;
    this.panel.innerHTML = `<div class="atom-page">${tabHTML(e, this.tab, save.settings.unlockAll || Boolean(save.built[e.z]), save)}</div>`;
    mountInfoPage(this.panel, this.state);
    this.panel.scrollTop = 0;
    this.panel.setAttribute('aria-label', label);
  }
}
