// The gallery screen: the vitrine of all 118 atoms and the loupe over one of
// them, wired to the page. The atom screen's View has tabs: the 3D model, with
// a few white captions round the atom, then the element's science as pages.
// Each page ends with a "How to read this" button that opens its guide.

import type { AtomLit } from './atom';
import { CLOUD_RINGS, ELEMENTS, MAX_Z, elementAt, type Element } from './data';
import { NUCLEUS_RINGS } from './nucleus';
import type { OrbitalShape } from '../core/save';
import { Detail } from './detail';
import { Gallery } from './gallery';
import { tabHTML, TABS, type ViewTab } from './info';
import { guideHTML } from './guide';
import { icon } from '../ui/icons';
import { atomSheetHTML } from './atomsheet';
import { fullScreen, type FullScreen } from './fullscreen';
import { createCallout, createSegments, createTabs, iconButton, nextButton, swipeToDismiss, type Segments, type Tabs } from '../ui/components';
import { ISO_FILTERS, STRUCTURE_VIEWS } from './visuals';
import { createAtomBar, type AtomBar } from './atombar';
import { isLayoutId, LAYOUT_STORY, LAYOUTS, type LayoutId } from './layouts';
import { setScienceHandler, setScienceOpen } from '../ui/science';
import { closeModal, openModal } from '../ui/modal';
import { loadSave, writeSave, type SaveData } from '../core/save';
import { atomBuilt, fleetingTotal, atomProgress, rowSpan, orbitalShapeUnlocked, rowOf, rowOpen, SHAPE_AT, stepState } from '../core/progress';
import { createElementList, type ElementList } from '../ui/elementlist';
import { nextLabel, nextStep, openAtom, openStep, type NextStep } from '../core/next';
import { firstTimeLine } from '../ui/nu';
import { isUnlocked, unlockPuzzle, type UnlockId } from '../core/unlocks';
import { PUZZLES, puzzleIcon } from '../puzzles/catalog';
import { playUnlock } from '../puzzles/unlock';
import { isLookId, lensUnlock, lookOf, lookUnlock, LOOKS, type LookId } from './looks';
import { atomThumb } from './thumbs';
import { fleetingOpen, periodNeed, periodSentence, rowLockNote } from './locks';
import { progressHtml } from '../ui/modebar';

