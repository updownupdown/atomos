// An atom's page in the Atlas: what it is, before anything about playing. It is the atom's Info
// from anywhere in the app. Which atom it is, the way back to the maps and the list of the
// others are in the header's trail: Atlas › (Nd Neodymium ⌄); the arrow keys step through the
// view's order. Then the Info tabs (Overview, Structure, Isotopes, Properties, from info.ts). On
// Overview, View (the 3D atom full screen) sits in its card, and at its foot one card, the only
// way from here into play: Build.
//
//   const page = new AtlasPage({ onBuild, onClose });
//   document.body.append(page.el);
//   page.open(26, order);

import { elementAt, type Element } from './data';
import { tabHTML, TABS, type Tab } from './info';
import { guideHTML } from './guide';
import { guideFoot, mountInfoPage, type InfoState } from './infopage';
import { rowLockNote } from './locks';
import { loadSave, type OrbitalShape } from '../core/save';
import { fleetingCount, orbitalShapeUnlocked, segmentsOf, SHAPE_AT } from '../core/progress';
import { createTabs, type Tabs } from '../ui/components';
import { icon } from '../ui/icons';
import { openModal } from '../ui/modal';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class AtlasPage {
  readonly el: HTMLElement;
  current: number | null = null;
  private order: number[] = [];
  private tab: Tab = 'overview';
  private tabs: Tabs;
  private panel: HTMLElement;
  private state: InfoState = { isoFilter: 'lasting', structView: 'together', hiddenShapes: [] };
  private guide = guideFoot();
  private open_ = false;
  /** Build, at the foot of Overview. */
  private build = document.createElement('button');
  private foot = document.createElement('div');
  /** View, in Overview's card. */
  private view = document.createElement('button');
  private shown = true;

  constructor(private opts: { onBuild: (z: number) => void; onClose: () => void }) {
    const el = document.createElement('section');
    el.className = 'at-page';
    el.hidden = true;
    el.setAttribute('aria-label', 'An atom in the Atlas');
    el.innerHTML = `
      <div class="ap-tabs"></div>
      <div class="ap-panel" role="tabpanel"></div>`;
    this.el = el;
    this.panel = el.querySelector('.ap-panel')!;
    this.tabs = createTabs(TABS, { active: this.tab, label: 'About this atom', onChange: (id) => { this.tab = id as Tab; this.render(); } });
    el.querySelector('.ap-tabs')!.append(this.tabs.el);
    this.view.type = 'button';
    this.view.className = 'ov-view';
    this.view.innerHTML = `${icon('fullscreen', { size: 18 })}<span>View</span>`;
    this.view.onclick = () => {
      if (this.current != null) this.view.dispatchEvent(new CustomEvent('atomos:view3d', { bubbles: true, detail: { z: this.current } }));
    };
    this.build.type = 'button';
    this.build.className = 'foot-card ap-build';
    this.foot.className = 'ap-foot';
    this.foot.append(this.build);
    this.build.onclick = () => {
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
    this.told();
  }

  /** The dock shows the atom open here (shell.ts listens). */
  private told(): void {
    window.dispatchEvent(new Event('atomos:nav'));
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
    this.view.setAttribute('aria-label', `View ${e.name} in 3D, full screen`);
    this.paintBuild(e);
    this.tabs.select(this.tab, false);
    this.render();
    this.told();
  }

  /** The one way into play: its Build page in Collect, with how much of the atom is built
   *  (stable and fleeting together), or what opens it while the atom's period is shut. */
  private paintBuild(e: Element): void {
    const b = this.build;
    const lock = rowLockNote(e.z);
    b.disabled = Boolean(lock);
    if (lock) {
      b.innerHTML = `<span class="foot-card-ico">${icon('lock', { size: 40 })}</span><span class="foot-card-text"><b>View in Collect</b><small>${esc(lock)}</small></span>`;
      return;
    }
    const save = loadSave();
    const segs = segmentsOf(e.z, save), fleeting = fleetingCount(e.z, save);
    const total = segs.length + fleeting.total;
    const pct = total ? Math.round(((segs.filter((s) => s.done).length + fleeting.built) / total) * 100) : 0;
    b.innerHTML = `<span class="foot-card-ico">${icon('build', { size: 40 })}</span><span class="foot-card-text"><b>View in Collect</b></span><span class="foot-card-pct">${pct}%</span><span class="foot-card-go">${icon('chevron-right', { size: 22 })}</span>`;
  }

  private render(): void {
    if (this.current == null || !this.shown) return;
    const e = elementAt(this.current);
    const save = loadSave();
    this.state.hiddenShapes = (Object.keys(SHAPE_AT) as OrbitalShape[]).filter((l) => !orbitalShapeUnlocked(l, save));
    const label = TABS.find((t) => t.id === this.tab)!.label;
    this.panel.innerHTML = `<div class="atom-page">${tabHTML(e, this.tab, save.settings.unlockAll || Boolean(save.built[e.z]), save)}</div>`;
    mountInfoPage(this.panel, this.state);
    if (this.tab === 'overview') {
      this.panel.querySelector('.ov-stats')?.append(this.view);
      this.panel.firstElementChild!.append(this.foot);
    }
    this.panel.firstElementChild!.append(this.guide);
    this.panel.scrollTop = 0;
    this.panel.setAttribute('aria-label', label);
  }
}
