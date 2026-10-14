// The app shell: Home and three sections in the dock at the foot (src/ui/dock.ts), always in
// this order, and the hierarchy beneath them.
//   Home     — where a returning player lands: a jumping point to the sections (src/home).
//   Collect  — one period's atoms and how far each is collected.
//     Atom   — one atom, its Build page (its puzzles) or its Learn page ('info'), opened from
//              Collect (or from Learn); View is its 3D atom, full screen.
//   Learn    — the Atlas: every atom to admire and look up, the maps, Details and atom pages
//              ('gallery').
//   Play     — every game on its own, on any atom; it never builds atoms ('puzzles').
//   Settings — its own screen, from the gear in the header.
// Home has the header (the mark and wordmark, Search, Settings); Learn's and Play's tops keep
// Search and Settings. On those the dock names Home and the three sections. Anywhere in Collect,
// on an atom and in a game there is no header: the dock holds Home's icon, the dropdown of what
// is open (the atom, or the game), which lists the others, and on an atom its Build and Learn.

import { GalleryApp } from './gallery';
import { Collect } from './gallery/collect';
import type { LookId } from './gallery/looks';
import { atomListOpen, openAtomList } from './gallery/atomlist';
import { Dock, type AtomPage, type DockPick, type Section } from './ui/dock';
import { renderHome } from './home/home';
import { closeSheet } from './ui/sheet';
import { gameListOpen, openGameList } from './ui/gamelist';
import { openFinder } from './ui/finder';
import type { Game } from './game';
import type { Playground } from './playground';
import { onSettingsChange, renderSettings } from './ui/settings';
import { renderIconPage } from './ui/iconpage';
import { renderComponentPage } from './ui/componentpage';
import { icon } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { markSvg } from './ui/mark';
import { MODES, type AtomMode } from './ui/modebar';
import { reducedMotion } from './ui/nu';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

import { readPlace, type Screen } from './core/place';
import { setNavigator } from './core/next';
import { loadSave } from './core/save';
export type { Screen };
export type { AtomMode };

const PLACE_KEY = 'atomos.place';

export class AppShell {
  private screen: Screen = 'home';
  private mode: AtomMode = 'view';
  /** The atom the Atom tab shows; the last one looked at or built. */
  private z = 1;
  private gallery: GalleryApp;
  private collect: Collect;
  private game: Game | null = null;
  private playground: Playground | null = null;

