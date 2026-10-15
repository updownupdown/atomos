// The gallery screen: the vitrine of all 118 atoms and the loupe over one of
// them, wired to the page. The atom screen's View has tabs: the 3D model, with
// a few white captions round the atom, then the element's science as pages.
// The microscope at the foot of each Info page opens its guide.

import type { AtomLit } from './atom';
import { CLOUD_RINGS, ELEMENTS, MAX_Z, elementAt, type Element } from './data';
import { NUCLEUS_RINGS } from './nucleus';
import type { OrbitalShape } from '../core/save';
import { Detail } from './detail';
import { Atlas } from './atlas';
import { tabHTML, TABS, type ViewTab } from './info';
import { guideHTML } from './guide';
import { icon } from '../ui/icons';
import { fullScreen, type FullScreen } from './fullscreen';
import { createPills, createTabs, iconButton, type Tabs } from '../ui/components';
import { guideFoot, mountInfoPage, type InfoState } from './infopage';
import { createAtomBar, type AtomBar } from './atombar';
import { setScienceHandler } from '../ui/science';
import { closeModal, openModal } from '../ui/modal';
import { loadSave, writeSave, type SaveData } from '../core/save';
import { atomBuilt, orbitalShapeUnlocked, SHAPE_AT, stepState } from '../core/progress';
import { firstTimeLine } from '../ui/nu';
import { isUnlocked, unlockPuzzle, type UnlockId } from '../core/unlocks';
import { aPuzzle } from './earn';
import { ProgressBox } from './progressbox';
import { playUnlock } from '../puzzles/unlock';
import { fleetingOpen } from './locks';
import { isViewLook, VIEW_LOOKS, type ViewLook } from '../render/rayLooks';
import type { LookId } from './looks';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface GalleryHandlers {
  /** Opens Build mode on an element. */
  onBuild: (z: number) => void;
  /** The loupe opened on an element, or closed (null): the app shell tracks which. */
  onLoupe?: (z: number | null) => void;
  /** View (the 3D atom, full screen) was closed: the shell goes back to Build. */
  onLeaveView?: () => void;
}

export class GalleryApp {
  private save: SaveData = loadSave();
  private detail: Detail;
  /** The Atlas: the maps, Details and the atom pages (atlas.ts). */
  private atlas: Atlas;
  private current: Element | null = null;
  private tab: ViewTab = 'model';
  /** The Info page last open, kept while View shows the 3D atom. */
  private page: Exclude<ViewTab, 'model'> = 'overview';
  /** The Info pages' remembered choices (infopage.ts). */
  private info: InfoState = { isoFilter: 'lasting', structView: 'together', hiddenShapes: [] };
  private guide = guideFoot();
  /** The 3D tab shows the nucleus up close instead of the whole atom (once Glyph opens it). */
  private nucleusOn = false;
  private rings = localStorage.getItem('atomos.gallery.rings') !== 'off';
  private tabs!: Tabs;
  /** Over Info's tabs: the atom's stable and fleeting progress, and Build. */
  private box = new ProgressBox((z) => this.handlers.onBuild(z), 'atom-pbox');
  private bar!: AtomBar;
  private full!: FullScreen;

  constructor(private handlers: GalleryHandlers) {
    this.atlas = new Atlas($('atlas'), { onBuild: (z) => this.handlers.onBuild(z) });
    this.detail = new Detail($('loupe'), { variant: 'view', hud: $('loupe-explorer') });
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
    this.buildControls();
    this.refreshCollected();
    this.detail.setRings(this.rings);
    window.addEventListener('keydown', (ev) => this.key(ev));
    // Build announces each change to an atom's progress.
    window.addEventListener('atomos:progress', () => this.refreshCollected());
    this.registerScience();
  }