type GalleryMode = 'collection' | 'map' | 'details';

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
  /** The Up next card, floating at the foot of the Collection list. */
  private upNext = Object.assign(createCallout({ kicker: '', title: '', pic: '', className: 'ui-callout--float up-next' }), { hidden: true });
  /** The Up next step swiped away, by key: it comes back once the next step changes. */
  private upNextGone: string | null = null;
  private tab: ViewTab = 'model';
  /** The Info page last open, kept while View shows the 3D atom. */
  private page: Exclude<ViewTab, 'model'> = 'overview';
  private isoFilter = 'all';
  private structView = 'blueprint';
  private layoutId: LayoutId = (() => {
    const saved = localStorage.getItem('atomos.gallery.layout');
    return isLayoutId(saved) ? saved : 'spiral';
  })();
  /** How the tiles are colored: the block strip, or one of the looks Glyph opens. */
  private look: LookId = (() => {
    const saved = localStorage.getItem('atomos.gallery.look');
    return isLookId(saved) ? saved : 'block';
  })();
  /** The 3D tab shows the nucleus up close instead of the whole atom (once Glyph opens it). */
  private nucleusOn = false;
  /** Orbital kinds whose shapes Glyph has not discovered yet. */
  private hiddenShapes: OrbitalShape[] = [];
  /** The gallery shows the Collection (every atom with its progress, the default), the atoms
   *  on a map, or every element in a sortable Details table. */
  private mode: GalleryMode = (() => {
    const saved = localStorage.getItem('atomos.gallery.mode');
    return saved === 'map' || saved === 'details' ? saved : 'collection';
  })();
  /** True when a panel covers the map, so its render loop can rest. */
  private get covered(): boolean { return this.mode !== 'map'; }
  private list: ElementList | null = null;
  private collection: ElementList | null = null;
  private modes: Segments | null = null;
  private rings = localStorage.getItem('atomos.gallery.rings') !== 'off';
  private tabs!: Tabs;
  private bar!: AtomBar;
  private full!: FullScreen;

  constructor(private handlers: GalleryHandlers) {
    this.gallery = new Gallery($('gal'), $('gal-labels'));
    this.detail = new Detail($('loupe'), { variant: 'view', hud: $('loupe-explorer') });
    swipeToDismiss(this.upNext, () => { this.upNextGone = this.upNext.dataset.key ?? null; this.upNext.hidden = true; });
    this.gallery.setReducedMotion(this.save.settings.reducedMotion);
    this.detail.setReducedMotion(this.save.settings.reducedMotion);
    this.buildControls();
    this.refreshCollected();
    this.gallery.setLayout(this.layoutId, false);
    this.detail.setRings(this.rings);
    this.gallery.onPick = (e) => this.pick(e.z);
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
    this.gallery.setLocked((z) => rowLockNote(z, this.save));
    this.collection?.refresh();
    this.paintGates();
    // A part solved while away lights up when the atom is next on screen.
    if (this.current) this.detail.setLit(this.litOf(this.current.z), true);
    // Glyph discovers the p, d and f shapes (on the Build pages of B, Sc and Ce); the Structure page's 2D shapes keep the secret.
    this.hiddenShapes = (Object.keys(SHAPE_AT) as OrbitalShape[]).filter((l) => !orbitalShapeUnlocked(l, save));
    this.paintOverall();
    this.paintUpNext();
    if (this.current && !$('loupe-screen').hidden) this.paintViewNext();
    this.list?.refresh();
    // The Isotopes page shows what is built and what has decayed.
    if (this.tab === 'isotopes') this.renderPanel();
  }

  /** The whole collection's progress, beside the views: every atom's share built, averaged. */
  private paintOverall(): void {
    const save = this.save;
    const main = ELEMENTS.reduce((t, e) => t + atomProgress(e.z, save), 0) / MAX_Z;
    const n = Math.round(main * 100);
    // Fleeting isotopes join the count once they are open (any atom built).
    const f = fleetingOpen(save) ? fleetingTotal(save) : null;
    $('gal-prog').innerHTML = progressHtml(main, f?.total ? { label: 'fleeting', pct: f.built / f.total } : null, false);
    $('gal-prog').setAttribute('aria-label', `Collection ${n}% built${f ? `; ${f.built} of ${f.total} fleeting isotopes` : ''}`);
  }

  /** Whether this atom's row is not open yet (two thirds of the row above unbuilt). It stays
   *  viewable; only Build waits. */
  private buildLocked(z: number): boolean {
    return !rowOpen(rowOf(z), this.save);
  }

  /** Parts of an atom in color: each turns from pale gray once its Build puzzle is solved. */
  private litOf(z: number): AtomLit {
    return { nucleus: stepState(this.save, z, 'nucleus').done, electrons: stepState(this.save, z, 'shells').done ? z : 0 };
  }

  private collected(z: number): boolean {
    return this.save.settings.unlockAll || Boolean(this.save.built[z]);
  }

  private buildControls(): void {
    $('look-chip').innerHTML = `${icon('paint', { size: 18 })}<span>Color</span>`;
    $('look-chip').onclick = () => this.openLooks();
    // Three views in the row under the header, styled like View/Build; under Map, a row at the
    // bottom picks the arrangement (the lenses).
    this.modes = createSegments([
      { id: 'collection', label: 'Collection' },
      { id: 'map', label: 'Map' },
      { id: 'details', label: 'Details' },
    ], {
      label: 'Gallery view',
      active: this.mode,
      onChange: (id) => {
        if (id === 'map') this.setLayout(this.layoutId);
        else this.setMode(id as GalleryMode);
      },
    });
    $('gal-mode-seg').append(this.modes.el);
    const lenses = $('lens-switch');
    lenses.innerHTML = LAYOUTS.map((l) => `<button data-id="${l.id}">${l.label}</button>`).join('');
    lenses.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.setLayout(b.dataset.id as LayoutId)));
    // Bottom right: the nucleus up close (opened with Glyph) and back.
    $('style-switch').innerHTML = `<div class="tool-group"><button class="tool-chip" id="nucleus-chip"></button></div>`;
    this.detail.onDive = (text) => {
      const r = $('dive-readout');
      r.classList.toggle('on', Boolean(text));
      if (text) r.textContent = text;
    };
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
    this.bar = createAtomBar({ onChange: (z) => this.open(elementAt(z)), locked: (z) => this.buildLocked(z) });
    $('loupe-screen').append(this.bar.el);
    // View's tabs: the model, then the element's science as pages.
    // Info's tabs: the element's pages (View is the 3D atom alone, with no tabs).
    this.tabs = createTabs(TABS, { active: this.page, label: 'About this element', onChange: (id) => this.setTab(id as ViewTab) });
    this.tabs.el.setAttribute('aria-controls', 'atom-panel');
    $('atom-tabs').append(this.tabs.el);
    $('atom-tabs').hidden = this.tab === 'model';
    this.bindTabSwipe();
  }

  /** Over the 3D atom: the microscope (top left) opens what the corners used to show; Play/Pause
   *  and full screen (top right), the frame rate under them, then the touch shortcuts. */
  private buildHud(): void {
    const sci = iconButton({ icon: icon('microscope'), label: 'About this atom: electrons, nucleus and isotopes', className: 'ui-icon-btn--ghost lh-btn', onClick: () => this.openAtomSheet() });
    $('loupe-tl').append(sci);
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
      full.innerHTML = icon(on ? 'fullscreen-exit' : 'fullscreen');
      full.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
      full.title = on ? 'Leave full screen' : 'Full screen';
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
        ['Swipe ↕', 'Orbitals'], ['Swipe ↔', 'Focus'], ['Pinch', 'Zoom'], ['Twist', 'Colors'], ['Two fingers', 'Turn'], ['Double-tap', 'Solo / All'],
      ])}${list('for-mouse', [
        ['Wheel', 'Orbitals'], ['Drag ↕ ↔', 'Orbitals · Focus'], ['Shift + wheel', 'Focus'], ['Ctrl + wheel', 'Zoom'], ['Double-click', 'Solo / All'],
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

  /** The microscope's sheet: the configuration and its counts, the nucleus, the isotopes. */
  private openAtomSheet(): void {
    const e = this.current;
    if (!e) return;
    this.full.exit();
    const lit = this.litOf(e.z);
    openModal(atomSheetHTML(e, { nucleus: lit.nucleus, electrons: lit.electrons > 0 }));
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

  private setLayout(id: LayoutId): void {
    const gate = lensUnlock(id);
    if (gate && !this.opened(gate)) {
      const l = LAYOUTS.find((x) => x.id === id)!;
      this.offerUnlock(gate, `The ${l.label} lens`, l.note, () => this.setLayout(id));
      return;
    }
    const animate = !this.covered && !this.save.settings.reducedMotion;
    this.layoutId = id;
    localStorage.setItem('atomos.gallery.layout', id);
    this.gallery.setLayout(id, animate);
    this.setMode('map');
  }

  private opened(id: UnlockId | null): boolean {
    return !id || isUnlocked(id, this.save);
  }

  /** A locked lens or look: what it is, which puzzle opens it, and an Unlock button. */
  private offerUnlock(id: UnlockId, title: string, what: string, then: () => void): void {
    const game = PUZZLES.find((p) => p.id === unlockPuzzle(id))?.name ?? 'Glyph';
    const sheet = openModal(`<h2>${title}</h2>
      <div class="gate-sheet">
        <p class="gate-what">${what}</p>
        <p class="gate-why">${icon('lock', { size: 20 })}<span>Locked. Solve a ${game} puzzle to open it.</span></p>
        <button class="primary gate-go">${icon('unlock', { size: 22 })}<span>Unlock</span></button>
      </div>`);
    sheet.querySelector<HTMLButtonElement>('.gate-go')!.onclick = async () => {
      closeModal();
      const won = await playUnlock(id, { title, note: `${title} is open: find it ${id.startsWith('lens:') ? 'under the gallery' : 'under Color, top left'}.` });
      if (won) { this.save = loadSave(); then(); }
    };
  }

  /** Locks on the lens buttons and the look chip, re-read after any puzzle is solved. */
  private paintGates(): void {
    $('lens-switch').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const locked = !this.opened(lensUnlock(b.dataset.id as LayoutId));
      b.classList.toggle('is-locked', locked);
      b.querySelector('.seg-lock')?.remove();
      if (locked) b.insertAdjacentHTML('beforeend', `<span class="seg-lock" aria-label=", locked">${icon('lock', { size: 14 })}</span>`);
    });
    // A look or lens chosen before a reset can be locked again: fall back to an open one.
    if (!this.opened(lookUnlock(this.look))) this.look = 'block';
    if (!this.opened(lensUnlock(this.layoutId))) { this.layoutId = 'spiral'; this.gallery.setLayout('spiral', false); }
    if (this.nucleusOn && !this.opened('nucleus-view')) this.setNucleus(false);
    else this.paintNucleus();
    this.applyLook();
  }

  private setLook(id: LookId): void {
    this.look = id;
    try { localStorage.setItem('atomos.gallery.look', id); } catch { /* storage off: the look just resets */ }
    this.applyLook();
  }

  /** Color the tiles, and show the chip and its legend. */
  private applyLook(): void {
    const look = lookOf(this.look);
    this.gallery.setLook(look.value ?? null);
    $('look-chip').querySelector('span')!.textContent = look.id === 'block' ? 'Color' : look.label;
    const legend = $('look-legend');
    legend.hidden = look.id === 'block';
    legend.innerHTML = look.id === 'state'
      ? ['solid', 'liquid', 'gas'].map((c) => `<span class="lk-key"><i class="lk-sw lk-${c}"></i>${c[0].toUpperCase()}${c.slice(1)}</span>`).join('')
      : `<span>${look.low ?? ''}</span><i class="lk-ramp"></i><span>${look.high ?? ''}</span>`;
  }

  /** The look picker: every way to color the tiles, the locked ones with an Unlock button. */
  private openLooks(): void {
    const rows = LOOKS.map((l) => {
      const locked = !this.opened(lookUnlock(l.id));
      return `<button class="look-row${locked ? ' is-locked' : ''}" data-id="${l.id}" aria-pressed="${l.id === this.look}">
        <span class="look-main"><b>${l.label}</b><span>${l.blurb}</span></span>
        ${locked ? `<span class="look-lock">${icon('lock', { size: 18 })}Unlock</span>` : l.id === this.look ? `<span class="look-on">${icon('check', { size: 20 })}</span>` : ''}
      </button>`;
    }).join('');
    const sheet = openModal(`<h2>Color the tiles by</h2><p class="look-intro">Each new way is opened by solving a Glyph puzzle.</p><div class="look-list">${rows}</div>`);
    sheet.querySelectorAll<HTMLButtonElement>('.look-row').forEach((b) => (b.onclick = () => {
      const l = lookOf(b.dataset.id as LookId);
      const gate = lookUnlock(l.id);
      if (gate && !this.opened(gate)) { this.offerUnlock(gate, `The ${l.label} look`, l.blurb, () => this.setLook(l.id)); return; }
      closeModal();
      this.setLook(l.id);
    }));
  }

  /** Switch between the Collection, the map and the Details table. */
  private setMode(mode: GalleryMode): void {
    const was = this.covered;
    this.mode = mode;
    try { localStorage.setItem('atomos.gallery.mode', mode); } catch { /* storage off: the choice just resets */ }
    this.paintDetails();
    this.sayLookLine();
    if (!$('gallery-screen').hidden && $('loupe-screen').hidden) {
      if (this.covered) this.gallery.stop();
      else if (was) this.gallery.start();
    }
    this.registerScience();
  }

  /** The arrangement buttons, the note under them, and the panel that covers the map. */
  private paintDetails(): void {
    this.modes?.select(this.mode);
    $('lens-switch').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === this.layoutId)));
    $('lens-switch').hidden = this.mode !== 'map';
    $('layout-note').textContent = this.mode === 'details' ? 'Every element in one table: tap a heading to sort, a row to open it'
      : this.mode === 'collection' ? 'Every atom and how far it is built: tap one to open it'
      : LAYOUTS.find((l) => l.id === this.layoutId)!.note;
    $('gallery-screen').classList.toggle('is-details', this.mode === 'details');
    $('gallery-screen').classList.toggle('is-collection', this.mode === 'collection');
    $('gallery-screen').classList.toggle('is-map', this.mode === 'map');
    $('gal-details').hidden = this.mode !== 'details';
    $('gal-collection').hidden = this.mode !== 'collection';
    if (this.mode === 'details' && !this.list) {
      this.list = createElementList({
        variant: 'table',
        onPick: (z) => this.pick(z),
        locked: (z) => this.buildLocked(z),
        storageKey: 'atomos.details.sort',
      });
      $('gal-details').append(this.list.el);
    }
    if (this.mode === 'collection' && !this.collection) {
      this.collection = createElementList({
        // A row opens the atom's Build page, where its progress is.
        onPick: (z) => this.handlers.onBuild(z),
        locked: (z) => this.buildLocked(z),
        storageKey: 'atomos.collection.sort',
        thumbs: (z) => atomThumb(z, this.litOf(z)),
        fleetingTotal: true,
      });
      $('gal-collection').append(this.collection.el, this.upNext);
      this.paintUpNext();
    }
  }

  /** The Up next card above the Collection: the one next thing to do (nextStep), with the Next
   *  button. It doubles as Continue for a returning player: a half-done puzzle comes first. */
  private paintUpNext(): void {
    const step = nextStep(this.save);
    const card = this.upNext;
    card.hidden = !step;
    if (!step) { card.replaceChildren(); return; }
    const key = `${step.kind}/${step.z}/${step.stage}`;
    // Swiped away: it stays away until there is a different next step.
    if (this.upNextGone === key) { card.hidden = true; return; }
    if (card.dataset.key !== key) {
      card.dataset.key = key;
      // Two lines: "Up next: Quanta" over "Promethium's electrons", the game's icon on the left.
      const resume = step.kind === 'resume';
      card.querySelector('small')!.textContent = `${resume ? 'Continue' : 'Up next'}: ${step.gameName}`;
      card.querySelector('b')!.textContent = resume ? step.label.replace(/^Resume [^·]*·\s*/, '') : step.label;
      card.querySelector<HTMLElement>('.ui-callout-pic')!.innerHTML = puzzleIcon(step.game, 32);
      card.querySelector('.ui-callout-acts')!.replaceChildren(nextButton({ label: resume ? 'Resume' : 'Play', compact: true, landKey: 'gallery-upnext', onClick: () => openStep(step) }));
    }
    this.setUpNextShown(true);
  }

  /** Nu's line the first time a Glyph look is open: said over the Collection, the first time it
   *  is on screen afterwards. */
  private sayLookLine(): void {
    if (this.mode !== 'collection' || !this.collection || $('gallery-screen').hidden || !$('loupe-screen').hidden) return;
    if (!Object.keys(this.save.unlocks).some((id) => id.startsWith('look:'))) return;
    firstTimeLine('first-glyph', 'A new way to color the table is ready in the Gallery. Find it under Color on the Map.', this.collection.el);
  }

  /** Only one Next button may show at once: the card stands aside under the atom view or a sheet. */
  private setUpNextShown(on: boolean): void {
    this.upNext.classList.toggle('is-away', !on || !$('loupe-screen').hidden);
  }

  /** Run the map's render loop, unless a panel covers it. */
  private startMap(): void {
    if (!this.covered) this.gallery.start();
  }

  private hover(e: Element | null): void {
    const tag = $('gal-hover');
    tag.hidden = !e;
    if (e) tag.textContent = `${e.z} ${e.name}${this.collected(e.z) ? '' : ' · not yet collected'}`;
  }

  /** An atom tapped in the Collection, Map or Details: one still to build opens Build, a built
   *  one opens View, and one whose period is shut says what opens it. */
  private pick(z: number): void {
    if (this.buildLocked(z)) { this.offerPeriod(z); return; }
    openAtom(z);
  }

  /** A locked atom: which period opens it, a way to the atom that helps, and a look at this one. */
  private offerPeriod(z: number): void {
    const e = elementAt(z);
    const [first, last] = rowSpan(rowOf(z) - 1);
    let target = first;
    for (let a = first; a <= last; a++) if (!atomBuilt(a, this.save)) { target = a; break; }
    const step = nextStep(this.save, target);
    const sheet = openModal(`<h2>${e.name}</h2>
      <div class="gate-sheet">
        <p class="gate-why">${icon('lock', { size: 20 })}<span>${periodSentence(z, this.save) ?? ''}</span></p>
        <div class="gate-next"></div>
        <button class="secondary gate-look">${icon('mode-view', { size: 20 })}<span>Look at ${e.name.toLowerCase()}</span></button>
      </div>`, () => this.setUpNextShown(true));
    // The first time a locked period is tapped, Nu says what opens it instead of the plain line.
    const why = sheet.querySelector<HTMLElement>('.gate-why')!;
    const p = periodNeed(z, this.save);
    const said = p && firstTimeLine('first-locked-period', `Build ${p.more} more atom${p.more === 1 ? '' : 's'} in Period ${p.period - 1} to open Period ${p.period}.`, why);
    if (said) {
      why.style.display = 'none';
      new MutationObserver((_, o) => { if (!said.isConnected) { why.style.display = ''; o.disconnect(); } }).observe(why.parentElement!, { childList: true });
    }
    if (step) {
      this.setUpNextShown(false);
      sheet.querySelector('.gate-next')!.append(nextButton({ label: nextLabel(step), landKey: 'period-sheet', onClick: () => { closeModal(); openStep(step); } }));
    }
    sheet.querySelector<HTMLButtonElement>('.gate-look')!.onclick = () => { closeModal(); this.open(e); };
  }

  private open(e: Element): void {
    const first = !this.current;
    this.current = e;
    this.gallery.select(e.z);
    this.detail.show(e, !first);
    this.detail.setLit(this.litOf(e.z));
    this.paintNucleus();
    this.bar.set(e.z);
    this.renderPanel();
    const screen = $('loupe-screen');
    if (screen.hidden) {
      screen.hidden = false;
      this.gallery.stop();
      if (this.tab === 'model') this.detail.start();
      requestAnimationFrame(() => { screen.classList.add('in'); this.tabs.select(this.page); });
    }
    this.registerScience();
    this.paintViewNext();
    this.setUpNextShown(false);
    this.handlers.onLoupe?.(e.z);
  }

  /** On an atom still to build (in an open period), a Next button to build it. */
  private paintViewNext(): void {
    const slot = $('view-next');
    const z = this.current?.z;
    const step = z && !atomBuilt(z, this.save) && !this.buildLocked(z) ? nextStep(this.save, z) : null;
    slot.replaceChildren();
    slot.hidden = !step;
    $('loupe-screen').classList.toggle('has-next', Boolean(step));
    if (step) slot.append(nextButton({ label: step.kind === 'resume' ? step.label : `Build ${elementAt(step.z).name.toLowerCase()}`, compact: true, landKey: 'atom-view', onClick: () => openStep(step) }));
  }

  /** The microscope: the arrangement's story on the map. In the atom view each page has its own
   *  guide button at its foot instead, so the row's microscope stands down there. */
  private registerScience(): void {
    if ($('gallery-screen').hidden) return;
    if ((!$('loupe-screen').hidden && this.current) || this.covered) setScienceHandler(null);
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

  /** Open the loupe on an element, from the app shell: View (the 3D atom) or Info (its pages). */
  openAtom(z: number, mode: 'view' | 'info' = 'view'): void {
    const tab: ViewTab = mode === 'info' ? this.page : 'model';
    if (tab !== this.tab) this.setTab(tab);
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
    if (this.current) this.gallery.focus(this.current.z);
    this.startMap();
    window.setTimeout(() => { screen.hidden = true; this.registerScience(); this.paintUpNext(); }, 220);
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
  }

  /** The open page, for the current element; the model needs no page. */
  private renderPanel(): void {
    if (!this.current || this.tab === 'model') return;
    const panel = $('atom-panel');
    const label = TABS.find((t) => t.id === this.tab)!.label.toLowerCase();
    panel.innerHTML = `<div class="atom-page">${tabHTML(this.current, this.tab, this.collected(this.current.z), this.save)}`
      + `<div class="page-guide"><button type="button" class="guide-btn" id="guide-btn">${icon('microscope')}<span><b>How to read this</b><small>A guide to the ${label} page, and more context</small></span></button></div></div>`;
    $('guide-btn').onclick = () => this.openGuide();
    this.mountIsotopeFilter();
    // The first time fleeting isotopes are open and on screen, Nu says what they are.
    const fleeting = panel.querySelector('.icl-fleeting');
    if (fleeting && fleetingOpen(this.save) && !$('loupe-screen').hidden && !$('gallery-screen').hidden) firstTimeLine('first-fleeting', 'Fleeting isotopes vanish in under a year. Pick any game to build one; shorter lives make harder boards.', fleeting);
    this.mountStructureSwitch();
    panel.scrollTop = 0;
    panel.setAttribute('aria-label', TABS.find((t) => t.id === this.tab)!.label);
  }

  /** The structure page's ways to see the atom: the blueprint, the shells, the orbitals with their shapes. */
  private mountStructureSwitch(): void {
    const slot = document.getElementById('struct-switch');
    if (!slot) return;
    const views = [...document.querySelectorAll<HTMLElement>('.st-view')];
    const apply = (id: string) => {
      this.structView = id;
      for (const v of views) v.hidden = v.dataset.view !== id;
    };
    if (!STRUCTURE_VIEWS.some((v) => v.id === this.structView)) this.structView = 'orbitals';
    const seg = createSegments(STRUCTURE_VIEWS, { active: this.structView, label: 'How to see the structure', onChange: apply });
    slot.append(seg.el);
    // Orbitals' Details: each orbital's name, each subshell's count and the notes; remembered.
    const details = document.getElementById('om-details') as HTMLInputElement | null;
    if (details) {
      const map = document.querySelector<HTMLElement>('.om')!;
      const paint = () => { map.classList.toggle('is-detailed', details.checked); document.querySelector('.om-notes')?.toggleAttribute('hidden', !details.checked); };
      try { details.checked = localStorage.getItem('atomos.orbitals.details') === '1'; } catch { /* storage off */ }
      details.onchange = () => { try { localStorage.setItem('atomos.orbitals.details', details.checked ? '1' : '0'); } catch { /* storage off */ } paint(); };
      paint();
    }
    // The 2D shapes keep the same secret as 3D Shapes: a kind Glyph has not found yet shows a "?".
    const hidden = new Set<string>(this.hiddenShapes);
    const kinds = new Set<string>();
    document.querySelectorAll<HTMLElement>('.os-glyph[data-l]').forEach((g) => {
      const off = hidden.has(g.dataset.l!);
      g.classList.toggle('is-hidden', off);
      if (off) kinds.add(g.dataset.l!);
    });
    const note = document.querySelector<HTMLElement>('.os-hidden-note');
    if (note && kinds.size) {
      const ls = [...kinds] as OrbitalShape[];
      const and = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
      note.hidden = false;
      note.textContent = `The ${and(ls)} shapes are still undiscovered. Find them with Glyph on ${and(ls.map((l) => elementAt(SHAPE_AT[l]).name.toLowerCase()))}.`;
    }
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
    // Up and down walk the 3D atom's orbitals.
    if (this.tab === 'model' && this.detail.key(ev)) return;
    if (ev.key === 'ArrowRight') this.step(1);
    else if (ev.key === 'ArrowLeft') this.step(-1);
    else if (ev.key === 'Escape') { if (this.full.on) this.full.exit(); else this.close(); }
  }

  /** Show the gallery screen (after the game hands back). */
  show(): void {
    $('gallery-screen').hidden = false;
    this.refreshCollected();
    this.registerScience();
    this.sayLookLine();
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