  constructor() {
    // Read where the player was before anything below records the gallery as the new place.
    let saved: string | null = null;
    try { saved = localStorage.getItem(PLACE_KEY); } catch { /* storage off: start at the gallery */ }
    this.gallery = new GalleryApp({
      onBuild: (z) => { this.z = z; void this.go('atom', 'build'); },
      onLoupe: (z) => {
        if (z !== null) {
          this.setZ(z);
          // An atom opened over the Atlas is the Atom screen now.
          if (this.screen === 'gallery') this.atomFrom = 'gallery';
          if (this.screen === 'gallery' || this.screen === 'atom') { this.screen = 'atom'; this.setNav('atom', this.mode === 'info' ? 'info' : 'view'); }
        } else if (this.screen === 'atom') {
          // Closed from inside (Escape): back where it was opened, Collect on this atom or the Atlas.
          this.closeAtom();
        }
      },
      // Leaving View's full screen goes back where it was opened: Build, Info, or an Atlas page.
      onLeaveView: () => {
        if (this.screen !== 'atom' || this.mode !== 'view') return;
        const back = this.viewBack;
        this.viewBack = 'build';
        if (back === 'gallery') void this.go('gallery'); else void this.go('atom', back);
      },
    });
    this.collect = new Collect($('collect-screen'), { onOpen: (z) => { this.z = z; void this.go('atom', 'build'); } });
    // The atom in Collect's lens is the dock's atom.
    window.addEventListener('atomos:focus', (ev) => {
      if (this.screen !== 'collect') return;
      this.z = (ev as CustomEvent<{ z: number }>).detail.z;
      this.paintDock();
    });
    // Escape on the Build page: back where the atom was opened.
    document.addEventListener('atomos:close-atom', () => this.closeAtom());
    // An atom page's 3D button: the atom full screen, and back to that page when it closes.
    document.addEventListener('atomos:view3d', (ev) => {
      const { z } = (ev as CustomEvent<{ z: number }>).detail;
      this.viewBack = this.screen === 'atom' ? (this.mode === 'view' ? 'build' : this.mode) : 'gallery';
      this.z = z;
      void this.go('atom', 'view');
    });
    // An atom page's little table or "See in Atlas": the Atlas, with that atom picked.
    document.addEventListener('atomos:atlas', (ev) => {
      const { z, look } = (ev as CustomEvent<{ z: number; look: LookId | null }>).detail;
      this.z = z;
      void this.go('gallery').then(() => this.gallery.showInAtlas(z, look));
    });
    // Top: the mark and wordmark (on Home), Search and Settings. The dock: Home and the three
    // sections and, inside one, the dropdown of what is open and an atom's Build and Learn.
    $('nav-logo').innerHTML = markSvg();
    $('nav-logo').onclick = () => void this.go('home');
    $('nav-search').innerHTML = icon('search');
    $('nav-search').onclick = () => this.search();
    $('nav-settings').innerHTML = icon('settings');
    $('nav-settings').onclick = () => void this.go('settings');
    this.dock = new Dock($('dock'), { onSection: (s, lit) => this.toSection(s, lit), onPick: () => this.openPick(), onPage: (p) => this.toPage(p) });
    // A game or an Atlas page opened or closed from inside its screen.
    window.addEventListener('atomos:nav', () => this.paintDock());
    onSettingsChange(() => {
      this.gallery.syncSettings();
      this.game?.reloadSettings();
    });
    this.setNav('home', 'view');
    // The Next button anywhere opens its step; an atom opens in Build.
    setNavigator({
      openStep: (step) => { this.z = step.z; void this.go('atom', 'build').then(() => this.game?.play(step.z, step.stage)); },
      openAtom: (z) => { this.z = z; void this.go('atom', 'build'); },
    });
    // The two library pages have addresses, so they can be linked and reloaded.
    const routed = () => (location.hash === '#icons' ? 'icons' : location.hash === '#components' ? 'components' : null);
    // Off a library page's address (Back from it): back to Settings, where its link is.
    const route = () => { const r = routed(); if (r) void this.go(r); else if (this.screen === 'icons' || this.screen === 'components') void this.go('settings'); };
    window.addEventListener('hashchange', route);
    if (routed()) route();
    else this.restore(saved);
    this.watchBack();
  }

  /** The system's Back (Android's back gesture, the browser's Back button) steps back through
   *  the app the way the on-screen Back and Escape do, instead of leaving it: one history entry
   *  stands above home whenever the player is anywhere else (another screen, a puzzle, a sheet
   *  over Collect). Popping it takes one step back and, if that isn't home yet, puts the entry
   *  back. At home, with nothing open, Back leaves the app as usual. */
  private watchBack(): void {
    let dropping = false;
    const armed = () => (history.state as { atomos?: number } | null)?.atomos === 1;
    // A library page's address coming or going is the hash's own navigation, not a step back.
    let hash = location.hash;
    const sync = () => {
      hash = location.hash;
      if (dropping) return;
      if (!this.atHome()) { if (!armed()) history.pushState({ atomos: 1 }, ''); }
      else if (armed()) { dropping = true; history.back(); }
    };
    window.addEventListener('popstate', () => {
      if (dropping) { dropping = false; return; }
      if (location.hash !== hash) { hash = location.hash; return; }
      this.stepBack();
      // The step may take a moment (a screen loading, a sheet fading): re-arm after it.
      window.setTimeout(sync, 300);
    });
    this.syncBack = () => window.setTimeout(sync, 0);
    // Sheets, dialogs and the win sheet come and go from anywhere.
    new MutationObserver(() => this.syncBack()).observe(document.body, { childList: true });
    new MutationObserver(() => this.syncBack()).observe($('modal'), { attributes: true, attributeFilter: ['hidden'] });
    this.syncBack();
  }