  /** Re-read the save: called when the game screen hands back. */
  refreshCollected(): void {
    this.save = loadSave();
    const save = this.save;
    if (this.nucleusOn && !this.opened('nucleus-view')) this.setNucleus(false);
    else this.paintNucleus();
    // A part solved while away lights up when the atom is next on screen.
    if (this.current) this.detail.setLit(this.litOf(this.current.z), true);
    // Glyph discovers the p, d and f shapes (on the Build pages of B, Sc and Ce); the Structure page's 2D shapes keep the secret.
    this.info.hiddenShapes = (Object.keys(SHAPE_AT) as OrbitalShape[]).filter((l) => !orbitalShapeUnlocked(l, save));
    if (this.current) this.box.show(this.current.z, save);
    // The Isotopes page shows what is built and what has decayed.
    if (this.tab === 'isotopes') this.renderPanel();
  }

  /** Parts of an atom in color: each turns from pale gray once its Build puzzle is solved. */
  private litOf(z: number): AtomLit {
    return { nucleus: stepState(this.save, z, 'nucleus').done, electrons: stepState(this.save, z, 'shells').done ? z : 0 };
  }

  private collected(z: number): boolean {
    return this.save.settings.unlockAll || Boolean(this.save.built[z]);
  }

  private buildControls(): void {
    // Bottom right: the nucleus up close (opened with Glyph) and back.
    $('style-switch').innerHTML = `<div class="tool-group"><button class="tool-chip" id="nucleus-chip"></button></div>`;
    this.detail.onDive = (dive) => {
      const r = $('dive-readout');
      r.classList.toggle('on', Boolean(dive));
      if (!dive) return;
      r.querySelector('b')!.textContent = dive.across;
      r.querySelector<HTMLElement>('i')!.style.width = `${dive.barPx.toFixed(1)}px`;
      r.querySelector('small')!.textContent = dive.barLabel;
    };
    $('dive-readout').innerHTML = '<b></b><i></i><small></small>';
    this.detail.onLeaveNucleus = () => this.setNucleus(false);
    $('nucleus-chip').onclick = () => {
      if (!this.opened('nucleus-view')) {
        this.offerUnlock('nucleus-view', 'The nucleus view', 'Zoom a hundred thousand times closer, past the electrons, to every proton and neutron packed in the middle of the atom.', () => this.setNucleus(true));
        return;
      }
      this.setNucleus(!this.nucleusOn);
    };
    // Bottom left: the scale circles, one line per circle with its diameter, and the switch.
    const line = (style: string) => `<svg width="18" height="4" aria-hidden="true"><line x1="1" y1="2" x2="17" y2="2" stroke="currentColor" stroke-width="1.5"${style === 'dashed' ? ' stroke-dasharray="3 2.5"' : ''}/></svg>`;
    const legend = $('scale-legend');
    const rows = (sizes: { d: number; style: string }[], unit: string) => sizes.map((r, i) => `<li>${line(r.style)}<span>${r.d}${i === sizes.length - 1 ? ` ${unit}` : ''}</span></li>`).join('');
    legend.innerHTML = `<ul id="rings-atom">${rows(CLOUD_RINGS.map((r) => ({ d: r.pm * 2, style: r.style })), 'pm')}</ul>`
      + `<ul id="rings-nucleus" hidden>${rows(NUCLEUS_RINGS.map((r) => ({ d: r.fm * 2, style: r.style })), 'fm')}</ul>`
      + `<button class="tool-chip" id="rings-toggle" aria-pressed="${this.rings}"></button>`;
    $('rings-toggle').onclick = () => this.setRings(!this.rings);
    this.buildHud();
    this.paintRingsToggle();
    // The bar: previous, the element (opens the picker), next.
    this.bar = createAtomBar('info');
    $('loupe-screen').append(this.bar.el);
    // View's tabs: the model, then the element's science as pages.
    // Info's tabs: the element's pages (View is the 3D atom alone, with no tabs).
    this.tabs = createTabs(TABS, { active: this.page, label: 'About this element', onChange: (id) => this.setTab(id as ViewTab) });
    this.tabs.el.setAttribute('aria-controls', 'atom-panel');
    $('atom-tabs').append(this.tabs.el);
    // Over the tabs: the atom's progress box, with Build (progressbox.ts, shared with Collect).
    $('atom-box').append(this.box.el);
    $('atom-tabs').hidden = this.tab === 'model';
    this.bindTabSwipe();
  }