  private syncBack: () => void = () => {};

  /** Something sits over the screen that Escape closes: a sheet, a dialog, a drawer, the win
   *  sheet or a gate puzzle. */
  private overlayOpen(): boolean {
    return !$('modal').hidden || Boolean(document.querySelector('.win, .ui-confirm, .ui-drawer, .unlock-screen, .sheet-scrim'));
  }

  private atHome(): boolean {
    return this.screen === 'home' && !this.overlayOpen();
  }

  /** One step back, as the on-screen Back would take it. */
  private stepBack(): void {
    const escape = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    // Whatever is open closes first; a puzzle goes back to its list or Build page; an atom's
    // View or Info closes to where it was opened (the gallery answers Escape for those).
    if (this.overlayOpen()) return escape();
    if (this.screen === 'atom' && (this.mode !== 'build' || this.game?.inPuzzle)) return escape();
    if (this.screen === 'puzzles' && this.playground?.inPuzzle) return escape();
    if (this.screen === 'gallery' && this.gallery.pageZ !== null) return this.gallery.closePage();
    if (this.screen === 'icons' || this.screen === 'components') { void this.go('settings'); return; }
    if (this.screen === 'atom') return this.closeAtom();
    if (this.screen !== 'home') void this.go('home');
  }

  /** Where an atom was opened from: the Atlas, or Collect (anything else). Back, Escape and the
   *  atom bar's Back button return there. */
  private atomFrom: 'gallery' | 'collect' = 'collect';
  /** Where View (the 3D atom, full screen) goes back to when it closes. */
  private viewBack: AtomMode | 'gallery' = 'build';

  private closeAtom(): void {
    void this.go(this.atomFrom);
  }

  /** Where the app opens. A player who hasn't built anything yet starts on hydrogen's Build
   *  page; everyone else lands on Home. The last atom and mode are remembered. */
  private restore(raw: string | null): void {
    const save = loadSave();
    if (!Object.keys(save.built).length && !Object.keys(save.steps).length) {
      this.z = 1;
      this.go('atom', 'build').catch(() => void this.go('gallery'));
      return;
    }
    const place = readPlace(raw);
    this.z = place.z;
    this.mode = place.mode;
    void this.go('home');
  }

  private remember(screen: Screen, mode: AtomMode): void {
    try { localStorage.setItem(PLACE_KEY, JSON.stringify({ screen, mode, z: this.z })); } catch { /* not remembered */ }
  }

  get atomZ(): number { return this.z; }
  /** The build screen, once it has been opened; for console checks. */
  get build(): Game | null { return this.game; }