  /** Over the 3D atom: the render style (top left); Play/Pause and full screen (top right), the
   *  frame rate under them, then the touch shortcuts. */
  private buildHud(): void {
    $('loupe-tl').append(this.buildLookPicker());
    const play = iconButton({ icon: icon('pause'), label: 'Pause', className: 'ui-icon-btn--ghost lh-btn', onClick: () => this.detail.setPlaying(!this.detail.playing) });
    const full = iconButton({ icon: icon('fullscreen'), label: 'Full screen', className: 'ui-icon-btn--ghost lh-btn lh-full', onClick: () => this.full.toggle() });
    $('loupe-btns').append(play, full);
    this.detail.onPlay = (on) => {
      play.innerHTML = icon(on ? 'pause' : 'play');
      play.setAttribute('aria-label', on ? 'Pause: stay on this orbital' : 'Play: walk through the orbitals');
      play.title = on ? 'Pause' : 'Play';
      play.classList.toggle('is-playing', on);
    };
    this.detail.onPlay(this.detail.playing);
    this.full = fullScreen($('loupe-screen'), (on) => {
      // View opens over the page it came from, like a dialog: an X closes it.
      full.innerHTML = icon(on ? 'close' : 'fullscreen');
      full.setAttribute('aria-label', on ? 'Close View' : 'Full screen');
      full.title = on ? 'Close' : 'Full screen';
      // View is the atom full screen: leaving full screen there is leaving View, back to Build.
      if (!on && document.body.dataset.screen === 'atom-view') this.handlers.onLeaveView?.();
    });
    const fps = $('loupe-fps');
    this.detail.onFps = (v) => {
      const t = `${Math.round(v)} fps`;
      if (fps.textContent !== t) fps.textContent = t;
      fps.classList.toggle('is-slow', v < 50);
    };
    // The shortcuts, folded away under a chevron; tapping the open list folds it again.
    const list = (cls: string, rows: [string, string][]) => `<ul class="lh-keylist ${cls}">${rows.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('')}</ul>`;
    const keys = $('loupe-keys');
    keys.innerHTML = `<button type="button" class="lh-keys-toggle" aria-expanded="false" aria-controls="loupe-keylists">Shortcuts${icon('chevron-down', { size: 14 })}</button>`
      + `<div id="loupe-keylists" class="lh-keylists" hidden>${list('for-touch', [
        ['Swipe ↕', 'Orbitals'], ['Swipe ↔', 'Focus'], ['Pinch', 'Zoom'], ['Twist', 'Colors'], ['Two fingers', 'Rotate'], ['Double-tap', 'Toggle focus'],
      ])}${list('for-mouse', [
        ['Wheel', 'Orbitals'], ['Drag ↕ ↔', 'Orbitals · Focus'], ['Shift + wheel', 'Focus'], ['Ctrl + wheel', 'Zoom'], ['Double-click', 'Toggle focus'],
      ])}</div>`;
    const toggle = keys.querySelector<HTMLButtonElement>('.lh-keys-toggle')!;
    const lists = $('loupe-keylists');
    const setOpen = (open: boolean) => {
      lists.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      keys.classList.toggle('is-open', open);
    };
    toggle.onclick = () => setOpen(Boolean(lists.hidden));
    lists.onclick = () => setOpen(false);
  }

  /** The render style picker: the five styles (render/rayLooks.ts) as a stack of pills at the
   *  top left, the one on show in the accent. The choice is kept in localStorage. */
  private buildLookPicker(): HTMLElement {
    const KEY = 'atomos.view.look';
    let look: ViewLook = 'particles';
    try { const v = localStorage.getItem(KEY); if (isViewLook(v)) look = v; } catch { /* storage off: particles */ }
    const pills = createPills(VIEW_LOOKS.map((l) => ({ id: l.id, label: l.label })), {
      active: look,
      label: 'Render style',
      onChange: (id) => {
        look = id as ViewLook;
        this.detail.setLook(look);
        try { localStorage.setItem(KEY, look); } catch { /* storage off: the choice just resets */ }
      },
    });
    pills.el.classList.add('lh-looks');
    // Arrow keys walk the pills and stay out of the atom's own arrow keys.
    pills.el.addEventListener('keydown', (ev) => { if (ev.key.startsWith('Arrow')) ev.stopPropagation(); });
    this.detail.setLook(look);
    return pills.el;
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

  /** Swap the 3D view between the whole atom and its nucleus up close. */
  private setNucleus(on: boolean): void {
    this.nucleusOn = on;
    this.detail.setNucleus(on, true);
    this.paintNucleus();
  }

  private paintNucleus(): void {
    const chip = $('nucleus-chip');
    const open = this.opened('nucleus-view');
    chip.setAttribute('aria-pressed', String(this.nucleusOn));
    chip.innerHTML = !open
      ? `${icon('lock', { size: 18 })}<span>Nucleus</span>`
      : this.nucleusOn ? `${icon('atom', { size: 18 })}<span>Whole atom</span>` : `${icon('nucleus', { size: 18 })}<span>Nucleus</span>`;
    chip.setAttribute('aria-label', !open ? 'Nucleus view, locked' : this.nucleusOn ? 'Back to the whole atom' : 'Zoom to the nucleus');
    $('rings-atom').hidden = this.nucleusOn;
    $('rings-nucleus').hidden = !this.nucleusOn;
  }

  private paintRingsToggle(): void {
    const b = $('rings-toggle');
    b.innerHTML = `${icon(this.rings ? 'scale' : 'scale-off', { size: 18 })}<span>Scale</span>`;
    b.setAttribute('aria-pressed', String(this.rings));
    b.setAttribute('aria-label', 'Scale circles');
    $('scale-legend').classList.toggle('off', !this.rings);
  }

  private opened(id: UnlockId | null): boolean {
    return !id || isUnlocked(id, this.save);
  }

  /** A locked lens or look: what it is, which puzzle opens it, and an Unlock button. */
  private offerUnlock(id: UnlockId, title: string, what: string, then: () => void): void {
    const game = aPuzzle(unlockPuzzle(id));
    const sheet = openModal(`<h2>${title}</h2>
      <div class="gate-sheet">
        <p class="gate-what">${what}</p>
        <p class="gate-why">${icon('lock', { size: 20 })}<span>Win ${game} to open it, anywhere in the game, or play one now.</span></p>
        <button class="primary gate-go">${icon('unlock', { size: 22 })}<span>Play</span></button>
      </div>`);
    sheet.querySelector<HTMLButtonElement>('.gate-go')!.onclick = async () => {
      closeModal();
      const won = await playUnlock(id, { title, note: `${title} is open.` });
      if (won) { this.save = loadSave(); then(); }
    };
  }

  private open(e: Element): void {
    const first = !this.current;
    this.current = e;
    this.detail.show(e, !first);
    this.detail.setLit(this.litOf(e.z));
    this.paintNucleus();
    this.bar.set(e.z);
    this.renderPanel();
    if (this.tab === 'model') this.full.pin();
    const screen = $('loupe-screen');
    if (screen.hidden) {
      screen.hidden = false;
      if (this.tab === 'model') this.detail.start();
      requestAnimationFrame(() => { screen.classList.add('in'); this.tabs.select(this.page); });
    }
    this.registerScience();
    this.box.show(e.z, this.save);
    this.handlers.onLoupe?.(e.z);
  }


  /** The microscope: on an atom's Info, the open page's guide; on the 3D atom, nothing; on the
   *  Atlas, whatever the Atlas shows. */
  private registerScience(): void {
    if ($('gallery-screen').hidden) return;
    if (!$('loupe-screen').hidden && this.current) setScienceHandler(this.tab === 'model' ? null : () => this.openGuide(), 'How to read this page');
    else this.atlas.registerScience();
  }

  /** Show an atom in the Atlas, from one of its pages (the shell has switched to the Atlas). */
  /** The atom whose Atlas page is open, if one is. */
  get pageZ(): number | null {
    return this.atlas.page.isOpen ? this.atlas.page.current : null;
  }

  /** Open an atom's Atlas page (the shell has switched to the Atlas). */
  openPage(z: number): void {
    this.atlas.openPage(z);
  }

  /** Close the Atlas page, back to the maps. */
  closePage(): void {
    if (this.atlas.page.isOpen) this.atlas.page.close();
  }

  showInAtlas(z: number, look: LookId | null): void {
    this.atlas.focus(z, look);
  }

  private openGuide(): void {
    if (!this.current || this.tab === 'model') return;
    openModal(guideHTML(this.current, this.tab));
  }

  /** Open the loupe on an element, from the app shell: View (the 3D atom) or Info (its pages). */
  openAtom(z: number, mode: 'view' | 'info' = 'view'): void {
    const tab: ViewTab = mode === 'info' ? this.page : 'model';
    if (tab !== this.tab) this.setTab(tab);
    // View is the 3D atom full screen (pinned in the page, not the browser's full screen).
    if (mode === 'view') this.full.pin(); else if (this.full.on) this.full.exit();
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
    this.full.exit();
    this.detail.stop();
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
    if (tab !== 'model') this.page = tab;
    $('atom-tabs').hidden = tab === 'model';
    const model = tab === 'model';
    $('loupe-screen').classList.toggle('on-page', !model);
    $('atom-panel').hidden = model;
    if (!$('loupe-screen').hidden && !$('gallery-screen').hidden) {
      if (model) this.detail.start(); else this.detail.stop();
    }
    this.renderPanel();
    $('atom-panel').scrollTop = 0;
    this.registerScience();
  }

  /** The open page, for the current element; the model needs no page. */
  private renderPanel(): void {
    if (!this.current || this.tab === 'model') return;
    const panel = $('atom-panel');
    panel.innerHTML = `<div class="atom-page">${tabHTML(this.current, this.tab, this.collected(this.current.z), this.save)}</div>`;
    mountInfoPage(panel, this.info);
    panel.firstElementChild!.append(this.guide);
    // The first time fleeting isotopes are open and on screen, Nu says what they are.
    const fleeting = panel.querySelector('.icl-fleeting');
    if (fleeting && fleetingOpen(this.save) && !$('loupe-screen').hidden && !$('gallery-screen').hidden) firstTimeLine('first-fleeting', 'Fleeting isotopes vanish in under a year. Pick any game to build one; shorter lives make harder boards.', fleeting);
    panel.scrollTop = 0;
    panel.setAttribute('aria-label', TABS.find((t) => t.id === this.tab)!.label);
  }

  private key(ev: KeyboardEvent): void {
    if ($('gallery-screen').hidden || $('loupe-screen').hidden) return;
    if (!$('modal').hidden || document.querySelector('.ui-drawer')) return;
    // Arrow keys on the tab strip move between tabs; elsewhere they step through the elements.
    if ((ev.target as HTMLElement).closest?.('.ui-tabs')) return;
    // Up and down walk the 3D atom's orbitals.
    if (this.tab === 'model' && this.detail.key(ev)) return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
    else if (ev.key === 'Escape') {
      // Handled here: the Build page, back on screen at once after View, must not take it too.
      ev.preventDefault();
      if (this.full.on) this.full.exit(); else this.close();
    }
  }

  /** Show the gallery screen (after the game hands back). */
  show(): void {
    $('gallery-screen').hidden = false;
    this.refreshCollected();
    this.atlas.show();
    this.registerScience();
    if (!$('loupe-screen').hidden && this.tab === 'model') this.detail.start();
  }

  hide(): void {
    if (this.full.on) this.full.exit();
    $('gallery-screen').hidden = true;
    this.atlas.hide();
    this.detail.stop();
  }

  /** Persist a setting change made from the game's settings sheet. */
  syncSettings(): void {
    this.save = loadSave();
    writeSave(this.save);
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
  }
}