  /** Go to a screen. Between an atom's modes the page slides sideways (a view transition,
   *  where the browser has one and motion is on); anything else switches at once. */
  async go(screen: Screen, mode: AtomMode = this.mode): Promise<void> {
    // View opens over Build full screen, so only Build and Info slide.
    const stepping = this.screen === 'atom' && screen === 'atom' && mode !== this.mode && MODES.includes(mode) && MODES.includes(this.mode);
    const doc = document as Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };
    if (!stepping || !doc.startViewTransition || reducedMotion()) return this.show(screen, mode);
    // View, Build and Info sit side by side: the page slides toward the mode picked. Build loads
    // first, so the old page isn't held while it does.
    if (mode === 'build') await this.loadGame();
    const root = document.documentElement;
    const dir = MODES.indexOf(mode) > MODES.indexOf(this.mode) ? 'next' : 'prev';
    root.dataset.vt = dir;
    const t = doc.startViewTransition(() => this.show(screen, mode));
    await t.finished.catch(() => undefined);
    // A quicker swipe may have started the next slide already; leave its direction be.
    if (root.dataset.vt === dir) delete root.dataset.vt;
  }

  private async loadGame(): Promise<void> {
    if (this.game) return;
    const { Game } = await import('./game');
    const want = this.z;
    this.game = new Game({ onElement: (z) => this.setZ(z), onView: (z) => { this.setZ(z); void this.go('atom', 'view'); }, onInfo: (z) => { this.setZ(z); void this.go('atom', 'info'); } });
    this.z = want;
  }

  private async show(screen: Screen, mode: AtomMode): Promise<void> {
    if (screen === 'puzzles' && !this.playground) {
      const { Playground } = await import('./playground');
      this.playground = new Playground();
    }
    if (screen === 'atom' && mode === 'build') await this.loadGame();
    // Back to Collect from an atom: on that atom's period, centered on it.
    const fromAtom = this.screen === 'atom';
    if (screen === 'atom' && this.screen !== 'atom') this.atomFrom = this.screen === 'gallery' ? 'gallery' : 'collect';
    this.screen = screen;
    this.mode = screen === 'atom' ? mode : this.mode;
    this.setNav(screen, this.mode);

    // Put away whatever is not on screen. The screen that shows re-registers the microscope.
    setScienceHandler(null);
    const showGallery = screen === 'gallery' || (screen === 'atom' && mode !== 'build');
    const showGame = screen === 'atom' && mode === 'build';
    const showHome = screen === 'home';
    const showCollect = screen === 'collect';
    const showPlay = screen === 'puzzles';
    const showSettings = screen === 'settings';
    const showIcons = screen === 'icons';
    const showComponents = screen === 'components';
    if (!showGallery) this.gallery.hide();
    if (!showGame) { this.game?.pause(); $('app').hidden = true; }
    if (!showCollect) this.collect.hide();
    if (!showPlay) this.playground?.hide();
    $('home-screen').hidden = !showHome;
    $('settings-screen').hidden = !showSettings;
    $('icons-screen').hidden = !showIcons;
    $('components-screen').hidden = !showComponents;
    // The library pages are the screens with an address; leaving one drops it.
    if ((!showIcons && location.hash === '#icons') || (!showComponents && location.hash === '#components')) history.replaceState(null, '', location.pathname + location.search);

    if (showGallery) {
      this.gallery.show();
      if (screen === 'atom') this.gallery.openAtom(this.z, mode === 'info' ? 'info' : 'view');
      else this.gallery.closeAtom();
    } else if (showGame) {
      $('app').hidden = false;
      // Switching View to Build on the same atom keeps the puzzle in progress.
      if (this.game!.currentZ !== this.z) this.game!.openElement(this.z);
      this.game!.resume();
    } else if (showHome) {
      renderHome($('home-body'), (to, at) => {
        if (to === 'learn' && at?.z) { this.z = at.z; void this.go('gallery').then(() => this.gallery.openPage(at.z!)); }
        else if (to === 'play' && at?.game) void this.go('puzzles').then(() => this.playground?.open(at.game!));
        else this.toSection(to, false);
      });
      $('home-screen').scrollTop = 0;
    } else if (showCollect) {
      // Collect opens on the dock's atom: the one just left, or the last one looked at.
      this.collect.show(fromAtom || this.collectZ ? this.z : null);
      this.collectZ = true;
    } else if (showPlay) {
      this.playground!.show();
    } else if (showComponents) {
      renderComponentPage($('component-page'), () => void this.go('settings'));
      $('components-screen').scrollTop = 0;
    } else if (showIcons) {
      renderIconPage($('icon-page'), () => void this.go('settings'));
      $('icons-screen').scrollTop = 0;
    } else if (showSettings) {
      renderSettings($('settings-page'));
      $('settings-screen').scrollTop = 0;
    }
  }

  private setZ(z: number): void {
    this.z = z;
    if (document.body.dataset.screen?.startsWith('atom')) this.remember('atom', this.mode);
    this.paintDock();
  }

  private dock: Dock | null = null;

  /** The section the screen belongs to: an atom to the one it was opened from. */
  private section(): Section | null {
    switch (this.screen) {
      case 'home': return 'home';
      case 'collect': return 'collect';
      case 'gallery': return 'learn';
      case 'puzzles': return 'play';
      case 'atom': return this.atomFrom === 'gallery' ? 'learn' : 'collect';
      default: return null;
    }
  }

  /** Collect has been opened, so it reopens on the dock's atom rather than Up next's. */
  private collectZ = false;

  /** The dock: the section lit and, inside it, what is open: anywhere in Collect and on any
   *  atom, the atom with its Build and Learn; in a game, the game. */
  private paintDock(): void {
    if (!this.dock) return;
    let pick: DockPick | null = null;
    let page: AtomPage | null = null;
    if (this.screen === 'atom') { pick = { kind: 'atom', z: this.z }; page = this.mode === 'build' ? 'build' : 'learn'; }
    else if (this.screen === 'collect') pick = { kind: 'atom', z: this.z };
    else if (this.screen === 'gallery' && this.gallery.pageZ !== null) { pick = { kind: 'atom', z: this.gallery.pageZ }; page = 'learn'; }
    else if (this.screen === 'puzzles' && this.playground?.gameId) pick = { kind: 'game', id: this.playground.gameId };
    this.dock.paint({ section: this.section(), pick, page, hidden: this.screen === 'atom' && this.mode === 'view' });
  }

  /** An atom's Build or Learn, from the dock: the atom in the dropdown, on that page. */
  private toPage(p: AtomPage): void {
    closeSheet();
    const pick = this.dock?.current.pick;
    if (pick?.kind !== 'atom') return;
    this.z = pick.z;
    if (this.dock?.current.page === p) return;
    const mode: AtomMode = p === 'build' ? 'build' : 'info';
    void this.go('atom', mode);
  }

  /** Home or a section in the dock: the lit one goes back to its top (nothing to do there
   *  already); another opens as it was left. */
  private toSection(s: Section, lit: boolean): void {
    closeSheet();
    if (lit && !this.dock?.current.pick) return;
    if (s === 'home') void this.go('home');
    else if (s === 'collect') void this.go('collect');
    else if (s === 'learn') void this.go('gallery').then(() => { if (lit) this.gallery.closePage(); });
    else if (lit && this.screen === 'puzzles' && this.playground?.inPuzzle) this.playground.back();
    else void this.go('puzzles');
  }

  /** The dock's dropdown: the list of atoms (on the tab of the section) or of games. Again, it
   *  closes the list. */
  private openPick(): void {
    const dock = this.dock;
    const pick = dock?.current.pick;
    if (!dock || !pick) return;
    if (atomListOpen() || gameListOpen()) { closeSheet(); return; }
    dock.setOpen(true);
    const onClose = () => dock.setOpen(false);
    if (pick.kind === 'game') openGameList({ current: pick.id, onPick: (id, level) => this.playground?.open(id, level), onClose });
    else openAtomList({ current: pick.z, tab: dock.current.section === 'learn' ? 'learn' : 'collect', onPick: (z) => this.pickAtom(z), onClose });
  }

  /** An atom picked from the dock's list: the same page, on that atom. */
  private pickAtom(z: number): void {
    if (this.screen === 'gallery') { this.gallery.openPage(z); return; }
    if (this.screen === 'collect') { this.z = z; this.collect.show(z); this.paintDock(); return; }
    if (this.screen !== 'atom') return;
    this.z = z;
    if (this.mode === 'build') this.game?.openElement(z);
    else this.gallery.openAtom(z, 'info');
    this.paintDock();
  }

  /** Search, from the header: an atom opens on Learn's page when Learn is open, else its Build
   *  page; a game opens on Play. */
  private search(): void {
    openFinder({
      onAtom: (z) => {
        if (this.screen === 'gallery') { this.gallery.openPage(z); return; }
        this.z = z;
        void this.go('atom', 'build');
      },
      onGame: (id) => void this.go('puzzles').then(() => this.playground?.open(id)),
    });
  }

  /** Beside Search: nothing for now (what is left to earn in Learn sits in its own lists). */
  private paintAside(_screen: Screen): void {
    $('nav-aside').hidden = true;
  }

  private setNav(screen: Screen, mode: AtomMode): void {
    closeSheet();
    $('nav-settings').setAttribute('aria-current', screen === 'settings' ? 'page' : 'false');
    this.paintAside(screen);
    document.body.dataset.screen = screen === 'atom' ? `atom-${mode}` : screen;
    this.paintDock();
    this.remember(screen, mode);
    this.syncBack();
  }
}
